import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as files from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { FictionalReceiptStore } from "../src/server/fictional-receipt-store.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
const receipt = () => ({ execution: { id: randomUUID(), kind: "local_fictional", scenario: "standard",
  executedAt: "2026-10-01T12:00:00Z", durationMs: 10 }, report: structuredClone(saved) });
function faultStore(collaborators) {
  const file = new URL("../src/server/fictional-receipt-store.ts", import.meta.url), native = createRequire(file), exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", code)(name => name === "node:fs/promises" ? { ...files, ...collaborators } : native(name), exports);
  return exports.FictionalReceiptStore;
}
async function scratch(t) {
  const parent = await files.mkdtemp(join(tmpdir(), "tf-receipt-close-test-"));
  t.after(() => files.rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "archive"), store = new FictionalReceiptStore(directory), input = receipt();
  await store.append(input); return { parent, directory, store, input };
}
for (const mutation of ["contents", "name"]) {
  test(`a receipt changed by ${mutation} at the final namespace check is withheld`, async (t) => {
    const { parent, directory, input } = await scratch(t), path = join(directory, `${input.execution.id}.json`);
    const before = await files.readFile(path), kept = join(parent, "preserved-original.json");
    let count = 0, changed = false;
    const FaultStore = faultStore({ async readdir(...args) {
      const names = await files.readdir(...args);
      if (++count === 2) {
        if (mutation === "contents") await files.writeFile(path, "private-canary-invalid-body");
        else { await files.rename(path, kept); await files.writeFile(path, before, { mode: 0o600 }); }
        changed = true;
      }
      return names;
    } });
    const result = await new FaultStore(directory).inspectAll();
    assert.equal(changed, true); assert.equal(result.stableSnapshot, false);
    assert.deepEqual(result.entries, []); assert.equal(result.totalReceipts, 1); assert.equal(result.unreadableReceipts, 1);
    assert.equal(JSON.stringify(result).includes("private-canary"), false);
    if (mutation === "contents") assert.equal(await files.readFile(path, "utf8"), "private-canary-invalid-body");
    else assert.deepEqual(await files.readFile(kept), before);
  });
}
test("a changed earlier receipt cannot remain beside a separately intact later receipt", async (t) => {
  const { directory, store, input } = await scratch(t), second = receipt(); await store.append(second);
  let count = 0;
  const FaultStore = faultStore({ async readdir(...args) {
    const names = await files.readdir(...args);
    if (++count === 2) await files.writeFile(join(directory, `${input.execution.id}.json`), "private-canary-corrupt");
    return names;
  } });
  const result = await new FaultStore(directory).inspectAll();
  assert.equal(result.stableSnapshot, false); assert.equal(result.unreadableReceipts, 1);
  assert.deepEqual(result.entries, [second]); assert.equal(result.totalReceipts, 2);
});
test("unchanged complete history remains stable and counts no false unreadable receipts", async (t) => {
  const { store, input } = await scratch(t), result = await store.inspectAll();
  assert.equal(result.stableSnapshot, true); assert.equal(result.unreadableReceipts, 0);
  assert.deepEqual(result.entries, [input]); assert.equal(result.pendingReceipts, 0);
});
test("unknown namespace entries still mark incompleteness without reading or pruning them", async (t) => {
  const { directory, store, input } = await scratch(t), path = join(directory, "private-canary-extra");
  await files.writeFile(path, "private-canary-value", { mode: 0o600 });
  const result = await store.inspectAll(); assert.equal(result.stableSnapshot, false);
  assert.deepEqual(result.entries, [input]); assert.equal(result.unreadableReceipts, 0);
  assert.equal(JSON.stringify(result).includes("private-canary"), false);
  assert.equal(await files.readFile(path, "utf8"), "private-canary-value");
});
