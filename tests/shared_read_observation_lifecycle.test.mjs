import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { createSharedReadObservation } from "../src/server/shared-read-observation.ts";

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const refuseRemoval = signal => {
  signal.removeEventListener = () => { throw Error("PRIVATE_RETIREMENT_CANARY"); };
};

test("completed success survives listener retirement failure with one closed fault notice", async () => {
  let reads = 0, faults = 0;
  const observe = createSharedReadObservation(async () => { reads++; return 42; }, value => value, () => { faults++; });
  const controller = new AbortController(); refuseRemoval(controller.signal);
  assert.deepEqual(await observe(controller.signal), { kind: "observed", value: 42 });
  assert.deepEqual({ reads, faults }, { reads: 1, faults: 1 });
});

test("an inspection fault and failed retirement keep one original failure and one notice", async () => {
  let faults = 0;
  const observe = createSharedReadObservation(async () => { throw Error("PRIVATE_INSPECTION_CANARY"); }, value => value, () => { faults++; });
  const controller = new AbortController(); refuseRemoval(controller.signal);
  assert.deepEqual(await observe(controller.signal), { kind: "failed" });
  assert.equal(faults, 1);
});

test("cancelled consumer survives refused removal silently while the physical read stays owned", async () => {
  const work = deferred(); let reads = 0, faults = 0;
  const observe = createSharedReadObservation(() => { reads++; return work.promise; }, value => value, () => { faults++; });
  const controller = new AbortController(); refuseRemoval(controller.signal);
  const first = observe(controller.signal); await turn(); controller.abort("PRIVATE_CANCEL_CANARY");
  assert.deepEqual(await first, { kind: "cancelled" });
  const joined = observe(new AbortController().signal); await turn(); assert.equal(reads, 1);
  work.resolve(7); assert.deepEqual(await joined, { kind: "observed", value: 7 });
  assert.equal(faults, 0);
});

test("listener registration failure returns failed without starting inspection and permits a fresh read", async () => {
  let reads = 0, faults = 0, retired = 0;
  const observe = createSharedReadObservation(async () => { reads++; return 9; }, value => value, () => { faults++; });
  const controller = new AbortController(), remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = () => { throw Error("PRIVATE_STARTUP_CANARY"); };
  controller.signal.removeEventListener = (...args) => { retired++; remove(...args); };
  assert.deepEqual(await observe(controller.signal), { kind: "failed" }); await turn();
  assert.deepEqual({ reads, faults, retired }, { reads: 0, faults: 1, retired: 1 });
  assert.deepEqual(await observe(new AbortController().signal), { kind: "observed", value: 9 });
  assert.deepEqual({ reads, faults }, { reads: 1, faults: 1 });
});

test("a partially installed listener rolls back and setup plus retirement failures report once", async () => {
  for (const refuse of [false, true]) {
    let reads = 0, faults = 0;
    const observe = createSharedReadObservation(async () => { reads++; return 1; }, value => value, () => { faults++; });
    const controller = new AbortController(), add = controller.signal.addEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args) => { add(...args); throw Error("PRIVATE_PARTIAL_STARTUP"); };
    if (refuse) refuseRemoval(controller.signal);
    assert.deepEqual(await observe(controller.signal), { kind: "failed" }); await turn();
    assert.deepEqual({ reads, faults }, { reads: 0, faults: 1 });
    if (!refuse) assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    controller.abort();
    assert.deepEqual(await observe(new AbortController().signal), { kind: "observed", value: 1 });
    assert.deepEqual({ reads, faults }, { reads: 1, faults: 1 });
  }
});

test("cancellation during listener setup prevents dispatch and suppresses setup diagnostics", async () => {
  for (const refuse of [false, true]) {
    let reads = 0, faults = 0;
    const observe = createSharedReadObservation(async () => { reads++; return 1; }, value => value, () => { faults++; });
    const controller = new AbortController(), add = controller.signal.addEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args) => { add(...args); controller.abort(); if (refuse) throw Error("PRIVATE_CANCELLED_SETUP"); };
    refuseRemoval(controller.signal);
    assert.deepEqual(await observe(controller.signal), { kind: "cancelled" }); await turn();
    assert.deepEqual({ reads, faults }, { reads: 0, faults: 0 });
  }
});

test("a failed joining consumer does not cancel or consume the other consumers' shared fault", async () => {
  const work = deferred(); let reads = 0, faults = 0;
  const observe = createSharedReadObservation(() => { reads++; return work.promise; }, value => value, () => { faults++; });
  const active = observe(new AbortController().signal); await turn();
  const broken = new AbortController(); broken.signal.addEventListener = () => { throw Error("PRIVATE_JOIN_SETUP"); };
  assert.deepEqual(await observe(broken.signal), { kind: "failed" }); assert.equal(reads, 1);
  work.reject(Error("PRIVATE_SHARED_FAULT")); assert.deepEqual(await active, { kind: "failed" });
  assert.equal(faults, 2, "the joining setup and the shared inspection are distinct faults");
});

test("two successful consumers share one inspection and deduplicate their retirement faults", async () => {
  const work = deferred(); let reads = 0, faults = 0;
  const observe = createSharedReadObservation(() => { reads++; return work.promise; }, value => value, () => { faults++; });
  const controllers = [new AbortController(), new AbortController()]; controllers.forEach(item => refuseRemoval(item.signal));
  const results = controllers.map(item => observe(item.signal)); await turn(); assert.equal(reads, 1);
  work.resolve("checked");
  for (const value of await Promise.all(results)) assert.deepEqual(value, { kind: "observed", value: "checked" });
  assert.equal(faults, 1);
});

test("retired callbacks cannot cancel a later consumer after failed removal", async () => {
  const work = deferred(); let reads = 0, kept, faults = 0;
  const observe = createSharedReadObservation(() => { reads++; return reads === 1 ? Promise.resolve(1) : work.promise; }, value => value, () => { faults++; });
  const controller = new AbortController(), add = controller.signal.addEventListener.bind(controller.signal);
  controller.signal.addEventListener = (name, callback, options) => { kept = callback; add(name, callback, options); };
  refuseRemoval(controller.signal);
  assert.deepEqual(await observe(controller.signal), { kind: "observed", value: 1 });
  const next = observe(new AbortController().signal); await turn(); kept(); controller.abort();
  work.resolve(2); assert.deepEqual(await next, { kind: "observed", value: 2 });
  assert.deepEqual({ reads, faults }, { reads: 2, faults: 1 });
});

test("a throwing fault observer cannot replace a completed response or a refused startup", async () => {
  let reads = 0;
  const observe = createSharedReadObservation(async () => { reads++; return 3; }, value => value,
    () => { throw Error("PRIVATE_LOGGING_CANARY"); });
  const controller = new AbortController(); refuseRemoval(controller.signal);
  assert.deepEqual(await observe(controller.signal), { kind: "observed", value: 3 });
  const broken = new AbortController(); broken.signal.addEventListener = () => { throw Error("PRIVATE_STARTUP_CANARY"); };
  assert.deepEqual(await observe(broken.signal), { kind: "failed" }); await turn(); assert.equal(reads, 1);
});
