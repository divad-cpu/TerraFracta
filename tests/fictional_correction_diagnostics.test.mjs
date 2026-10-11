import assert from "node:assert/strict";
import test from "node:test";
import { createFictionalCorrectionWorkflow } from "../src/fictional-correction-workflow.ts";
import { fictionalWorkflowFixture, workflowId } from "./helpers/fictional_correction_workflow_fixture.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const operations = [
  ["current", "readCurrent", "fictional_correction_current"],
  ["submit", "submitRequest", "fictional_correction_submit"],
  ["queue", "readQueue", "fictional_correction_queue"],
  ["detail", "readDetail", "fictional_correction_detail"],
  ["review", "reviewReport", "fictional_correction_review"],
  ["recover", "lookupReviewEvent", "fictional_correction_recover"],
];

async function at(operation, dependencies = {}) {
  const fixture = fictionalWorkflowFixture(), faults = [];
  const workflow = createFictionalCorrectionWorkflow(fixture.backend,
    { now: () => 0, onFault: (...values) => { faults.push(values); }, ...dependencies });
  if (operation !== "current") {
    await workflow.load(); workflow.prepare("statement", () => workflowId(4));
  }
  if (["queue", "detail", "review", "recover"].includes(operation)) await workflow.submit();
  if (["detail", "review", "recover"].includes(operation)) await workflow.queue();
  if (["review", "recover"].includes(operation)) await workflow.detail();
  if (operation === "recover") {
    fixture.state.unknownReview = true;
    await workflow.review("in_review", () => workflowId(5));
  }
  const action = () => operation === "current" ? workflow.load()
    : operation === "review" ? workflow.review("in_review", () => workflowId(5))
    : workflow[operation]();
  return { fixture, workflow, faults, action };
}

test("each actual asynchronous port fault reports only its fixed operation identity", async () => {
  for (const [operation, port, code] of operations) for (const synchronous of [false, true]) {
    const value = await at(operation);
    value.fixture.backend[port] = synchronous ? () => { throw Error("PRIVATE_EXCEPTION_BODY"); }
      : async () => { throw Error("PRIVATE_EXCEPTION_BODY"); };
    const state = await value.action();
    assert.equal(state.phase, "held");
    assert.equal(state.reason, operation === "submit" ? "unknown_intake" : operation === "review" ? "unknown_review" : "unavailable");
    assert.deepEqual(value.faults, [[code]]);
    assert.equal(state.busy, false);
    assert.doesNotMatch(JSON.stringify(value.faults), /PRIVATE_|aaaaaaaa|https|stack|details/);
  }
});

test("malformed active wire receipts retain held or unknown outcomes and use the matching fixed identity", async () => {
  for (const [operation, port, code] of operations) {
    const value = await at(operation);
    value.fixture.backend[port] = async () => ({ privateBody: "PRIVATE_RECEIPT_BODY" });
    const state = await value.action();
    assert.equal(state.phase, "held"); assert.deepEqual(value.faults, [[code]]);
    assert.equal(state.reason, operation === "submit" ? "unknown_intake" : operation === "review" ? "unknown_review" : "unavailable");
    if (operation === "submit") assert.equal(state.intake, null);
  }
});

test("preparation and presentation exceptions have distinct identities and cannot change successful work", async () => {
  const value = await at("submit");
  value.workflow.prepare("page", () => { throw Error("PRIVATE_ENTROPY"); });
  assert.equal(value.workflow.snapshot().reason, "unavailable");
  assert.deepEqual(value.faults, [["fictional_correction_prepare"]]);
  const faults = []; let armed = true;
  const fixture = fictionalWorkflowFixture();
  const workflow = createFictionalCorrectionWorkflow(fixture.backend, { now: () => 0,
    onFault: (...args) => faults.push(args), onChange: () => {
      if (armed) { armed = false; throw Error("PRIVATE_PRESENTATION"); }
    } });
  const result = await workflow.load();
  assert.equal(result.phase, "ready"); assert.equal(result.busy, false);
  assert.deepEqual(faults, [["fictional_correction_display"]]);
});

test("active expiry and invalid finish clocks report once without admitting late data", async () => {
  for (const finish of [3_000, -1, NaN, Infinity, () => { throw Error("PRIVATE_CLOCK"); }]) {
    const fixture = fictionalWorkflowFixture(), faults = []; let reads = 0;
    const workflow = createFictionalCorrectionWorkflow(fixture.backend, {
      onFault: (...args) => faults.push(args), now: () => {
        if (reads++ === 0) return 0;
        return typeof finish === "function" ? finish() : finish;
      } });
    const result = await workflow.load();
    assert.equal(result.phase, "held"); assert.equal(result.reason, "unavailable");
    assert.equal(result.issue, null); assert.equal(result.busy, false);
    assert.deepEqual(faults, [["fictional_correction_current"]]);
  }
});

test("owned deadline preserves the pending slot and consumes a late rejection without a second event", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const operation of ["current", "submit"]) {
    const value = await at(operation); let reject;
    value.fixture.backend[operation === "current" ? "readCurrent" : "submitRequest"] = () => new Promise((_, r) => { reject = r; });
    const pending = value.action(); await tick(); t.mock.timers.tick(3_000);
    const result = await pending;
    assert.equal(result.reason, operation === "submit" ? "unknown_intake" : "unavailable");
    assert.equal(result.busy, true); assert.deepEqual(value.faults, [[`fictional_correction_${operation}`]]);
    const before = value.fixture.calls.length;
    await value.action(); assert.equal(value.fixture.calls.length, before);
    reject(Error("PRIVATE_LATE_EXCEPTION")); await tick();
    assert.equal(value.workflow.snapshot().busy, false);
    assert.deepEqual(value.workflow.snapshot().issue, operation === "current" ? null : value.fixture.issue);
    assert.equal(value.workflow.snapshot().intake, null);
    assert.deepEqual(value.faults, [[`fictional_correction_${operation}`]]);
  }
});

test("explicit cancellation takes precedence over a throwing finish clock before and after dispatch", async () => {
  for (const operation of ["current", "submit"]) for (const dispatched of [false, true]) {
    let armed = false, reads = 0;
    const value = await at(operation, { now: () => {
      if (!armed) return 0;
      if (reads++ === 0) return 0;
      throw Error("PRIVATE_CANCELLED_CLOCK");
    } });
    let resolve;
    if (dispatched) value.fixture.backend[operation === "current" ? "readCurrent" : "submitRequest"] = () => new Promise(r => { resolve = r; });
    armed = true;
    const pending = value.action(); if (dispatched) await tick();
    value.workflow.cancel(); const result = await pending;
    assert.equal(result.reason, dispatched && operation === "submit" ? "unknown_intake" : "cancelled");
    assert.deepEqual(value.faults, []); assert.equal(reads, 1);
    if (dispatched) assert.equal(result.busy, true);
    else assert.ok(!value.fixture.calls.some(([port]) => port === (operation === "current" ? "current" : "submit")));
    if (dispatched) resolve({ privateBody: "PRIVATE_LATE_BODY" });
    await tick(); assert.equal(value.workflow.snapshot().busy, false);
    assert.equal(value.workflow.snapshot().intake, null); assert.deepEqual(value.faults, []);
  }
});

test("expected envelopes validation and unobserved recovery remain silent and cannot retry writes", async () => {
  for (const outcome of ["not_dispatched", "unknown"]) {
    const value = await at("submit"); let calls = 0;
    value.fixture.backend.submitRequest = async () => { calls++; return { ...value.fixture.envelope(null), outcome }; };
    const state = await value.action();
    assert.equal(state.reason, outcome === "unknown" ? "unknown_intake" : "not_dispatched");
    assert.deepEqual(value.faults, []);
    if (outcome === "unknown") { await value.action(); assert.equal(calls, 1); }
  }
  const value = await at("recover"); value.fixture.state.observed = false;
  assert.equal((await value.action()).reason, "not_observed");
  value.workflow.acceptPrepared({ secret: "PRIVATE_INVALID_INPUT" });
  await value.workflow.review("closed", () => assert.fail("unsupported transition consumed entropy"));
  assert.deepEqual(value.faults, []);
  const inactive = createFictionalCorrectionWorkflow(undefined, { onFault: () => assert.fail("inactive fault") });
  await inactive.load(); inactive.dispose(); await inactive.submit();
});

test("throwing rejecting and non-settling diagnostic observers preserve the original held outcome", async () => {
  for (const onFault of [() => { throw Error("PRIVATE_LOGGER"); }, () => Promise.reject(Error("PRIVATE_LOGGER")), () => new Promise(() => {})]) {
    const value = await at("submit", { onFault });
    value.fixture.backend.submitRequest = async () => { throw Error("PRIVATE_PORT"); };
    const result = await value.action();
    assert.equal(result.reason, "unknown_intake"); assert.equal(result.intake, null); assert.equal(result.busy, false);
    await tick();
  }
});
