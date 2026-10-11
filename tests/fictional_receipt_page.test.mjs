import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fictionalHistoryRequestSelection, fictionalHistoryPageHref, fictionalReceiptPageSchema } from "../src/fictional-receipt-page.ts";
import { handleFictionalHistoryPageRequest } from "../src/server/fictional-receipt-page.ts";
import { FictionalReceiptStore } from "../src/server/fictional-receipt-store.ts";
import { hasLocalDevelopmentOrigin } from "../src/server/local-development-request.ts";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
const receipt = (day, trigger = "scheduled") => ({ execution: { id: randomUUID(), kind: "local_fictional", scenario: "standard", executedAt: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`, durationMs: 1 },
  report: { ...structuredClone(fixture), trigger, scheduledDueAt: trigger === "manual" ? null : fixture.scheduledDueAt, requestKey: trigger === "manual" ? "fictional:manual:2026w40" : fixture.requestKey } });
const inventory = (entries = []) => ({ entries, totalReceipts: entries.length, unreadableReceipts: 0, pendingReceipts: 0, stableSnapshot: true });
const request = (query = "", headers = {}) => new Request(`http://127.0.0.1:3000/api/dev/update-rehearsal/history/page${query ? `?${query}` : ""}`, { headers: { "sec-fetch-site": "same-origin", ...headers } });
const readPage = async (query, input) => {
  const response = await handleFictionalHistoryPageRequest(request(query), "development", async () => structuredClone(input));
  assert.equal(response.status, 200); return fictionalReceiptPageSchema.parse(await response.json());
};

test("history selectors are closed, bounded and round-trip only view literals and a comparison token", () => {
  const good = { page: 13, scenario: "standard", trigger: "manual" }, token = "a".repeat(64);
  const url = new URL(fictionalHistoryPageHref(good, token), "http://127.0.0.1");
  assert.deepEqual(fictionalHistoryRequestSelection(url.searchParams), { selection: good, snapshot: token });
  for (const query of ["page=0", "page=14", "page=01", "page=1&page=2", "scenario=toString", "scenario=standard&scenario=standard", "trigger=publish",
    "snapshot=../private", "snapshot=" + "A".repeat(64), "path=/private", "source=https://example.org", "snapshot="])
    assert.equal(fictionalHistoryRequestSelection(new URLSearchParams(query)), null, query);
});
test("page route refuses production before request getters and checks origin, method, cancellation and selectors before reading", async () => {
  const read = async () => assert.fail("Unadmitted archive read");
  const poison = new Proxy({}, { get() { assert.fail("Production request getter touched"); } });
  for (const mode of [undefined, "test", "production"]) assert.equal((await handleFictionalHistoryPageRequest(poison, mode, read)).status, 404);
  for (const headers of [{ host: "foreign.invalid" }, { origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }])
    assert.equal((await handleFictionalHistoryPageRequest(request("page=2", headers), "development", read)).status, 403);
  assert.equal((await handleFictionalHistoryPageRequest(new Request(request().url, { method: "POST" }), "development", read)).status, 405);
  for (const query of ["file=/private", "page=1&page=2", "scenario=private"])
    assert.equal((await handleFictionalHistoryPageRequest(request(query), "development", read)).status, 400);
  const parent = new AbortController(); parent.abort();
  assert.equal((await handleFictionalHistoryPageRequest(new Request(request(), { signal: parent.signal }), "development", read)).status, 409);
  assert.equal(hasLocalDevelopmentOrigin(request("page=2"), false), false, "older no-query routes remain closed");
});
test("nineteen receipts span three exact bounded pages without gaps, overlap or mutation", async () => {
  const entries = Array.from({ length: 19 }, (_, index) => receipt(index + 1)), input = inventory(entries), original = structuredClone(input);
  const first = await readPage("", input), second = await readPage(`page=2&snapshot=${first.snapshotToken}`, input), third = await readPage(`page=3&snapshot=${first.snapshotToken}`, input);
  assert.equal(first.pages, 3); assert.equal(first.entries.length, 8); assert.equal(second.entries.length, 8); assert.equal(third.entries.length, 3);
  const ids = [...first.entries, ...second.entries, ...third.entries].map(row => row.execution.id);
  assert.deepEqual(ids, [...entries].reverse().map(row => row.execution.id)); assert.deepEqual(input, original);
  assert.equal(first.snapshotToken, third.snapshotToken);
});
test("trigger and scenario filters retain exact counts and do not imply missing attempts", async () => {
  const entries = Array.from({ length: 18 }, (_, index) => receipt(index + 1, index % 2 ? "manual" : "scheduled"));
  const first = await readPage("trigger=manual", inventory(entries));
  assert.equal(first.matchingReceipts, 9); assert.equal(first.pages, 2); assert.ok(first.entries.every(row => row.report.trigger === "manual"));
  const second = await readPage(`trigger=manual&page=2&snapshot=${first.snapshotToken}`, inventory(entries));
  assert.equal(second.entries.length, 1); assert.equal(second.entries[0].execution.executedAt, "2026-09-02T10:00:00Z");
  const empty = await readPage("scenario=revised_value", inventory(entries));
  assert.equal(empty.matchingReceipts, 0); assert.equal(empty.pages, 1); assert.deepEqual(empty.entries, []); assert.equal(empty.totalReceipts, 18);
});
test("a changed receipt, new receipt or unstable inventory invalidates a supplied snapshot without exposing a page", async () => {
  const input = inventory(Array.from({ length: 9 }, (_, index) => receipt(index + 1))), first = await readPage("", input);
  for (const changed of [inventory([...input.entries, receipt(10)]), { ...input, stableSnapshot: false },
    { ...input, entries: input.entries.map((row, index) => index ? row : { ...row, execution: { ...row.execution, durationMs: 2 } }) }]) {
    const response = await handleFictionalHistoryPageRequest(request(`page=2&snapshot=${first.snapshotToken}`), "development", async () => changed);
    assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: "fictional_history_changed" });
  }
});
test("partial inventories show withheld counts and verified rows without becoming complete snapshots", async () => {
  const page = await readPage("", { ...inventory([receipt(1)]), totalReceipts: 2, unreadableReceipts: 1, pendingReceipts: 1, stableSnapshot: false });
  assert.equal(page.entries.length, 1); assert.equal(page.unreadableReceipts, 1); assert.equal(page.pendingReceipts, 1); assert.equal(page.stableSnapshot, false);
});
test("malformed inventory and unavailable archive make a closed diagnostic attempt while page bounds are ordinary refusals", async () => {
  const codes = [];
  for (const read of [async () => ({ ...inventory(), privatePath: "PRIVATE_CANARY" }), async () => ({ ...inventory(), totalReceipts: 1 }),
    async () => { throw new Error("PRIVATE_CANARY"); }]) {
    const response = await handleFictionalHistoryPageRequest(request(), "development", read, async code => { codes.push(code); return "saved"; });
    assert.deepEqual(await response.json(), { error: "fictional_history_unavailable" });
  }
  assert.equal(codes.length, 3);
  const outside = await handleFictionalHistoryPageRequest(request("page=2"), "development", async () => inventory(), async () => assert.fail("Ordinary page bound logged"));
  assert.equal(outside.status, 400); assert.deepEqual(await outside.json(), { error: "fictional_history_page_unavailable" });
});
test("response validation refuses inconsistent counts, filters, page size, duplicate identities and order", async () => {
  const page = await readPage("trigger=scheduled", inventory([receipt(1), receipt(2)]));
  for (const changed of [{ ...page, matchingReceipts: 3 }, { ...page, pages: 2 }, { ...page, selection: { ...page.selection, page: 2 } },
    { ...page, entries: [page.entries[0], page.entries[0]] }, { ...page, entries: [...page.entries].reverse() },
    { ...page, selection: { ...page.selection, trigger: "manual" } }, { ...page, raw: "PRIVATE_CANARY" }])
    assert.equal(fictionalReceiptPageSchema.safeParse(changed).success, false);
});
test("actual owned archive older-page inspection preserves receipt bytes, unknown entries and legacy recent behavior", async () => {
  const parent = await mkdtemp('/tmp/terrafracta-history-page-'), directory = join(parent, "archive"), store = new FictionalReceiptStore(directory);
  const rows = Array.from({ length: 10 }, (_, index) => receipt(index + 1));
  for (const row of rows) await store.append(row);
  const before = new Map(await Promise.all((await readdir(directory)).map(async name => [name, await readFile(join(directory, name))])));
  const firstResponse = await handleFictionalHistoryPageRequest(request(), "development", () => store.inspectAll());
  const first = fictionalReceiptPageSchema.parse(await firstResponse.json());
  const olderResponse = await handleFictionalHistoryPageRequest(request(`page=2&snapshot=${first.snapshotToken}`), "development", () => store.inspectAll());
  const older = fictionalReceiptPageSchema.parse(await olderResponse.json());
  assert.deepEqual(older.entries.map(row => row.execution.id), [rows[1].execution.id, rows[0].execution.id]);
  assert.equal((await store.recent()).entries.length, 8);
  for (const [name, bytes] of before) assert.deepEqual(await readFile(join(directory, name)), bytes);
  await writeFile(join(directory, "unknown-preserved"), "PRIVATE_CANARY", { mode: 0o600 });
  const partialResponse = await handleFictionalHistoryPageRequest(request(), "development", () => store.inspectAll());
  const partial = await partialResponse.json(); assert.equal(partial.stableSnapshot, false);
  assert.ok(!JSON.stringify(partial).includes("PRIVATE_CANARY")); assert.equal(await readFile(join(directory, "unknown-preserved"), "utf8"), "PRIVATE_CANARY");
});
test("mixed timestamp precisions sort by exact UTC instants across native recent and paged history", async () => {
  const parent = await mkdtemp('/tmp/terrafracta-history-precision-'), store = new FictionalReceiptStore(join(parent, 'archive'));
  const times = ['2026-10-04T10:00:00Z', '2026-10-04T10:00:00.001Z', '2026-10-04T10:00:00.01Z',
    '2026-10-04T10:00:00.000001Z', '2026-10-04T10:00:00.000002Z'];
  const entries = times.map((executedAt, index) => ({ ...receipt(index + 1), execution: { ...receipt(index + 1).execution, executedAt } }));
  for (const row of entries) await store.append(row);
  const expected = [times[2], times[1], times[4], times[3], times[0]];
  assert.deepEqual((await store.recent()).entries.map(row => row.execution.executedAt), expected);
  const page = await readPage('', await store.inspectAll());
  assert.deepEqual(page.entries.map(row => row.execution.executedAt), expected);
  assert.equal(fictionalReceiptPageSchema.safeParse({ ...page, entries: [...page.entries].reverse() }).success, false);
});
test("equivalent fractional precisions tie by UUID rather than spelling or input order", async () => {
  const a = receipt(1), b = receipt(2);
  a.execution.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; b.execution.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  a.execution.executedAt = '2026-10-04T10:00:00.100Z'; b.execution.executedAt = '2026-10-04T10:00:00.1Z';
  const page = await readPage('', inventory([a, b]));
  assert.deepEqual(page.entries.map(row => row.execution.id), [b.execution.id, a.execution.id]);
});
