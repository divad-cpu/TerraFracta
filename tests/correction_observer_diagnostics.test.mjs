import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { createCorrectionReviewObserver } from "../src/server/correction-review-operation.ts";
import { createSupervisedCorrectionReviewObserver } from "../src/server/supervised-correction-review-operation.ts";
import { correctionReviewExecution, supervisedCorrectionReviewExecution } from "./helpers/correction_review_execution.mjs";

const routes = [
  { code: "correction_review_observer", path: "correction-review", create: (inspect, record) => createCorrectionReviewObserver(inspect, undefined, record), result: correctionReviewExecution },
  { code: "supervised_review_observer", path: "supervised-correction-review", create: createSupervisedCorrectionReviewObserver, result: supervisedCorrectionReviewExecution },
];
const held = { state: "held", reason: "private_test_unavailable" };
const turn = () => new Promise(resolve => setImmediate(resolve));
const request = (route, options = {}) => new Request(`http://127.0.0.1:3000/api/dev/${route.path}`, { headers: { "sec-fetch-site": "same-origin" }, ...options });
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const response = async (value, status, body) => {
  assert.equal(value.status, status); assert.deepEqual(await value.json(), body);
  assert.equal(value.headers.get("cache-control"), "no-store");
  assert.equal(value.headers.get("x-content-type-options"), "nosniff"); assert.equal(value.headers.get("allow"), "GET");
};

for (const route of routes) {
  test(`${route.path}: throwing or malformed shared observations log one fixed operation code without private fields`, async () => {
    for (const inspect of [() => { throw Error("PRIVATE_OBSERVER_CANARY"); },
      async () => ({ state: "checked", result: { ...route.result(), privatePath: "PRIVATE_OBSERVER_CANARY" } }),
      async () => ({ state: "checked", result: { ...route.result(), liveReviewEnabled: true } })]) {
      let reads = 0; const seen = [];
      const handle = route.create(() => { reads++; return inspect(); }, async (...args) => { seen.push(args); return "saved"; });
      const values = await Promise.all([handle(request(route), "development"), handle(request(route), "development")]);
      for (const value of values) await response(value, 200, held);
      await turn(); assert.equal(reads, 1); assert.deepEqual(seen, [[route.code]]);
    }
  });
  test(`${route.path}: production and rejected requests cannot inspect, log or select a private journal`, async () => {
    let reads = 0; const seen = [];
    const handle = route.create(async () => { reads++; return held; }, async code => { seen.push(code); return "saved"; });
    for (const environment of ["production", "test", undefined])
      await response(await handle(new Proxy({}, { get() { assert.fail("Production request accessed"); } }), environment), 404, { error: "not_found" });
    for (const method of ["POST", "PUT", "DELETE", "HEAD"])
      await response(await handle(request(route, { method }), "development"), 405, { error: "method_not_allowed" });
    for (const input of [request(route, { headers: { origin: "https://example.org" } }), request(route, { headers: { "sec-fetch-site": "cross-site" } }),
      new Request(`http://127.0.0.1:3000/api/dev/${route.path}?code=server_route`, { headers: { "sec-fetch-site": "same-origin" } })])
      await response(await handle(input, "development"), 403, { error: "local_origin_required" });
    const controller = new AbortController(); controller.abort("PRIVATE_CANCEL_CANARY");
    await response(await handle(request(route, { signal: controller.signal }), "development"), 409, { error: "request_cancelled" });
    await turn(); assert.equal(reads, 0); assert.deepEqual(seen, []);
    await response(await handle(request(route), "development"), 200, held); await turn(); assert.equal(reads, 1); assert.deepEqual(seen, []);
  });
  test(`${route.path}: valid idle, running, held and checked statuses are silent and leave no abort listeners`, async () => {
    for (const state of [{ state: "idle" }, { state: "running" }, held, { state: "checked", result: route.result() }]) {
      const seen = [], handle = route.create(async () => state, async code => { seen.push(code); return "saved"; });
      const input = request(route); assert.equal(getEventListeners(input.signal, "abort").length, 0);
      await response(await handle(input, "development"), state.state === "running" ? 202 : 200, state);
      assert.equal(getEventListeners(input.signal, "abort").length, 0); await turn(); assert.deepEqual(seen, []);
    }
  });
  test(`${route.path}: midflight cancellation finishes before a late success or failure, silently; next visit rereads`, async () => {
    for (const outcome of ["success", "failure"]) {
      const wait = deferred(), controller = new AbortController(), seen = []; let reads = 0, completed = false;
      const handle = route.create(() => { reads++; return reads === 1 ? wait.promise : Promise.resolve({ state: "idle" }); }, async code => { seen.push(code); return "saved"; });
      const input = request(route, { signal: controller.signal });
      const value = handle(input, "development").then(result => { completed = true; return result; });
      await turn(); assert.equal(reads, 1); controller.abort("PRIVATE_CANCEL_CANARY"); await turn();
      assert.equal(completed, true); await response(await value, 409, { error: "request_cancelled" });
      assert.equal(getEventListeners(input.signal, "abort").length, 0);
      if (outcome === "failure") wait.reject(Error("PRIVATE_LATE_CANARY")); else wait.resolve({ state: "checked", result: route.result() });
      await turn(); assert.deepEqual(seen, []);
      await response(await handle(request(route), "development"), 200, { state: "idle" }); assert.equal(reads, 2);
    }
  });
  test(`${route.path}: cancelled consumer cannot hide or duplicate a shared fault for active consumers`, async () => {
    const wait = deferred(), controller = new AbortController(), seen = []; let reads = 0;
    const handle = route.create(() => { reads++; return wait.promise; }, async (...args) => { seen.push(args); return "saved"; });
    const cancelled = handle(request(route, { signal: controller.signal }), "development");
    const active = [handle(request(route), "development"), handle(request(route), "development")];
    await turn(); controller.abort(); await response(await cancelled, 409, { error: "request_cancelled" });
    wait.reject(Error("PRIVATE_SHARED_CANARY"));
    for (const value of await Promise.all(active)) await response(value, 200, held);
    await turn(); assert.equal(reads, 1); assert.deepEqual(seen, [[route.code]]);
  });
  test(`${route.path}: all cancelled callers retain the pending slot; a later active caller can join it`, async () => {
    const wait = deferred(), a = new AbortController(), b = new AbortController(), seen = []; let reads = 0;
    const handle = route.create(() => { reads++; return wait.promise; }, async code => { seen.push(code); return "saved"; });
    const first = handle(request(route, { signal: a.signal }), "development"), second = handle(request(route, { signal: b.signal }), "development");
    await turn(); a.abort(); b.abort();
    for (const value of await Promise.all([first, second])) await response(value, 409, { error: "request_cancelled" });
    const joined = handle(request(route), "development"); await turn(); assert.equal(reads, 1);
    wait.reject(Error("PRIVATE_JOINED_CANARY")); await response(await joined, 200, held);
    await turn(); assert.deepEqual(seen, [route.code]);
    await response(await handle(request(route), "development"), 200, held); await turn(); assert.equal(reads, 2); assert.deepEqual(seen, [route.code, route.code]);
  });
  test(`${route.path}: an abort at inspector settlement wins over a success or fault and removes the listener`, async () => {
    for (const fault of [false, true]) {
      const wait = deferred(), controller = new AbortController(), seen = [];
      const handle = route.create(() => wait.promise, async code => { seen.push(code); return "saved"; });
      const input = request(route, { signal: controller.signal }), pending = handle(input, "development"); await turn();
      if (fault) wait.reject(Error("PRIVATE_RACE_CANARY")); else wait.resolve({ state: "idle" });
      controller.abort(); await response(await pending, 409, { error: "request_cancelled" }); await turn();
      assert.deepEqual(seen, []); assert.equal(getEventListeners(input.signal, "abort").length, 0);
    }
  });
  test(`${route.path}: logger throws, rejects or stalls without delaying the held outcome or recovery`, { timeout: 1500 }, async () => {
    for (const record of [() => { throw Error("PRIVATE_LOGGER_CANARY"); }, async () => { throw Error("PRIVATE_LOGGER_CANARY"); }, () => new Promise(() => {})]) {
      let calls = 0, good = false;
      const handle = route.create(async () => { if (!good) throw Error("PRIVATE_JOB_CANARY"); return { state: "idle" }; }, code => { calls++; assert.equal(code, route.code); return record(); });
      await response(await handle(request(route), "development"), 200, held); await turn(); assert.equal(calls, 1);
      good = true; await response(await handle(request(route), "development"), 200, { state: "idle" }); await turn(); assert.equal(calls, 1);
    }
  });
}
