import assert from "node:assert/strict";
import test from "node:test";
import { createFictionalCorrectionWorkflow } from "../src/fictional-correction-workflow.ts";
import { fictionalWorkflowFixture, workflowId } from "./helpers/fictional_correction_workflow_fixture.mjs";

async function target() {
  const fixture = fictionalWorkflowFixture(); let faults = 0;
  const workflow = createFictionalCorrectionWorkflow(fixture.backend, { onFault: () => { faults++; } });
  const loaded = await workflow.load();
  return { fixture, workflow, loaded, faults: () => faults };
}

test("awaited successful actions return their released observable state", async () => {
  const { workflow, loaded } = await target();
  assert.equal(loaded.busy, false); assert.deepEqual(loaded, workflow.snapshot());
  workflow.prepare("statement", () => workflowId(4));
  for (const action of [() => workflow.submit(), () => workflow.queue(), () => workflow.detail(),
    () => workflow.review("in_review", () => workflowId(5)), () => workflow.detail(),
    () => workflow.review("closed", () => workflowId(6)), () => workflow.detail()]) {
    const result = await action();
    assert.equal(result.busy, false); assert.deepEqual(result, workflow.snapshot());
  }
});

test("existing-editor composition preserves a canonical unsent intent across fresh supplied identities", async () => {
  const { workflow } = await target();
  workflow.prepare("statement", () => workflowId(4)); const original = workflow.snapshot().request;
  const result = workflow.acceptPrepared({ ...original, requestId: workflowId(99) });
  assert.deepEqual(result.request, original);
  const page = { ...original, requestId: workflowId(7), draft: { ...original.draft,
    target: { ...original.draft.target, claimId: null } } };
  assert.equal(workflow.acceptPrepared(page).request.requestId, workflowId(7));
  const reusedChanged = { ...original, requestId: workflowId(7) };
  assert.equal(workflow.acceptPrepared(reusedChanged).reason, "invalid_draft");
  assert.equal(workflow.snapshot().request.requestId, workflowId(7));
});

test("expected unsupported review transitions consume no identity, log no unexpected fault and dispatch no write", async () => {
  for (const invalid of ["closed", "unexpected_state"]) {
    const { workflow, fixture, faults } = await target(); let ids = 0;
    workflow.prepare("statement", () => workflowId(4)); await workflow.submit(); await workflow.queue(); await workflow.detail();
    const result = await workflow.review(invalid, () => { ids++; return workflowId(5); });
    assert.equal(result.reason, "invalid_action"); assert.equal(ids, 0); assert.equal(faults(), 0);
    assert.equal(fixture.calls.filter(([operation]) => operation === "review").length, 0);
  }
});
