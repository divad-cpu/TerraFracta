import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createFictionalCorrectionWorkflow } from "../src/fictional-correction-workflow.ts";
import { inventedClosureNote } from "../src/invented-correction-review.ts";
import { fictionalWorkflowFixture, workflowId } from "./helpers/fictional_correction_workflow_fixture.mjs";

// Actual fixed Node consumer with an explicitly simulated line channel. This
// exercises final framing/presentation, not PostgreSQL storage or native custody.
test("actual fixed consumer retains recovery at its observed step and final closure as separate presentations", async () => {
  const fixture = fictionalWorkflowFixture(), workflow = createFictionalCorrectionWorkflow(fixture.backend);
  await workflow.load(); workflow.prepare("statement", () => workflowId(4));
  const request = workflow.snapshot().request, ticket = { schemaVersion: 1, snapshotId: null, offset: 0 };
  const detail = { schemaVersion: 1, snapshotId: fixture.snapshotId, reportId: fixture.reportId };
  const start = { schemaVersion: 1, eventId: "c8a11111-1111-4111-8111-111111111111", reportId: fixture.reportId,
    expectedState: "new", nextState: "in_review", resolutionNote: null };
  const close = { ...start, eventId: "c8a22222-2222-4222-8222-222222222222", expectedState: "in_review", nextState: "closed", resolutionNote: inventedClosureNote };
  const frames = [{ schemaVersion: 1, evidenceKind: "owned_fictional_workflow_context", executionId: fixture.executionId, request }];
  frames.push(await fixture.backend.readCurrent(), await fixture.backend.submitRequest(request),
    await fixture.backend.readQueue(ticket), await fixture.backend.readDetail(detail));
  fixture.state.unknownReview = true; frames.push(await fixture.backend.reviewReport(start));
  frames.push(await fixture.backend.lookupReviewEvent(start), await fixture.backend.readDetail(detail));
  fixture.state.unknownReview = false; frames.push(await fixture.backend.reviewReport(close), await fixture.backend.readDetail(detail));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run_fictional_correction_workflow.mjs"],
    { input: frames.map(value => JSON.stringify(value)).join("\n") + "\n", encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  const messages = result.stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(messages.map(message => message.operation), ["current", "submit", "queue", "detail", "review", "recover", "detail", "review", "detail", "complete"]);
  const final = messages.at(-1);
  assert.equal(final.state.detail.report.reviewState, "closed"); assert.equal(final.state.recovery, null);
  assert.equal(final.recovery.state.recovery.current.reviewState, "in_review");
  assert.equal(final.recovery.state.recovery.recordedEvent.sequence, 1);
  assert.ok(final.recovery.html.includes("Read-only event recovery"));
  assert.ok(final.html.includes("Confirmed historical review event"));
  assert.ok(!final.html.includes("Read-only event recovery"));
  assert.equal(final.checks.browserVerified, false);
});
