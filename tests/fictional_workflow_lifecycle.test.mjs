import assert from "node:assert/strict";
import test from "node:test";
import { createFictionalCorrectionWorkflow } from "../src/fictional-correction-workflow.ts";
import { fictionalWorkflowFixture, workflowId } from "./helpers/fictional_correction_workflow_fixture.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const stages = [
  ["current", "readCurrent", "current", "fictional_correction_current"],
  ["submit", "submitRequest", "submit", "fictional_correction_submit"],
  ["queue", "readQueue", "queue", "fictional_correction_queue"],
  ["detail", "readDetail", "detail", "fictional_correction_detail"],
  ["review", "reviewReport", "review", "fictional_correction_review"],
  ["recover", "lookupReviewEvent", "recover", "fictional_correction_recover"],
];
async function at(stage, extra = {}) {
  const fixture = fictionalWorkflowFixture(), faults = [];
  const workflow = createFictionalCorrectionWorkflow(fixture.backend,
    { now: () => 0, onFault: (...args) => faults.push(args), ...extra });
  if (stage !== "current") { await workflow.load(); workflow.prepare("statement", () => workflowId(4)); }
  if (["queue", "detail", "review", "recover"].includes(stage)) await workflow.submit();
  if (["detail", "review", "recover"].includes(stage)) await workflow.queue();
  if (["review", "recover"].includes(stage)) await workflow.detail();
  if (stage === "recover") { fixture.state.unknownReview = true; await workflow.review("in_review", () => workflowId(5)); }
  const action = () => stage === "current" ? workflow.load()
    : stage === "review" ? workflow.review("in_review", () => workflowId(5)) : workflow[stage]();
  return { fixture, workflow, faults, action };
}
function ownControllers(t, onCreate = () => {}) {
  const NativeController = globalThis.AbortController, controllers = [];
  t.mock.method(globalThis, "AbortController", class extends NativeController {
    constructor() { super(); controllers.push(this); onCreate(this); }
  });
  return controllers;
}
function refuseRetirement(t, { timer = true, listener = true, onCreate = () => {} } = {}) {
  const clear = globalThis.clearTimeout, set = globalThis.setTimeout, timers = new Set();
  const calls = { clear: 0, remove: 0 };
  const controllers = ownControllers(t, controller => {
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    if (listener) t.mock.method(controller.signal, "removeEventListener", (...args) => {
      calls.remove++; remove(...args); throw Error("INVENTED_PRIVATE_LISTENER_RETIREMENT");
    });
    onCreate(controller);
  });
  if (timer) {
    t.mock.method(globalThis, "setTimeout", (fn, delay, ...args) => {
      const handle = set(fn, delay, ...args);
      if (delay === 3_000) timers.add(handle);
      return handle;
    });
    t.mock.method(globalThis, "clearTimeout", value => {
      clear(value);
      if (timers.delete(value)) { calls.clear++; throw Error("INVENTED_PRIVATE_TIMER_RETIREMENT"); }
    });
  }
  return { calls, controllers };
}

for (const [stage, , port, code] of stages) test(`${stage}: settled result survives independent timer/listener retirement and releases its slot`, async t => {
  const value = await at(stage), callsBefore = value.fixture.calls.length;
  const retirement = refuseRetirement(t);
  const result = await value.action();
  const phase = { current: "ready", submit: "recorded", queue: "queued", detail: "detail", review: "reviewed", recover: "recovered" }[stage];
  assert.equal(result.phase, phase); assert.equal(result.busy, false);
  assert.deepEqual(result, value.workflow.snapshot());
  assert.deepEqual(value.fixture.calls.slice(callsBefore).map(([name]) => name), [port]);
  assert.deepEqual(value.faults, [[code]]);
  assert.deepEqual(retirement.calls, { clear: 1, remove: 1 });
  assert.doesNotMatch(JSON.stringify(value.faults), /INVENTED|PRIVATE|stack|details/);
  t.mock.restoreAll();
  // Read again or advance deliberately; no automatic write replay is allowed.
  const next = stage === "current" ? () => value.workflow.load()
    : stage === "submit" ? () => value.workflow.queue()
    : () => value.workflow.detail();
  const advanced = await next(); assert.equal(advanced.busy, false);
  assert.ok(value.fixture.calls.length > callsBefore + 1);
  assert.equal(value.fixture.calls.filter(([name]) => name === "submit").length, stage === "current" ? 0 : 1);
  assert.equal(value.fixture.state.events.length, ["review", "recover"].includes(stage) ? 1 : 0);
});

test("startup listener or deadline failure dispatches none of the six actual ports and preserves write recovery meaning", async t => {
  for (const [stage, , port, code] of stages) for (const failure of ["listener", "deadline"]) {
    const value = await at(stage), before = value.workflow.snapshot(), calls = value.fixture.calls.length;
    if (failure === "listener") ownControllers(t, controller => t.mock.method(controller.signal, "addEventListener", () => { throw Error("INVENTED_PRIVATE_SETUP"); }));
    else { const set = globalThis.setTimeout; t.mock.method(globalThis, "setTimeout", (fn, delay, ...args) => { if (delay === 3_000) throw Error("INVENTED_PRIVATE_SETUP"); return set(fn, delay, ...args); }); }
    const result = await value.action(); t.mock.restoreAll();
    assert.equal(result.phase, "held"); assert.equal(result.busy, false);
    assert.equal(result.reason, ["submit", "review"].includes(stage) ? "not_dispatched" : "unavailable");
    assert.equal(result.uncertainWrite, before.uncertainWrite);
    assert.deepEqual(result.request, before.request); assert.deepEqual(result.intake, before.intake);
    assert.deepEqual(result.reviewRequest, before.reviewRequest);
    assert.deepEqual(value.faults, [[code]]); assert.equal(value.fixture.calls.length, calls, `${port} dispatched without owned setup`);
    const retry = await value.action();
    // A setup-held read can be invoked explicitly; review needs a fresh detail
    // because review-state controls only admit the previously checked detail.
    if (stage !== "review") assert.equal(retry.busy, false);
    assert.equal(value.fixture.state.events.length, stage === "recover" ? 1 : 0);
  }
});

test("partial registration rolls back before any backend call, retires retained callbacks and reports only once", async t => {
  const value = await at("current"), captured = [];
  const retirement = refuseRetirement(t, { timer: false, onCreate: controller => {
    const add = controller.signal.addEventListener.bind(controller.signal);
    t.mock.method(controller.signal, "addEventListener", (name, listener, ...args) => {
      add(name, listener, ...args); captured.push(listener); throw Error("INVENTED_PRIVATE_PARTIAL_SETUP");
    });
  } });
  const result = await value.action(); t.mock.restoreAll();
  assert.equal(result.reason, "unavailable"); assert.equal(result.busy, false); assert.equal(value.fixture.calls.length, 0);
  assert.deepEqual(value.faults, [["fictional_correction_current"]]); assert.equal(retirement.calls.remove, 1);
  let resolve; value.fixture.backend.readCurrent = () => new Promise(r => { resolve = r; });
  const successor = value.action(); await tick(); captured[0]();
  assert.equal(value.workflow.snapshot().busy, true); assert.equal(value.workflow.snapshot().reason, null);
  resolve(value.fixture.envelope(value.fixture.issue)); assert.equal((await successor).phase, "ready");
});

test("producer rejection plus retirement refusal preserves one held outcome and one fixed fault", async t => {
  for (const [stage, backendPort, , code] of stages) {
    const value = await at(stage);
    value.fixture.backend[backendPort] = async () => { throw Error("INVENTED_PRIVATE_PRODUCER"); };
    refuseRetirement(t);
    const result = await value.action(); t.mock.restoreAll();
    assert.equal(result.busy, false);
    assert.equal(result.reason, stage === "submit" ? "unknown_intake" : stage === "review" ? "unknown_review" : "unavailable");
    assert.deepEqual(value.faults, [[code]]);
    if (["submit", "review"].includes(stage)) {
      assert.equal(result.uncertainWrite, stage === "submit" ? "intake" : "review");
      const calls = value.fixture.calls.length; await value.action(); assert.equal(value.fixture.calls.length, calls);
    }
  }
});

test("cancelled physical work stays owned and silent despite failed abort and retirement until actual settlement", async t => {
  for (const stage of ["current", "submit", "review", "recover"]) {
    const value = await at(stage), port = stages.find(([name]) => name === stage)[1];
    let resolve, dispatches = 0;
    value.fixture.backend[port] = () => { dispatches++; return new Promise(r => { resolve = r; }); };
    const retirement = refuseRetirement(t);
    const pending = value.action(); await tick();
    t.mock.method(retirement.controllers[0], "abort", () => { throw Error("INVENTED_PRIVATE_ABORT"); });
    assert.doesNotThrow(() => value.workflow.cancel());
    const result = await pending; t.mock.restoreAll();
    assert.equal(result.busy, true);
    assert.equal(result.reason, stage === "submit" ? "unknown_intake" : stage === "review" ? "unknown_review" : "cancelled");
    assert.deepEqual(value.faults, []); await value.action(); assert.equal(dispatches, 1);
    resolve({ privateBody: "INVENTED_PRIVATE_LATE_WIRE" }); await tick();
    assert.equal(value.workflow.snapshot().busy, false); assert.deepEqual(value.faults, []);
    assert.equal(value.workflow.snapshot().reviewReceipt, null);
  }
});

test("disposing pending work contains abort/retirement failures and cannot dispatch a successor or expose late data", async t => {
  const value = await at("current"); let reject, dispatches = 0;
  value.fixture.backend.readCurrent = () => { dispatches++; return new Promise((_, r) => { reject = r; }); };
  const retirement = refuseRetirement(t);
  const pending = value.action(); await tick();
  t.mock.method(retirement.controllers[0], "abort", () => { throw Error("INVENTED_PRIVATE_ABORT"); });
  assert.doesNotThrow(() => value.workflow.dispose());
  const result = await pending; t.mock.restoreAll();
  assert.equal(result.phase, "disposed"); assert.equal(result.issue, null); assert.equal(result.busy, false);
  reject(Error("INVENTED_PRIVATE_LATE_FAILURE")); await tick(); await value.action();
  assert.equal(dispatches, 1); assert.deepEqual(value.faults, []);
});

test("deadline resolves its observation even when physical abort refuses and retains unknown write ownership", async t => {
  for (const stage of ["current", "submit"]) {
    const value = await at(stage), port = stage === "current" ? "readCurrent" : "submitRequest";
    let callback, resolve, dispatches = 0;
    const set = globalThis.setTimeout;
    t.mock.method(globalThis, "setTimeout", (fn, ...args) => { callback = fn; return set(fn, ...args); });
    value.fixture.backend[port] = () => { dispatches++; return new Promise(r => { resolve = r; }); };
    const controllers = ownControllers(t);
    const pending = value.action(); await tick();
    t.mock.method(controllers[0], "abort", () => { throw Error("INVENTED_PRIVATE_ABORT"); });
    assert.doesNotThrow(() => callback());
    const result = await pending; t.mock.restoreAll();
    assert.equal(result.reason, stage === "submit" ? "unknown_intake" : "unavailable"); assert.equal(result.busy, true);
    assert.deepEqual(value.faults, [[`fictional_correction_${stage}`]]);
    await value.action(); assert.equal(dispatches, 1);
    resolve({ privateBody: "INVENTED_PRIVATE_LATE_WIRE" }); await tick();
    assert.equal(value.workflow.snapshot().busy, false); assert.equal(value.workflow.snapshot().intake, null);
    assert.deepEqual(value.faults, [[`fictional_correction_${stage}`]]);
  }
});

test("retained deadline callbacks are inert after retirement and cannot cancel later successful work", async t => {
  const value = await at("current"), callbacks = [], set = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, ...args) => { callbacks.push(fn); return set(fn, ...args); });
  assert.equal((await value.action()).phase, "ready");
  let resolve; value.fixture.backend.readCurrent = () => new Promise(r => { resolve = r; });
  const pending = value.action(); await tick(); callbacks[0]();
  assert.equal(value.workflow.snapshot().busy, true); assert.equal(value.workflow.snapshot().reason, null);
  resolve(value.fixture.envelope(value.fixture.issue)); assert.equal((await pending).phase, "ready");
  assert.deepEqual(value.faults, []);
});

test("throwing rejecting or stalled diagnostic observers never replace the successful released result", async t => {
  for (const onFault of [() => { throw Error("INVENTED_PRIVATE_LOGGER"); }, () => Promise.reject(Error("INVENTED_PRIVATE_LOGGER")), () => new Promise(() => {})]) {
    const value = await at("current", { onFault }); refuseRetirement(t);
    const result = await value.action(); t.mock.restoreAll();
    assert.equal(result.phase, "ready"); assert.equal(result.busy, false); assert.deepEqual(result.issue, value.fixture.issue);
    await tick();
  }
});
