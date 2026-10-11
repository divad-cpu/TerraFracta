import assert from "node:assert/strict";
import test from "node:test";
import { createFictionalCorrectionWorkflow, fictionalCorrectionFields } from "../src/fictional-correction-workflow.ts";
import { inventedClosureNote } from "../src/invented-correction-review.ts";
import { fictionalWorkflowFixture, workflowId } from "./helpers/fictional_correction_workflow_fixture.mjs";
import { editorHarness, elements } from "./helpers/correction_draft_harness.mjs";
const tick = () => new Promise(resolve => setImmediate(resolve));
const create = (fixture = fictionalWorkflowFixture(), deps = {}) => ({ fixture, workflow: createFictionalCorrectionWorkflow(fixture.backend, { onFault: () => {}, ...deps }) });
async function prepared(value = create()) { await value.workflow.load(); value.workflow.prepare("statement", () => workflowId(4)); return value; }
async function detail(value = create()) { await prepared(value); await value.workflow.submit(); await value.workflow.queue(); await value.workflow.detail(); return value; }

test("absent backend remains inactive; no identities, writes or store can be selected", async () => {
  const workflow = createFictionalCorrectionWorkflow(); let ids = 0;
  for (const action of [() => workflow.load(), () => workflow.prepare("page", () => { ids++; return workflowId(4); }),
    () => workflow.submit(), () => workflow.queue(), () => workflow.detail(), () => workflow.review("in_review", () => workflowId(5)), () => workflow.recover()]) {
    await action(); assert.equal(workflow.snapshot().phase, "unconfigured");
  }
  assert.equal(ids, 0); assert.equal(workflow.snapshot().executionId, null);
});
test("fixed fictional target and prepared canonical identity reuse existing helpers, never arbitrary report fields", async () => {
  const { workflow, fixture } = await prepared(); const request = workflow.snapshot().request;
  workflow.prepare("statement", () => { throw new Error("Entropy must not run for same intent"); });
  assert.deepEqual(workflow.snapshot().request, request);
  assert.deepEqual(request.draft.fields, fictionalCorrectionFields);
  for (const changed of [{ ...request, privateData: "private-canary" }, { ...request, draft: { ...request.draft,
    fields: { ...request.draft.fields, details: "An arbitrary real report must remain unsent." } } }]) {
    workflow.acceptPrepared(changed); assert.equal(workflow.snapshot().reason, "invalid_draft");
    assert.equal(fixture.calls.filter(([operation]) => operation === "submit").length, 0);
    await workflow.load();
  }
  workflow.prepare("page", () => workflowId(6)); assert.equal(workflow.snapshot().request.draft.target.claimId, null);
  assert.notEqual(workflow.snapshot().request.requestId, request.requestId);
});
test("actual existing editor callback can supply only its fixed authored fictional request to the workflow", async () => {
  const { workflow, fixture } = create(); await workflow.load();
  const metadata = { schemaVersion: 1, evidenceKind: "connected_fictional_reader", state: "active", generation: 1,
    executionId: fixture.executionId, observedAt: "2026-10-06T15:00:00Z", actualSourceRequests: 0, modelCalls: 0, livePublicationEnabled: false, issue: fixture.issue };
  const harness = editorHarness(metadata), find = (tree, type, suffix) => elements(tree).find(item => item.type === type && (!suffix || item.props.id?.endsWith(suffix)));
  let tree = harness.render(); find(tree, "select", "kind").props.onChange({ target: { value: fictionalCorrectionFields.kind } }); find(tree, "textarea").props.onChange({ target: { value: fictionalCorrectionFields.details } });
  find(tree, "input", "source").props.onChange({ target: { value: fictionalCorrectionFields.sourceUrl } });
  const old = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try { Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => workflowId(4) } });
    tree = harness.render(); elements(tree).find(item => item.type === "button" && item.props.children === "Review draft").props.onClick();
  } finally { Object.defineProperty(globalThis, "crypto", old); }
  const request = harness.states().find(value => value?.requestId && value.draft);
  assert.ok(request); workflow.acceptPrepared(request); assert.equal(workflow.snapshot().phase, "prepared");
  assert.equal(fixture.calls.filter(([operation]) => operation === "submit").length, 0);
  await workflow.submit(); assert.equal(workflow.snapshot().phase, "recorded");
});
test("one coherent simulated port completes exact intake, queue/detail, two events and checked closed history without publication", async () => {
  const { workflow, fixture } = await detail();
  assert.equal(workflow.snapshot().detail.report.reviewState, "new");
  await workflow.review("in_review", () => workflowId(5)); assert.equal(workflow.snapshot().phase, "reviewed");
  assert.equal(workflow.snapshot().detail.report.reviewState, "new", "old detail must not become a current success claim");
  await workflow.detail(); assert.equal(workflow.snapshot().detail.report.reviewState, "in_review");
  await workflow.review("closed", () => workflowId(6)); await workflow.detail();
  const state = workflow.snapshot(); assert.equal(state.detail.report.reviewState, "closed"); assert.equal(state.detail.report.events.length, 2);
  assert.equal(state.intake.reportId, state.detail.report.reportId); assert.equal(state.executionId, fixture.executionId);
  assert.equal(state.issue.publicationId, fixture.issue.publicationId);
  assert.deepEqual(fixture.calls.map(([operation]) => operation), ["current", "submit", "queue", "detail", "review", "detail", "review", "detail"]);
  assert.throws(() => { state.request.draft.fields.details = "private-canary"; });
});
test("foreign execution, real route and unknown display fields cannot yield a prepared or stored report", async () => {
  for (const mutate of [f => f.backend.readCurrent = async () => ({ ...f.envelope(f.issue), executionId: workflowId(55) }),
    f => f.issue.jurisdictionSlug = "norway", f => f.issue.publicationId = workflowId(7), f => f.issue.privatePath = "/tmp/private"]) {
    const fixture = fictionalWorkflowFixture(); mutate(fixture); const { workflow } = create(fixture);
    await workflow.load(); assert.equal(workflow.snapshot().phase, "held"); assert.equal(workflow.snapshot().issue, null);
    workflow.prepare("page", () => workflowId(4)); await workflow.submit(); assert.ok(!fixture.calls.some(([operation]) => operation === "submit"));
  }
});
test("unacknowledged intake preserves one identity and refuses queue, recovery and implicit resubmission", async () => {
  const fixture = fictionalWorkflowFixture(); fixture.state.unknownIntake = true; const { workflow } = await prepared(create(fixture));
  await workflow.submit(); assert.equal(workflow.snapshot().reason, "unknown_intake");
  for (const action of [() => workflow.submit(), () => workflow.load(), () => workflow.queue(), () => workflow.detail(), () => workflow.recover()]) await action();
  assert.equal(workflow.snapshot().reason, "unknown_intake"); assert.equal(workflow.snapshot().intake, null);
  assert.equal(fixture.calls.filter(([operation]) => operation === "submit").length, 1);
});
test("lost confirmed review recovers the earlier event read-only while preserving a separately closed current history", async () => {
  const fixture = fictionalWorkflowFixture(); fixture.state.unknownReview = true; const { workflow } = await detail(create(fixture));
  await workflow.review("in_review", () => workflowId(5)); assert.equal(workflow.snapshot().reason, "unknown_review");
  fixture.record({ schemaVersion: 1, eventId: workflowId(6), reportId: fixture.reportId, expectedState: "in_review", nextState: "closed", resolutionNote: inventedClosureNote });
  await workflow.recover(); const state = workflow.snapshot();
  assert.equal(state.phase, "recovered"); assert.equal(state.recovery.recordedEvent.toState, "in_review");
  assert.equal(state.recovery.current.reviewState, "closed");
  assert.equal(fixture.calls.filter(([operation]) => operation === "review").length, 1);
  assert.equal(fixture.calls.filter(([operation]) => operation === "recover").length, 1);
});
test("not-observed recovery does not grant a safe retry or advance the report", async () => {
  const fixture = fictionalWorkflowFixture(); fixture.state.unknownReview = true; fixture.state.observed = false;
  const { workflow } = await detail(create(fixture)); await workflow.review("in_review", () => workflowId(5)); await workflow.recover();
  assert.equal(workflow.snapshot().reason, "not_observed"); await workflow.review("closed", () => workflowId(6));
  assert.equal(workflow.snapshot().reason, "not_observed"); assert.equal(fixture.calls.filter(([operation]) => operation === "review").length, 1);
});
test("queue/detail identity, expiry and stored-body mismatches are held without restoring stale detail", async () => {
  for (const mutate of [value => value.draft.fields.details = "A different invented body must not be silently substituted.",
    value => value.snapshotId = workflowId(44), value => value.report.reportId = workflowId(44)]) {
    const fixture = fictionalWorkflowFixture(), original = fixture.backend.readDetail;
    fixture.backend.readDetail = async (...args) => { const value = await original(...args); mutate(value.result); return value; };
    const { workflow } = await prepared(create(fixture)); await workflow.submit(); await workflow.queue(); await workflow.detail();
    assert.equal(workflow.snapshot().phase, "held"); assert.equal(workflow.snapshot().detail, null);
  }
  const fixture = fictionalWorkflowFixture(), queue = fixture.backend.readQueue;
  fixture.backend.readQueue = async (...args) => { const value = await queue(...args); value.result.observedAt = value.result.expiresAt; return value; };
  const { workflow } = await prepared(create(fixture)); await workflow.submit(); await workflow.queue(); await workflow.detail();
  assert.equal(workflow.snapshot().queue, null); assert.ok(!fixture.calls.some(([operation]) => operation === "detail"));
});
test("single ownership survives cancelled pending write; late acknowledgment is consumed and never restores intake", async () => {
  const fixture = fictionalWorkflowFixture(); let resolve;
  fixture.backend.submitRequest = request => { fixture.calls.push(["submit", request]); return new Promise(r => { resolve = r; }); };
  const { workflow } = await prepared(create(fixture)); const pending = workflow.submit(); await tick();
  await workflow.submit(); workflow.cancel(); await pending;
  assert.equal(workflow.snapshot().busy, true); assert.equal(workflow.snapshot().reason, "unknown_intake");
  await workflow.queue(); assert.equal(fixture.calls.filter(([operation]) => operation === "submit").length, 1);
  resolve({ ...fixture.envelope(fixture.receipt(workflow.snapshot().request)), outcome: "confirmed" }); await tick();
  assert.equal(workflow.snapshot().busy, false); assert.equal(workflow.snapshot().intake, null); assert.equal(workflow.snapshot().reason, "unknown_intake");
});
test("pre-dispatch cancellation and disposal cannot start storage or revive retired content", async () => {
  const { workflow, fixture } = await prepared(); const pending = workflow.submit(); workflow.cancel(); await pending;
  assert.ok(!fixture.calls.some(([operation]) => operation === "submit")); assert.equal(workflow.snapshot().intake, null);
  workflow.dispose(); await workflow.load(); assert.equal(workflow.snapshot().phase, "disposed"); assert.equal(workflow.snapshot().issue, null);
});
test("malformed write receipt becomes unknown; failing or stalled fault observers cannot mask that result", async () => {
  for (const onFault of [() => { throw new Error("private-canary"); }, () => Promise.reject(new Error("private-canary")), () => new Promise(() => {})]) {
    const fixture = fictionalWorkflowFixture(); fixture.backend.submitRequest = async () => ({ ...fixture.envelope({ secret: "private-canary" }), outcome: "confirmed" });
    const { workflow } = await prepared(create(fixture, { onFault }));
    const result = await Promise.race([workflow.submit(), new Promise(resolve => setTimeout(() => resolve("hung"), 50))]);
    assert.notEqual(result, "hung"); assert.equal(workflow.snapshot().reason, "unknown_intake"); assert.equal(workflow.snapshot().intake, null);
  }
});
