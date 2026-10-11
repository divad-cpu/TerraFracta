import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { createCurrentCopyScopeObserver } from "../src/server/current-copy-scope.ts";
import { createCurrentParentSourceObserver } from "../src/server/current-parent-source.ts";
import { createCurrentPreparationObserver } from "../src/server/current-private-preparation.ts";
import { createWeeklyRehearsalObserver } from "../src/server/weekly-rehearsal-status.ts";
import { createCorrectionReviewObserver } from "../src/server/correction-review-operation.ts";
import { createSupervisedCorrectionReviewObserver } from "../src/server/supervised-correction-review-operation.ts";

// Native Request/Response and signal objects; all inspectors and recorders are
// supplied fictional ports. No server, HTTP, default archive or child is used.
const routes = [
  { path: "copy-scope", code: "copy_scope_observer", reason: "copy_observation_unavailable", create: (read, record) => createCurrentCopyScopeObserver(read, Date.now, record) },
  { path: "parent-source", code: "parent_source_observer", reason: "parent_source_comparison_unavailable", create: (read, record) => createCurrentParentSourceObserver(read, Date.now, record) },
  { path: "source-readiness", code: "preparation_observer", reason: "local_observation_unavailable", create: (read, record) => createCurrentPreparationObserver(read, Date.now, record) },
  { path: "update-rehearsal/status", code: "weekly_status_observer", reason: "weekly_rehearsal_unavailable", create: (read, record) => createWeeklyRehearsalObserver(read, Date.now, record) },
  { path: "correction-review", code: "correction_review_observer", reason: "private_test_unavailable", running: true, create: (read, record) => createCorrectionReviewObserver(read, undefined, record) },
  { path: "supervised-correction-review", code: "supervised_review_observer", reason: "private_test_unavailable", running: true, create: createSupervisedCorrectionReviewObserver },
];
const turn = () => new Promise(resolve => setImmediate(resolve));
const held = route => ({ state: "held", reason: route.reason });
const request = (route, signal) => new Request(`http://127.0.0.1:3000/api/dev/${route.path}`, {
  headers: { "sec-fetch-site": "same-origin" }, signal,
});
const response = async (value, status, expected) => {
  assert.equal(value.status, status);
  assert.deepEqual(await value.json(), expected);
  assert.equal(value.headers.get("cache-control"), "no-store");
  assert.equal(value.headers.get("x-content-type-options"), "nosniff");
  assert.equal(value.headers.get("allow"), "GET");
};

for (const route of routes) {
  test(`${route.path}: native listener retirement failure preserves held or failed inspection without duplicate diagnostics`, async () => {
    for (const fault of [false, true]) {
      let reads = 0; const seen = [];
      const handle = route.create(async () => { reads++; if (fault) throw Error("PRIVATE_INSPECTION_CANARY"); return held(route); },
        async (...args) => { seen.push(args); return "saved"; });
      const input = request(route); input.signal.removeEventListener = () => { throw Error("PRIVATE_RETIREMENT_CANARY"); };
      await response(await handle(input, "development"), 200, held(route)); await turn();
      assert.equal(reads, 1); assert.deepEqual(seen, [[route.code]]);
    }
  });
  test(`${route.path}: partially attached setup failure rolls back, starts no inspector and retains later recovery`, async () => {
    for (const refuseRemoval of [false, true]) {
      let reads = 0; const seen = [];
      const handle = route.create(async () => { reads++; return held(route); }, async (...args) => { seen.push(args); return "saved"; });
      const input = request(route), add = input.signal.addEventListener.bind(input.signal);
      input.signal.addEventListener = (...args) => { add(...args); throw Error("PRIVATE_PARTIAL_SETUP_CANARY"); };
      if (refuseRemoval) input.signal.removeEventListener = () => { throw Error("PRIVATE_RETIREMENT_CANARY"); };
      await response(await handle(input, "development"), 200, held(route)); await turn();
      assert.equal(reads, 0); assert.deepEqual(seen, [[route.code]]);
      if (!refuseRemoval) assert.equal(getEventListeners(input.signal, "abort").length, 0);
      await response(await handle(request(route), "development"), 200, held(route)); await turn();
      assert.equal(reads, 1); assert.deepEqual(seen, [[route.code]]);
    }
  });
  test(`${route.path}: cancelled caller stays silent when listener retirement refuses and a peer joins the pending inspector`, async () => {
    let resolve, reads = 0; const seen = [], controller = new AbortController();
    const handle = route.create(() => { reads++; return new Promise(done => { resolve = done; }); }, async (...args) => { seen.push(args); return "saved"; });
    const input = request(route, controller.signal); input.signal.removeEventListener = () => { throw Error("PRIVATE_RETIREMENT_CANARY"); };
    const first = handle(input, "development"); await turn(); controller.abort("PRIVATE_CANCEL_CANARY");
    await response(await first, 409, { error: "request_cancelled" });
    const joined = handle(request(route), "development"); await turn(); assert.equal(reads, 1);
    resolve(held(route)); await response(await joined, 200, held(route)); await turn(); assert.deepEqual(seen, []);
  });
  test(`${route.path}: setup-time cancellation wins over thrown registration without dispatch or logging`, async () => {
    let reads = 0; const seen = [], controller = new AbortController();
    const handle = route.create(async () => { reads++; return held(route); }, async (...args) => { seen.push(args); return "saved"; });
    const input = request(route, controller.signal), add = input.signal.addEventListener.bind(input.signal);
    input.signal.addEventListener = (...args) => { add(...args); controller.abort(); throw Error("PRIVATE_CANCELLED_SETUP"); };
    input.signal.removeEventListener = () => { throw Error("PRIVATE_RETIREMENT_CANARY"); };
    await response(await handle(input, "development"), 409, { error: "request_cancelled" }); await turn();
    assert.equal(reads, 0); assert.deepEqual(seen, []);
  });
}

test("both saved-review observers retain their real 202 running decision when retirement and logging refuse", async () => {
  for (const route of routes.filter(item => item.running)) {
    let notices = 0;
    const handle = route.create(async () => ({ state: "running" }), code => { assert.equal(code, route.code); notices++; throw Error("PRIVATE_LOGGING_CANARY"); });
    const input = request(route); input.signal.removeEventListener = () => { throw Error("PRIVATE_RETIREMENT_CANARY"); };
    await response(await handle(input, "development"), 202, { state: "running" }); await turn(); assert.equal(notices, 1);
  }
});
