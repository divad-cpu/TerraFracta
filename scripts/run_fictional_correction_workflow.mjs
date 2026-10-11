// Fixed native coordinator consumer. JSON lines contain invented commands only;
// credentials, roles, paths and SQL remain with the owned Python custodian.
import { createInterface } from "node:readline";
import { z } from "zod";
import { createFictionalCorrectionWorkflow } from "../src/fictional-correction-workflow.ts";
import { correctionRequestSchema } from "../src/correction-request.ts";
import { loadTsx } from "../tests/helpers/tsx_loader.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

if (process.argv.length !== 2) throw new Error("Fixed workflow consumer takes no arguments");
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
async function receive() {
  const next = await lines.next();
  if (next.done || Buffer.byteLength(next.value) > 65_536) throw new Error("Fixed workflow channel unavailable");
  return JSON.parse(next.value);
}
const initial = z.strictObject({ schemaVersion: z.literal(1), evidenceKind: z.literal("owned_fictional_workflow_context"),
  executionId: z.uuid(), request: correctionRequestSchema }).parse(await receive());
const rpc = async (operation, request = null) => {
  process.stdout.write(JSON.stringify({ operation, request }) + "\n");
  return receive();
};
const backend = { executionId: initial.executionId, readCurrent: () => rpc("current"),
  submitRequest: request => rpc("submit", request), readQueue: request => rpc("queue", request),
  readDetail: request => rpc("detail", request), reviewReport: request => rpc("review", request),
  lookupReviewEvent: request => rpc("recover", request) };
const faults = [];
const workflow = createFictionalCorrectionWorkflow(backend, { onFault: () => { faults.push("fixed_workflow_fault"); } });
function requireState(phase) { if (workflow.snapshot().phase !== phase) throw new Error("Fixed workflow step held"); }
// Exact source presenter compiled in memory; no Browser, DOM or hydration.
const View = loadTsx(new URL("../src/fictional-correction-workflow-view.tsx", import.meta.url)).FictionalCorrectionWorkflowView;
const display = state => renderToStaticMarkup(createElement(View, { state }));
await workflow.load(); requireState("ready");
workflow.acceptPrepared(initial.request); requireState("prepared");
await workflow.submit(); requireState("recorded");
await workflow.queue(); requireState("queued");
await workflow.detail(); requireState("detail");
await workflow.review("in_review", () => "c8a11111-1111-4111-8111-111111111111");
if (workflow.snapshot().reason !== "unknown_review") throw new Error("Fixed lost review reply did not hold");
await workflow.recover(); requireState("recovered");
const recoveryState = workflow.snapshot(), recoveryHtml = display(recoveryState);
if (recoveryState.recovery.current.reviewState !== "in_review" || !recoveryHtml.includes("Read-only event recovery"))
  throw new Error("Fixed observed recovery presentation differs");
await workflow.detail(); requireState("detail");
if (workflow.snapshot().detail.report.reviewState !== "in_review") throw new Error("Recovered report detail differs");
await workflow.review("closed", () => "c8a22222-2222-4222-8222-222222222222"); requireState("reviewed");
await workflow.detail(); requireState("detail");
const state = workflow.snapshot();
if (state.detail.report.reviewState !== "closed" || state.detail.report.events.length !== 2 || faults.length !== 0)
  throw new Error("Fixed workflow closure differs");
const html = display(state);
for (const text of ["Confirmed private intake receipt", "Bounded private queue", "Last checked report detail", "Confirmed historical review event", "closed"])
  if (!html.includes(text)) throw new Error("Fixed workflow presenter differs");
process.stdout.write(JSON.stringify({ operation: "complete", state,
  checks: { sameExecution: true, fixedEditorRequest: true, historicalRecovery: true, twoEvents: true,
    actualPresenter: true, recoveryPresenterAtObservedStep: true, browserVerified: false, realReports: 0, publicationChangedByReport: false }, html, recovery: { state: recoveryState, html: recoveryHtml } }) + "\n");
