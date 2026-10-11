import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createPrivateCustodianHandler } from "../src/server/private-custodian-operation.ts";
import { createCorrectionReviewObserver } from "../src/server/correction-review-operation.ts";
import { handleFictionalUpdateRequest } from "../src/server/fictional-update-operation.ts";
import { FictionalArchiveCapacityError } from "../src/server/fictional-receipt-store.ts";
import { observeDevelopmentError } from "../src/server/error-diagnostics.ts";

const turn = () => new Promise(resolve => setImmediate(resolve));
const request = (path, body) => new Request(`http://127.0.0.1:3000/api/dev/${path}`, {
  method: body ? "POST" : "GET", ...(body ? { body } : {}),
  headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json", "sec-fetch-site": "same-origin" },
});
const held = { state: "held", reason: "private_test_unavailable" };
const fixture = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
const report = () => ({ ...structuredClone(fixture), trigger: "manual", scheduledDueAt: null, requestKey: "fictional:manual:2026w40" });

test("failed or invalid coalesced custodian observation makes one closed diagnostic attempt and retains its held response", async () => {
  for (const inspect of [async () => { throw new Error("PRIVATE_SQL_PATH_CANARY"); }, async () => ({ state: "idle", password: "PRIVATE_SQL_PATH_CANARY" })]) {
    let reads = 0, starts = 0; const recorded = [];
    const handle = createPrivateCustodianHandler({ inspect: async () => { reads++; return inspect(); }, start: async () => { starts++; return held; } },
      { status: { state: "idle" } }, async (...args) => { recorded.push(args); return "saved"; });
    const values = await Promise.all([handle(request("private-custodian"), "development"), handle(request("private-custodian"), "development")]);
    for (const value of values) assert.deepEqual(await value.json(), held);
    await turn(); assert.equal(reads, 1); assert.equal(starts, 0); assert.deepEqual(recorded, [["server_route"]]);
  }
});
test("custodian worker failure is observed without retrying the consumed attempt or awaiting a stalled logger", async () => {
  let starts = 0, calls = 0, saved = { state: "idle" };
  const handle = createPrivateCustodianHandler({ inspect: async () => saved, start: async () => {
    starts++; saved = held; throw new Error("PRIVATE_WORKER_CANARY");
  } }, { status: { state: "idle" } }, async code => { calls++; assert.equal(code, "server_route"); return new Promise(() => {}); });
  await handle(request("private-custodian", '{"action":"run_invented_custodian"}'), "development"); await turn();
  assert.deepEqual(await (await handle(request("private-custodian"), "development")).json(), held);
  await handle(request("private-custodian", '{"action":"run_invented_custodian"}'), "development");
  assert.equal(starts, 1); assert.equal(calls, 1);
});
test("valid held/idle job results and rejected requests are not automatic faults", async () => {
  for (const state of [{ state: "idle" }, held]) {
    const record = async () => assert.fail("Expected outcome logged as a fault");
    const custodial = createPrivateCustodianHandler({ inspect: async () => state, start: async () => held }, { status: { state: "idle" } }, record);
    const review = createCorrectionReviewObserver(async () => state, undefined, record);
    for (const [handle, path] of [[custodial, "private-custodian"], [review, "correction-review"]]) {
      assert.deepEqual(await (await handle(request(path), "development")).json(), state);
      assert.equal((await handle(new Proxy({}, { get() { assert.fail("production request inspected"); } }), "production")).status, 404);
    }
  }
  await turn();
});
test("coalesced review observer or parser failure records a fixed code once with no private fields", async () => {
  for (const inspect of [async () => { throw new Error("PRIVATE_JOURNAL_CANARY"); }, async () => ({ state: "idle", rawBody: "PRIVATE_JOURNAL_CANARY" })]) {
    const codes = []; let reads = 0;
    const handle = createCorrectionReviewObserver(async () => { reads++; return inspect(); }, undefined, async (...args) => { codes.push(args); return "saved"; });
    const responses = await Promise.all([handle(request("correction-review"), "development"), handle(request("correction-review"), "development")]);
    for (const response of responses) { assert.equal(response.status, 200); assert.deepEqual(await response.json(), held); }
    await turn(); assert.equal(reads, 1); assert.deepEqual(codes, [["correction_review_observer"]]);
  }
});
test("logger rejection or synchronous failure cannot replace a review outcome or trigger recursive logging", async () => {
  for (const record of [() => { throw new Error("PRIVATE_LOGGER_CANARY"); }, async () => { throw new Error("PRIVATE_LOGGER_CANARY"); }]) {
    let calls = 0;
    const handle = createCorrectionReviewObserver(async () => { throw new Error("PRIVATE_JOB_CANARY"); }, undefined, code => { calls++; return record(code); });
    assert.deepEqual(await (await handle(request("correction-review"), "development")).json(), held);
    await turn(); assert.equal(calls, 1);
  }
});
test("wrong-trigger and failed update jobs record only the update operation code without changing opaque failure", async () => {
  for (const run of [async () => fixture, async () => { throw new Error("PRIVATE_UPDATE_CANARY"); }]) {
    const codes = [];
    const response = await handleFictionalUpdateRequest(request("update-rehearsal", '{"trigger":"manual"}'), "development", run,
      async () => assert.fail("Invalid job must not be archived"), async (...args) => { codes.push(args); return "saved"; });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "rehearsal_unavailable" });
    await turn(); assert.deepEqual(codes, [["update_operation"]]);
  }
});
test("archive capacity and caller cancellation preserve their refusal without automatic fault records", async () => {
  const record = async () => assert.fail("Expected refusal logged");
  const full = await handleFictionalUpdateRequest(request("update-rehearsal", '{"trigger":"manual"}'), "development", async () => report(),
    async () => { throw new FictionalArchiveCapacityError("Full"); }, record);
  assert.deepEqual(await full.json(), { error: "fictional_archive_full" });
  const parent = new AbortController(), input = request("update-rehearsal", '{"trigger":"manual"}');
  const cancelled = new Request(input, { signal: parent.signal });
  const response = await handleFictionalUpdateRequest(cancelled, "development", async () => { parent.abort(); throw new Error("Cancelled"); }, undefined, record);
  assert.deepEqual(await response.json(), { error: "rehearsal_unavailable" }); await turn();
});
test("nonblocking diagnostic observer accepts only a code and consumes asynchronous failure", async () => {
  let calls = 0;
  assert.equal(observeDevelopmentError("server_route", async (...args) => { calls++; assert.deepEqual(args, ["server_route"]); throw new Error("PRIVATE_CANARY"); }), undefined);
  await turn(); assert.equal(calls, 1);
});
