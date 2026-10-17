import assert from "node:assert/strict";
import test from "node:test";
import { parseWeeklyRehearsalStatus } from "../src/weekly-rehearsal-status.ts";
import { createWeeklyRehearsalObserver } from "../src/server/weekly-rehearsal-status.ts";
import { weeklyStatusHarness } from "./helpers/weekly_status_harness.mjs";

const stamp = "2026-10-05T07:30:00.123456+00:00", now = Date.parse(stamp) + 1000;
const good = () => ({ state: "observed", observation: { schemaVersion: 1,
  evidenceKind: "current_local_fictional_weekly_status", observedAt: stamp, dueAt: "2026-10-05T06:00:00+00:00",
  windowKey: "2026-W41", graceMinutes: 60, state: "attention", reason: "scheduled_run_missing", coverage: "unknown",
  totalReceipts: 0, unreadableReceipts: 0, pendingReceipts: 0, realScheduleEnabled: false,
  trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0 } });
const url = "http://127.0.0.1:3000/api/dev/update-rehearsal/status";
const request = (method = "GET", headers = {}, signal) => new Request(url, { method, signal, headers: { "sec-fetch-site": "same-origin", ...headers } });

test("weekly display cannot promote a missing/incomplete fictional receipt into live health or authority", () => {
  assert.deepEqual(parseWeeklyRehearsalStatus(good()), good());
  for (const change of [{ state: "healthy" }, { coverage: "complete" }, { realScheduleEnabled: true },
    { trustedRunLedger: true }, { publicationEnabled: true }, { sourceRequests: false }, { alertsSent: 1 },
    { privatePath: "private-canary" }, { totalReceipts: 101 }, { unreadableReceipts: 1 }, { graceMinutes: 0 }]) {
    assert.throws(() => parseWeeklyRehearsalStatus({ state: "observed", observation: { ...good().observation, ...change } }));
  }
});

test("current weekly window binds Monday 08 Oslo, exact ISO week and DST without a fractional deadline", () => {
  for (const change of [{ dueAt: "2026-10-06T06:00:00Z" }, { dueAt: "2026-09-28T06:00:00Z", windowKey: "2026-W40" },
    { dueAt: "2026-10-05T07:00:00Z" }, { dueAt: "2026-10-05T06:00:00.000001Z" }, { windowKey: "2026-W42" }]) {
    assert.throws(() => parseWeeklyRehearsalStatus({ state: "observed", observation: { ...good().observation, ...change } }));
  }
  for (const [observedAt, dueAt, windowKey] of [
    ["2026-10-26T09:00:00Z", "2026-10-26T07:00:00Z", "2026-W44"],
    ["2027-01-04T09:00:00Z", "2027-01-04T07:00:00Z", "2027-W01"],
  ]) assert.equal(parseWeeklyRehearsalStatus({ state: "observed", observation: { ...good().observation, observedAt, dueAt, windowKey } }).state, "observed");
  assert.equal(parseWeeklyRehearsalStatus({ state: "observed", observation: { ...good().observation,
    observedAt: "2026-10-04T22:15:00Z", state: "pending", reason: "not_due" } }).state, "observed");
});

test("weekly reasons require their clock interval and actual supporting receipt count", () => {
  const observed = changes => ({ state: "observed", observation: { ...good().observation, ...changes } });
  for (const changes of [
    { state: "healthy", reason: "due_window_completed", coverage: "complete", totalReceipts: 0 },
    { observedAt: "2026-10-05T05:59:59.999999Z", state: "healthy", reason: "due_window_completed", coverage: "complete", totalReceipts: 1 },
    { observedAt: "2026-10-05T07:00:00Z" },
    { reason: "not_due", state: "pending" }, { reason: "within_grace_window", state: "pending" },
    { reason: "scheduled_run_missing_manual_catchup_complete", coverage: "complete" },
    { reason: "latest_receipt_ambiguous", state: "held", totalReceipts: 1 },
    { reason: "scheduled_run_late", coverage: "complete", totalReceipts: 1, observedAt: "2026-10-05T07:00:00Z" },
    { reason: "run_not_completed" }, { reason: "due_source_coverage_incomplete", coverage: "incomplete" },
  ]) assert.throws(() => parseWeeklyRehearsalStatus(observed(changes)));
  for (const changes of [
    { observedAt: "2026-10-05T05:59:59.999999Z", state: "pending", reason: "not_due" },
    { observedAt: "2026-10-05T06:00:00Z", state: "pending", reason: "within_grace_window" },
    { observedAt: "2026-10-05T07:00:00Z", state: "pending", reason: "within_grace_window" },
    { observedAt: "2026-10-05T07:00:00.000001Z" },
    { state: "healthy", reason: "due_window_completed", coverage: "complete", totalReceipts: 1 },
    { reason: "scheduled_run_missing_manual_catchup_complete", coverage: "complete", totalReceipts: 1 },
    { reason: "latest_receipt_ambiguous", state: "held", totalReceipts: 2 },
  ]) assert.equal(parseWeeklyRehearsalStatus(observed(changes)).state, "observed");
});

test("weekly observer refuses nonlocal selectors/methods/environments and cancelled requests before reading", async () => {
  let reads = 0; const handle = createWeeklyRehearsalObserver(async () => { reads++; return good(); }, () => now);
  for (const env of ["production", "test", undefined]) assert.equal((await handle(request(), env)).status, 404);
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) assert.equal((await handle(request(method), "development")).status, 405);
  for (const headers of [{ origin: "https://example.org" }, { host: "example.org" }, { "sec-fetch-site": "cross-site" }])
    assert.equal((await handle(request("GET", headers), "development")).status, 403);
  assert.equal((await handle(new Request(url + "?scope=real"), "development")).status, 403);
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await handle(request("GET", {}, cancelled.signal), "development")).status, 409); assert.equal(reads, 0);
});

test("concurrent weekly reads share a snapshot but later requests inspect again without starting updates", async () => {
  let reads = 0, resolve; const handle = createWeeklyRehearsalObserver(async () => { reads++; return new Promise(done => { resolve = done; }); }, () => now);
  const cancelled = new AbortController(), a = handle(request("GET", {}, cancelled.signal), "development"), b = handle(request(), "development");
  await Promise.resolve(); assert.equal(reads, 1); cancelled.abort(); resolve(good());
  assert.equal((await a).status, 409); const response = await b;
  assert.deepEqual(await response.json(), good()); assert.equal(response.headers.get("cache-control"), "no-store");
  const next = handle(request(), "development"); await Promise.resolve(); assert.equal(reads, 2); resolve(good()); await next;
});

test("failed stale future and private-field weekly responses are held without diagnostic leakage", async () => {
  for (const inspect of [async () => { throw new Error("private-canary"); }, async () => ({ ...good(), privatePath: "canary" }),
    async () => ({ state: "observed", observation: { ...good().observation, observedAt: "2026-10-05T07:00:00Z" } }),
    async () => ({ state: "observed", observation: { ...good().observation, observedAt: "2026-10-05T08:00:00Z" } })]) {
    const handle = createWeeklyRehearsalObserver(inspect, () => now);
    assert.deepEqual(await (await handle(request(), "development")).json(), { state: "held", reason: "weekly_rehearsal_unavailable" });
  }
});

test("weekly callback is explicit, clears old status on refresh and explains catch-up without installing a schedule", async () => {
  const original = globalThis.fetch; let reads = 0, resolve;
  globalThis.fetch = async () => { reads++; return new Promise(done => { resolve = done; }); };
  try {
    const ui = weeklyStatusHarness(); ui.mount(); assert.equal(reads, 0);
    ui.button().onClick(); ui.button().onClick(); assert.equal(reads, 1);
    resolve(Response.json(good())); await new Promise(done => setTimeout(done, 0));
    assert.ok(ui.markup().includes("No completed weekly rehearsal"));
    ui.button().onClick(); assert.ok(!ui.markup().includes("No completed weekly rehearsal"));
    resolve(Response.json({ state: "observed", observation: { ...good().observation,
      reason: "scheduled_run_missing_manual_catchup_complete", coverage: "complete", totalReceipts: 1 } }));
    await new Promise(done => setTimeout(done, 0));
    assert.ok(ui.markup().includes("weekly trigger still had no completed rehearsal"));
    assert.ok(ui.markup().includes("No real schedule is enabled")); ui.unmount();
  } finally { globalThis.fetch = original; }
});

test("late weekly callback after unmount and malformed results remain withheld", async () => {
  const original = globalThis.fetch; let resolve;
  globalThis.fetch = async () => new Promise(done => { resolve = done; });
  try {
    const ui = weeklyStatusHarness(); ui.mount(); ui.button().onClick(); ui.unmount();
    resolve(Response.json(good())); await new Promise(done => setTimeout(done, 0));
    assert.ok(!ui.markup().includes("No completed weekly rehearsal"));
    const bad = weeklyStatusHarness(); bad.mount(); bad.button().onClick();
    resolve(Response.json({ ...good(), privatePath: "private-canary" })); await new Promise(done => setTimeout(done, 0));
    assert.ok(bad.markup().includes("weekly history could not be verified")); assert.ok(!bad.markup().includes("private-canary")); bad.unmount();
  } finally { globalThis.fetch = original; }
});
