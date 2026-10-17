import assert from "node:assert/strict";
import test from "node:test";
import { createFictionalCorrectionWorkflow, fictionalCorrectionFields } from "../src/fictional-correction-workflow.ts";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { fictionalWorkflowFixture, workflowId } from "./helpers/fictional_correction_workflow_fixture.mjs";

async function context(stage, observeFault) {
  const fixture = fictionalWorkflowFixture(), codes = [];
  const workflow = createFictionalCorrectionWorkflow(fixture.backend, { now: () => 0,
    onFault: code => { codes.push(code); observeFault?.(workflow); } });
  await workflow.load();
  if (stage === "review") {
    workflow.prepare("statement", () => workflowId(4));
    await workflow.submit(); await workflow.queue(); await workflow.detail();
  }
  return { fixture, codes, workflow,
    act: freshId => stage === "prepare" ? workflow.prepare("statement", freshId) : workflow.review("in_review", freshId) };
}

for (const stage of ["prepare", "review"]) for (const throws of [false, true]) {
  test(`${stage} identity disposal with throw ${throws} remains retired and quiet`, async () => {
    const v = await context(stage), count = v.fixture.calls.length;
    const result = await v.act(() => {
      v.workflow.dispose();
      if (throws) throw Error("PRIVATE_RETIRED_IDENTITY");
      return workflowId(5);
    });
    assert.equal(result.phase, "disposed"); assert.equal(result.busy, false);
    assert.equal(result.issue, null); assert.equal(result.request, null);
    assert.equal(result.reviewRequest, null); assert.deepEqual(v.codes, []);
    assert.equal(v.fixture.calls.length, count); assert.deepEqual(v.workflow.snapshot(), result);
  });
}

for (const stage of ["prepare", "review"]) test(`${stage} identity reentry cannot replace the explicit outer intent`, async () => {
  const v = await context(stage), count = v.fixture.calls.length; let nested, nestedIds = 0;
  const result = await v.act(() => {
    nested = v.act(() => { nestedIds++; return workflowId(6); });
    return workflowId(5);
  });
  const refused = await nested;
  assert.equal(nestedIds, 0); assert.equal(refused.phase, stage === "prepare" ? "ready" : "detail");
  assert.equal(result.phase, stage === "prepare" ? "prepared" : "reviewed");
  assert.equal((stage === "prepare" ? result.request : result.reviewRequest).requestId ?? result.reviewRequest.eventId, workflowId(5));
  assert.equal(v.fixture.calls.length, count + (stage === "review" ? 1 : 0));
  assert.deepEqual(v.codes, []); v.workflow.dispose();
});

test("changed draft identity cannot submit the previous prepared request during allocation", async () => {
  const v = await context("prepare"); v.workflow.prepare("statement", () => workflowId(4));
  const before = v.workflow.snapshot(); let nested;
  const result = v.workflow.prepare("page", () => { nested = v.workflow.submit(); return workflowId(5); });
  assert.equal((await nested).phase, "prepared"); assert.equal(result.phase, "prepared");
  assert.equal(result.request.requestId, workflowId(5));
  assert.notDeepEqual(result.request.draft.target, before.request.draft.target);
  assert.equal(v.fixture.calls.filter(call => call[0] === "submit").length, 0);
  assert.equal(result.intake, null); assert.equal(result.uncertainWrite, null); v.workflow.dispose();
});

for (const stage of ["prepare", "review"]) test(`${stage} identity fault observer cannot initiate another operation`, async () => {
  let nested;
  const v = await context(stage, workflow => { nested = stage === "prepare" ? workflow.load() : workflow.queue(); });
  const count = v.fixture.calls.length;
  const result = await v.act(() => { throw Error("PRIVATE_IDENTITY_FAILURE"); });
  await nested;
  assert.equal(result.phase, "held"); assert.equal(result.busy, false);
  assert.equal(result.reason, stage === "prepare" ? "unavailable" : "invalid_action");
  assert.deepEqual(v.codes, [`fictional_correction_${stage}`]); assert.equal(v.fixture.calls.length, count);
  assert.doesNotMatch(JSON.stringify(v.codes), /PRIVATE|stack/); v.workflow.dispose();
});

test("ordinary identity preparation preserves same-intent identity and exact review transition", async () => {
  const v = await context("prepare"); const first = v.workflow.prepare("statement", () => workflowId(4));
  const retry = v.workflow.prepare("statement", () => { throw Error("No fresh identity for an identical draft"); });
  assert.deepEqual(retry.request, first.request); await v.workflow.submit(); await v.workflow.queue(); await v.workflow.detail();
  const result = await v.workflow.review("in_review", () => workflowId(5));
  assert.equal(result.phase, "reviewed"); assert.equal(result.reviewReceipt.eventId, workflowId(5));
  assert.equal(result.busy, false); assert.deepEqual(v.codes, []); v.workflow.dispose();
});

function pageRequest(v) {
  const selected = deriveCorrectionTarget({ kind: "issue", issue: v.workflow.snapshot().issue }, null);
  assert.equal(selected.kind, "available");
  return { schemaVersion: 1, requestId: workflowId(5), draft: { target: selected.target, fields: fictionalCorrectionFields } };
}
test("prepared input validation cannot submit an older draft through a getter", async () => {
  const v = await context("prepare"); v.workflow.prepare("statement", () => workflowId(4));
  const input = pageRequest(v); let nested;
  Object.defineProperty(input, "schemaVersion", { enumerable: true, get() { nested = v.workflow.submit(); return 1; } });
  const result = v.workflow.acceptPrepared(input); await nested;
  assert.equal(result.phase, "prepared"); assert.equal(result.request.requestId, workflowId(5));
  assert.equal(result.busy, false); assert.equal(result.intake, null);
  assert.equal(v.fixture.calls.filter(call => call[0] === "submit").length, 0); assert.deepEqual(v.codes, []); v.workflow.dispose();
});
for (const throws of [false, true]) test(`prepared input disposal with throw ${throws} remains retired and quiet`, async () => {
  const v = await context("prepare"), input = pageRequest(v), count = v.fixture.calls.length;
  Object.defineProperty(input, "schemaVersion", { enumerable: true, get() {
    v.workflow.dispose(); if (throws) throw Error("PRIVATE_INPUT_DISPOSAL"); return 1;
  } });
  const result = v.workflow.acceptPrepared(input);
  assert.equal(result.phase, "disposed"); assert.equal(result.request, null); assert.equal(result.busy, false);
  assert.equal(v.fixture.calls.length, count); assert.deepEqual(v.codes, []);
});
test("prepared input fault diagnostics cannot submit the preserved previous draft", async () => {
  let nested;
  const v = await context("prepare", workflow => { nested = workflow.submit(); });
  v.workflow.prepare("statement", () => workflowId(4)); const input = pageRequest(v), before = v.workflow.snapshot().request;
  Object.defineProperty(input, "schemaVersion", { enumerable: true, get() { throw Error("PRIVATE_INPUT_FAULT"); } });
  const result = v.workflow.acceptPrepared(input); await nested;
  assert.equal(result.phase, "held"); assert.equal(result.reason, "invalid_draft"); assert.equal(result.busy, false);
  assert.deepEqual(result.request, before); assert.deepEqual(v.codes, ["fictional_correction_prepare"]);
  assert.equal(v.fixture.calls.filter(call => call[0] === "submit").length, 0); v.workflow.dispose();
});
test("ordinary accepted prepared input dispatches only its exact explicit successor", async () => {
  const v = await context("prepare"); v.workflow.prepare("statement", () => workflowId(4));
  const input = pageRequest(v), prepared = v.workflow.acceptPrepared(input);
  assert.equal(prepared.phase, "prepared"); assert.deepEqual(prepared.request, input);
  const result = await v.workflow.submit(); assert.equal(result.phase, "recorded");
  assert.equal(result.intake.requestId, workflowId(5)); assert.deepEqual(v.codes, []);
  assert.equal(v.fixture.calls.filter(call => call[0] === "submit").length, 1); v.workflow.dispose();
});
