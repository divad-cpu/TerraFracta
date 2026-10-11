// Test-only actual default observer -> in-process handler -> owned private files.
// This script starts no server, makes no network request and runs no database.
import assert from "node:assert/strict";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDiagnosticIntake } from "../../src/server/error-log-intake.ts";
import { createDevelopmentErrorRecorder } from "../../src/server/error-diagnostics.ts";
import { ErrorLogStore } from "../../src/server/error-log-store.ts";
import { exportErrorLog } from "../../scripts/export_error_log.mjs";
import { readDiagnosticExport } from "../../src/diagnostic-import.ts";
import { diagnosticSelection, selectDiagnosticEvents } from "../../src/diagnostic-report.ts";
import { fictionalCorrectionDiagnosticCodes } from "../../src/error-diagnostics.ts";
import { fictionalWorkflowFixture, workflowId } from "./fictional_correction_workflow_fixture.mjs";
import { loadTsx } from "./tsx_loader.mjs";

const parent = process.argv[2];
assert.ok(isAbsolute(parent));
const owner = await lstat(parent);
assert.equal(owner.uid, process.getuid()); assert.equal(owner.mode & 0o777, 0o700);
const directory = join(parent, "log"), store = new ErrorLogStore(directory);
const record = createDevelopmentErrorRecorder(event => store.append(event), () => "development");
const intake = createDiagnosticIntake(record), intents = [];
const originalFetch = globalThis.fetch, originalEnvironment = process.env.NODE_ENV;
let delivered;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/dev/error-log");
  assert.equal(options.credentials, "same-origin"); assert.equal(options.cache, "no-store");
  const intent = JSON.parse(options.body);
  assert.deepEqual(Object.keys(intent).sort(), ["code", "eventId"]);
  const response = await intake(new Request("http://127.0.0.1:3100/api/dev/error-log", {
    ...options, headers: { ...options.headers, origin: "http://127.0.0.1:3100", "sec-fetch-site": "same-origin" },
  }), "development");
  assert.equal(response.status, 204);
  intents.push(intent); delivered(); return response;
};
process.env.NODE_ENV = "development";
// The fresh child imports the actual default reporter only after the explicit
// in-process transport is installed. Production code has no test transport.
const { createFictionalCorrectionWorkflow } = await import("../../src/fictional-correction-workflow.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));
async function target(operation) {
  const fixture = fictionalWorkflowFixture();
  const workflow = createFictionalCorrectionWorkflow(fixture.backend, { now: () => 0 });
  if (operation !== "current") { await workflow.load(); workflow.prepare("statement", () => workflowId(4)); }
  if (["queue", "detail", "review", "recover"].includes(operation)) await workflow.submit();
  if (["detail", "review", "recover"].includes(operation)) await workflow.queue();
  if (["review", "recover"].includes(operation)) await workflow.detail();
  if (operation === "recover") { fixture.state.unknownReview = true; await workflow.review("in_review", () => workflowId(5)); }
  return { fixture, workflow };
}
async function captured(code, action) {
  const pending = new Promise(resolve => { delivered = resolve; });
  const state = await action(); await pending; await tick();
  assert.equal(intents.at(-1).code, code); return state;
}
try {
  for (const [operation, port] of [["current", "readCurrent"], ["submit", "submitRequest"],
    ["queue", "readQueue"], ["detail", "readDetail"], ["review", "reviewReport"], ["recover", "lookupReviewEvent"]]) {
    const { fixture, workflow } = await target(operation);
    fixture.backend[port] = async () => { throw Error("PRIVATE_SOURCE_BODY_MUST_NOT_BE_LOGGED"); };
    const state = await captured(`fictional_correction_${operation}`, () => operation === "current" ? workflow.load()
      : operation === "review" ? workflow.review("in_review", () => workflowId(5)) : workflow[operation]());
    assert.equal(state.phase, "held");
  }
  const prepared = await target("submit");
  await captured("fictional_correction_prepare", () => prepared.workflow.prepare("page", () => { throw Error("PRIVATE_ENTROPY"); }));
  const fixture = fictionalWorkflowFixture(); let armed = true;
  const workflow = createFictionalCorrectionWorkflow(fixture.backend, { now: () => 0, onChange: () => {
    if (armed) { armed = false; throw Error("PRIVATE_RENDER"); }
  } });
  assert.equal((await captured("fictional_correction_display", () => workflow.load())).phase, "ready");
  assert.equal(intents.length, 8);
  const output = join(parent, "export.json"); await exportErrorLog(directory, output);
  const raw = await readFile(output), report = readDiagnosticExport(new Uint8Array(raw).buffer);
  assert.equal(report.schemaVersion, 8); assert.equal(report.events.length, 8);
  assert.equal(report.captureCompleteness, "unknown");
  assert.equal(report.buildBinding, "not_bound_to_a_deployed_build");
  assert.doesNotMatch(raw.toString(), /PRIVATE_|https|sourceUrl|aaaaaaaa|publicationId|executionId|stack|message|sha256/);
  for (const [code, value] of Object.entries(fictionalCorrectionDiagnosticCodes)) {
    const selected = selectDiagnosticEvents(report, diagnosticSelection({ code, origin: "browser" }));
    assert.equal(selected.total, 1); assert.equal(selected.groups[0].location, value.location);
    assert.equal(selected.events[0].eventId, intents.find(intent => intent.code === code).eventId);
    assert.deepEqual(Object.keys(selected.events[0]).sort(), ["code", "eventId", "occurredAt", "origin", "schemaVersion"]);
  }
  const { DiagnosticWorkspace } = loadTsx(new URL("../../src/diagnostic-workspace-view.tsx", import.meta.url));
  const html = renderToStaticMarkup(createElement(DiagnosticWorkspace, {
    result: { kind: "available", report }, selection: diagnosticSelection({}),
  }));
  for (const value of Object.values(fictionalCorrectionDiagnosticCodes)) assert.ok(html.includes(value.location));
  assert.ok(html.includes("Browser reports are unauthenticated"));
  assert.doesNotMatch(html, /PRIVATE_|sourceUrl|aaaaaaaa|publicationId|executionId/);
  await writeFile(join(parent, "WORKSPACE.html"), html, { flag: "wx", mode: 0o600 });
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(output)).mode & 0o777, 0o600);
  const result = { evidenceKind: "actual_default_workflow_diagnostic_in_process_filesystem_chain",
    events: 8, distinctFunctions: 8, codes: Object.keys(fictionalCorrectionDiagnosticCodes),
    reportVersion: 8, browserVerified: false, networkRequests: 0, serversStarted: 0,
    realReports: 0, databaseChanged: false, captureCompleteness: "unknown" };
  await writeFile(join(parent, "RESULT.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(JSON.stringify(result) + "\n");
} finally {
  globalThis.fetch = originalFetch;
  if (originalEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnvironment;
}
