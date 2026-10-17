import assert from "node:assert/strict";
import test from "node:test";
import { createFictionalCorrectionWorkflow } from "../src/fictional-correction-workflow.ts";
import { fictionalWorkflowFixture, workflowId } from "./helpers/fictional_correction_workflow_fixture.mjs";

async function detail(onChange = () => {}) {
  const fixture = fictionalWorkflowFixture(), codes = [];
  const workflow = createFictionalCorrectionWorkflow(fixture.backend, { now: () => 0, onFault: code => codes.push(code), onChange });
  await workflow.load(); workflow.prepare("statement", () => workflowId(4));
  await workflow.submit(); await workflow.queue(); await workflow.detail();
  return { fixture, codes, workflow };
}
for (const action of ["dispose", "cancel"]) for (const refusesAbort of [false, true]) {
  test(`review intent ${action} before dispatch with abort refusal ${refusesAbort} cannot reach the backend`, async t => {
    let armed = false, retired = false, v;
    v = await detail(state => {
      if (armed && !retired && state.reviewRequest !== null) { retired = true; v.workflow[action](); }
    });
    if (refusesAbort) {
      const NativeController = AbortController;
      t.mock.method(globalThis, "AbortController", function () {
        const controller = new NativeController(); controller.abort = () => { throw Error("PRIVATE_REVIEW_ABORT"); }; return controller;
      });
    }
    armed = true;
    const result = await v.workflow.review("in_review", () => workflowId(5));
    assert.equal(result.phase, action === "dispose" ? "disposed" : "held");
    if (action === "cancel") assert.equal(result.reason, "cancelled");
    assert.equal(result.uncertainWrite, null);
    // An interrupted return snapshot may precede its original promise's
    // settlement. Check eventual release without freeing the slot early.
    await new Promise(setImmediate); assert.equal(v.workflow.snapshot().busy, false);
    assert.equal(v.fixture.calls.filter(call => call[0] === "review").length, 0);
    assert.equal(v.fixture.state.events.length, 0); assert.deepEqual(v.codes, []);
    v.workflow.dispose();
  });
}
test("ordinary review announces its exact owned intent then dispatches once", async () => {
  let v, announced = 0;
  v = await detail(state => {
    if (state.reviewRequest && state.phase === "detail" && state.busy) {
      announced++; assert.equal(state.reviewRequest.eventId, workflowId(5));
      assert.equal(v.fixture.calls.filter(call => call[0] === "review").length, 0);
    }
  });
  const result = await v.workflow.review("in_review", () => workflowId(5));
  assert.equal(announced, 1); assert.equal(result.phase, "reviewed");
  assert.equal(result.reviewReceipt.eventId, workflowId(5)); assert.equal(result.busy, false);
  assert.equal(v.fixture.calls.filter(call => call[0] === "review").length, 1);
  assert.deepEqual(v.codes, []); v.workflow.dispose();
});
test("cancellation after actual review dispatch retains uncertainty until explicit exact recovery", async () => {
  const v = await detail(); let resolve, sent;
  v.fixture.backend.reviewReport = request => {
    sent = request; v.fixture.calls.push(["review", structuredClone(request)]); v.fixture.record(request);
    return new Promise(r => { resolve = r; });
  };
  const pending = v.workflow.review("in_review", () => workflowId(5));
  await new Promise(setImmediate); assert.ok(resolve); v.workflow.cancel();
  const held = await pending; assert.equal(held.reason, "unknown_review"); assert.equal(held.uncertainWrite, "review");
  assert.equal(held.busy, true); assert.equal(held.reviewRequest.eventId, workflowId(5));
  resolve({ ...v.fixture.envelope(v.fixture.reviewReceipt(sent)), outcome: "confirmed" });
  await new Promise(setImmediate); assert.equal(v.workflow.snapshot().busy, false);
  assert.equal(v.workflow.snapshot().phase, "held");
  const recovered = await v.workflow.recover(); assert.equal(recovered.phase, "recovered");
  assert.equal(recovered.recovery.recordedEvent.eventId, workflowId(5)); assert.equal(recovered.uncertainWrite, null);
  assert.equal(v.fixture.calls.filter(call => call[0] === "review").length, 1);
  assert.deepEqual(v.codes, []); v.workflow.dispose();
});
