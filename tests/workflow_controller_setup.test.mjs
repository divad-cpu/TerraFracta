import assert from "node:assert/strict";
import test from "node:test";
import { createFictionalCorrectionWorkflow } from "../src/fictional-correction-workflow.ts";
import { fictionalWorkflowFixture, workflowId } from "./helpers/fictional_correction_workflow_fixture.mjs";
const stages = ["current", "submit", "queue", "detail", "review", "recover"];
async function at(stage) {
  const fixture = fictionalWorkflowFixture(), codes = [];
  const workflow = createFictionalCorrectionWorkflow(fixture.backend, { now: () => 0, onFault: code => codes.push(code) });
  if (stage !== "current") { await workflow.load(); workflow.prepare("statement", () => workflowId(4)); }
  if (["queue", "detail", "review", "recover"].includes(stage)) await workflow.submit();
  if (["detail", "review", "recover"].includes(stage)) await workflow.queue();
  if (["review", "recover"].includes(stage)) await workflow.detail();
  if (stage === "recover") { fixture.state.unknownReview = true; await workflow.review("in_review", () => workflowId(5)); codes.length = 0; }
  const action = () => stage === "current" ? workflow.load() : stage === "review" ? workflow.review("in_review", () => workflowId(5)) : workflow[stage]();
  return { fixture, workflow, codes, action };
}
for (const stage of stages) test(`${stage} workflow allocation failure is held before dispatch and preserves original intent and uncertainty`, async t => {
  const v = await at(stage), before = v.workflow.snapshot(), count = v.fixture.calls.length;
  t.mock.method(globalThis, "AbortController", function () { throw Error("PRIVATE_WORKFLOW_ALLOCATION"); });
  const result = await v.action(); assert.equal(result.phase, "held"); assert.equal(result.busy, false);
  assert.equal(result.reason, stage === "submit" || stage === "review" ? "not_dispatched" : "unavailable");
  assert.equal(v.fixture.calls.length, count);
  for (const field of ["issue", "request", "intake", "queue", "detail", "reviewRequest", "uncertainWrite"]) assert.deepEqual(result[field], before[field]);
  assert.deepEqual(v.codes, [`fictional_correction_${stage}`]); assert.doesNotMatch(JSON.stringify(v.codes), /PRIVATE|stack|details/);
  t.mock.restoreAll();
  if (stage === "recover") assert.equal((await v.action()).phase, "recovered");
  else if (["queue", "detail", "review"].includes(stage)) assert.equal((await v.workflow.queue()).phase, "queued");
  else assert.equal((await v.workflow.load()).phase, stage === "submit" ? "prepared" : "ready");
  assert.equal(v.workflow.snapshot().busy, false); v.workflow.dispose();
});
test("constructor-time workflow disposal returns the retired snapshot without dispatch or diagnostic", async t => {
  const v = await at("current");
  t.mock.method(globalThis, "AbortController", function () { v.workflow.dispose(); throw Error("PRIVATE_DISPOSED_ALLOCATION"); });
  assert.equal((await v.action()).phase, "disposed"); assert.deepEqual(v.codes, []); assert.deepEqual(v.fixture.calls, []);
});
test("constructor-time workflow reentry cannot acquire another operation or replace the owned refusal", async t => {
  const v = await at("current"), NativeController = AbortController; let nested;
  t.mock.method(globalThis, "AbortController", function () {
    globalThis.AbortController = NativeController; nested = v.workflow.load(); throw Error("PRIVATE_REENTRANT_ALLOCATION");
  });
  assert.equal((await v.action()).reason, "unavailable"); assert.equal((await nested).phase, "idle");
  assert.deepEqual(v.fixture.calls, []); assert.deepEqual(v.codes, ["fictional_correction_current"]);
  assert.equal((await v.workflow.load()).phase, "ready"); assert.equal(v.fixture.calls.length, 1); v.workflow.dispose();
});
test("native workflow allocation retains explicit ordinary action and released state", async () => {
  const v = await at("current"); assert.equal((await v.action()).phase, "ready");
  assert.equal(v.workflow.snapshot().busy, false); assert.deepEqual(v.codes, []); assert.deepEqual(v.fixture.calls, [["current"]]); v.workflow.dispose();
});
for (const boundary of ["start", "finish", "throw"]) test(`${boundary} clock-time disposal preserves the retired workflow without busy state or diagnostics`, async () => {
  const fixture = fictionalWorkflowFixture(), codes = []; let workflow, calls = 0;
  workflow = createFictionalCorrectionWorkflow(fixture.backend, { now: () => {
    calls++;
    if (boundary !== "finish" || calls === 2) {
      workflow.dispose();
      if (boundary === "throw") throw Error("PRIVATE_CLOCK_DISPOSAL");
    }
    return 0;
  }, onFault: code => codes.push(code) });
  const result = await workflow.load();
  assert.equal(result.phase, "disposed"); assert.equal(result.busy, false);
  assert.equal(result.issue, null); assert.deepEqual(codes, []);
  assert.equal(fixture.calls.length, boundary === "finish" ? 1 : 0);
  assert.deepEqual(workflow.snapshot(), result);
});
for (const refusesAbort of [false, true]) test(`finish-clock cancellation with abort refusal ${refusesAbort} withholds the read without technical diagnostic`, async t => {
  const fixture = fictionalWorkflowFixture(), codes = []; let workflow, calls = 0;
  workflow = createFictionalCorrectionWorkflow(fixture.backend, { now: () => {
    if (++calls === 2) workflow.cancel();
    return 0;
  }, onFault: code => codes.push(code) });
  if (refusesAbort) {
    const NativeController = AbortController;
    t.mock.method(globalThis, "AbortController", function () {
      const controller = new NativeController();
      controller.abort = () => { throw Error("PRIVATE_ABORT_REFUSAL"); };
      return controller;
    });
  }
  const result = await workflow.load();
  assert.equal(result.phase, "held"); assert.equal(result.reason, "cancelled");
  assert.equal(result.issue, null); assert.equal(result.busy, false);
  assert.deepEqual(codes, []); assert.deepEqual(fixture.calls, [["current"]]); workflow.dispose();
});
for (const boundary of ["start", "finish"]) test(`${boundary} clock cancellation followed by throwing retains cancellation precedence`, async () => {
  const fixture = fictionalWorkflowFixture(), codes = []; let workflow, calls = 0;
  workflow = createFictionalCorrectionWorkflow(fixture.backend, { now: () => {
    if (++calls === (boundary === "start" ? 1 : 2)) { workflow.cancel(); throw Error("PRIVATE_CANCELLED_CLOCK"); }
    return 0;
  }, onFault: code => codes.push(code) });
  const result = await workflow.load();
  assert.equal(result.phase, "held"); assert.equal(result.reason, "cancelled");
  assert.equal(result.busy, false); assert.equal(result.issue, null); assert.deepEqual(codes, []);
  assert.equal(fixture.calls.length, boundary === "start" ? 0 : 1); workflow.dispose();
});
