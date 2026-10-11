import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import * as files from "node:fs/promises";
import ts from "typescript";
import test from "node:test";
import * as resultContract from "../src/fictional-update-result.ts";
import { FictionalReceiptStore } from "../src/server/fictional-receipt-store.ts";
import { handleFictionalHistoryRequest } from "../src/server/fictional-receipt-history.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
function receipt(date = "2026-09-30T10:00:00Z") {
  return { execution: { id: randomUUID(), kind: "local_fictional", scenario: "standard", executedAt: date, durationMs: 123 }, report: structuredClone(saved) };
}
async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), "tf-fictional-receipt-test-"));
  t.after(() => rm(root, { recursive: true, force: true })); // Only this test's own scratch directory.
  return join(root, "archive");
}

test("a completed receipt survives a fresh store instance with private file modes", async (t) => {
  const directory = await scratch(t);
  const store = new FictionalReceiptStore(directory);
  assert.deepEqual(await store.recent(), { entries: [], totalReceipts: 0, unreadableReceipts: 0, pendingReceipts: 0 });
  const input = receipt();
  await store.append(input);
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(directory, `${input.execution.id}.json`))).mode & 0o777, 0o600);
  const reopened = await new FictionalReceiptStore(directory).recent();
  assert.deepEqual(reopened.entries[0], input);
  assert.equal(reopened.totalReceipts, 1);
  assert.equal(reopened.unreadableReceipts, 0);
});

test("duplicate execution identities cannot overwrite a saved receipt", async (t) => {
  const directory = await scratch(t);
  const store = new FictionalReceiptStore(directory);
  const first = receipt();
  await store.append(first);
  const before = await readFile(join(directory, `${first.execution.id}.json`), "utf8");
  await assert.rejects(store.append({ ...first, execution: { ...first.execution, durationMs: 999 } }));
  assert.equal(await readFile(join(directory, `${first.execution.id}.json`), "utf8"), before);
  assert.equal((await store.recent()).entries[0].execution.durationMs, 123);
  assert.ok((await readdir(directory)).some((name) => name.startsWith(".pending-")), "failed staging evidence is preserved");
});

test("malformed, oversized, substituted and linked receipts are withheld without deletion", async (t) => {
  const directory = await scratch(t);
  const store = new FictionalReceiptStore(directory);
  await store.append(receipt());
  const malformed = join(directory, `${randomUUID()}.json`);
  const oversized = join(directory, `${randomUUID()}.json`);
  const substituted = join(directory, `${randomUUID()}.json`);
  const linked = join(directory, `${randomUUID()}.json`);
  await writeFile(malformed, "{broken private-canary", { mode: 0o600 });
  await writeFile(oversized, "x".repeat(65 * 1024), { mode: 0o600 });
  await writeFile(substituted, JSON.stringify(receipt()), { mode: 0o600 });
  await symlink(malformed, linked);
  const inventory = await store.recent();
  assert.equal(inventory.totalReceipts, 5);
  assert.equal(inventory.unreadableReceipts, 4);
  assert.equal(inventory.entries.length, 1);
  assert.equal((await readdir(directory)).length, 5);
  assert.ok(!JSON.stringify(inventory).includes("private-canary"));
});

test("a symlink or a broad-readable archive root is refused without permission changes", async (t) => {
  const directory = await scratch(t);
  const target = `${directory}-target`;
  await mkdir(target, { mode: 0o700 });
  await symlink(target, directory);
  await assert.rejects(new FictionalReceiptStore(directory).append(receipt()));
  await assert.rejects(new FictionalReceiptStore(directory).recent());
  assert.deepEqual(await readdir(target), []);
  const broad = `${directory}-broad`;
  await mkdir(broad, { mode: 0o755 });
  await chmod(broad, 0o755);
  await assert.rejects(new FictionalReceiptStore(broad).append(receipt()));
  assert.equal((await lstat(broad)).mode & 0o777, 0o755);
});

test("history is bounded to eight newest readable results", async (t) => {
  const store = new FictionalReceiptStore(await scratch(t));
  for (let day = 1; day <= 10; day++) await store.append(receipt(`2026-09-${String(day).padStart(2, "0")}T10:00:00Z`));
  const history = await store.recent();
  assert.equal(history.totalReceipts, 10);
  assert.equal(history.entries.length, 8);
  assert.equal(history.entries[0].execution.executedAt, "2026-09-10T10:00:00Z");
  assert.equal(history.entries.at(-1).execution.executedAt, "2026-09-03T10:00:00Z");
  const complete = await store.inspectAll();
  assert.equal(complete.entries.length, 10, "monitoring sees every readable bounded receipt rather than the recent display slice");
  assert.equal(complete.stableSnapshot, true);
});

test("full inspection withholds unsafe files and marks unknown entries incomplete without reading or deleting them", async (t) => {
  const directory = await scratch(t), store = new FictionalReceiptStore(directory);
  await store.append(receipt());
  const unlisted = join(directory, ".env-private-canary");
  await writeFile(unlisted, "private-canary", { mode: 0o600 });
  const inspection = await store.inspectAll();
  assert.equal(inspection.entries.length, 1); assert.equal(inspection.stableSnapshot, false);
  assert.ok(!JSON.stringify(inspection).includes("private-canary"));
  assert.equal(await readFile(unlisted, "utf8"), "private-canary");
});

test("full inspection withholds earlier receipts replaced during a later read", async (t) => {
  const directory = await scratch(t), store = new FictionalReceiptStore(directory);
  await store.append(receipt()); await store.append(receipt());
  const [first, second] = await readdir(directory);
  const original = await readFile(join(directory, first), "utf8");
  const changed = JSON.parse(original); changed.execution.executedAt = "2026-09-30T11:00:00Z";
  let replaced = false;
  const native = createRequire(new URL("../src/server/fictional-receipt-store.ts", import.meta.url)), exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL("../src/server/fictional-receipt-store.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const faultFiles = { ...files, async open(path, ...options) {
    if (path === join(directory, second) && !replaced) {
      replaced = true; await writeFile(join(directory, first), JSON.stringify(changed) + "\n");
    }
    return files.open(path, ...options);
  } };
  new Function("require", "exports", compiled)(name => name === "node:fs/promises" ? faultFiles
    : name === "../fictional-update-result.ts" ? resultContract : native(name), exports);
  const inventory = await new exports.FictionalReceiptStore(directory).inspectAll();
  assert.equal(replaced, true); assert.equal(inventory.stableSnapshot, false);
  assert.equal(inventory.unreadableReceipts, 1); assert.equal(inventory.entries.length, 1);
  assert.ok(!inventory.entries.some(value => `${value.execution.id}.json` === first));
  assert.equal(await readFile(join(directory, first), "utf8"), JSON.stringify(changed) + "\n");
  assert.equal((await readdir(directory)).length, 2);
});

test("archive capacity stops new writes and preserves every existing file", async (t) => {
  const directory = await scratch(t);
  await mkdir(directory, { mode: 0o700 });
  for (let index = 0; index < 100; index++) await writeFile(join(directory, `${randomUUID()}.json`), "{broken", { mode: 0o600 });
  const store = new FictionalReceiptStore(directory);
  await assert.rejects(store.append(receipt()), /capacity/);
  assert.equal((await readdir(directory)).length, 100);
  assert.equal((await store.recent()).unreadableReceipts, 100);
});

test("history route refuses production and foreign callers before reading the archive", async () => {
  const request = new Request("http://127.0.0.1:3000/api/dev/update-rehearsal/history", { headers: { "sec-fetch-site": "same-origin" } });
  const read = async () => assert.fail("archive must remain unread");
  for (const environment of ["production", undefined, "test"]) assert.equal((await handleFictionalHistoryRequest(request, environment, read)).status, 404);
  const foreign = new Request(request.url, { headers: { "sec-fetch-site": "cross-site" } });
  assert.equal((await handleFictionalHistoryRequest(foreign, "development", read)).status, 403);
  assert.equal((await handleFictionalHistoryRequest(new Request(request.url), "development", read)).status, 403);
});

test("history route returns validated bounded data and generic failure responses", async () => {
  const request = new Request("http://127.0.0.1:3000/api/dev/update-rehearsal/history", { headers: { "sec-fetch-site": "same-origin" } });
  const response = await handleFictionalHistoryRequest(request, "development", async () => ({ entries: [receipt()], totalReceipts: 1, unreadableReceipts: 0, pendingReceipts: 0 }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).entries.length, 1);
  const invalid = await handleFictionalHistoryRequest(request, "development", async () => ({ entries: [], totalReceipts: 0, unreadableReceipts: 1, pendingReceipts: 0 }));
  assert.equal(invalid.status, 503);
  const unavailable = await handleFictionalHistoryRequest(request, "development", async () => { throw new Error("/private/fictional-canary"); });
  assert.deepEqual(await unavailable.json(), { error: "fictional_history_unavailable" });
});
