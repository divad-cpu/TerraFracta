// Fresh native child: actual view/default observer -> in-process intake -> owned files.
// No server, network request, primary archive, provider or database is used.
import assert from "node:assert/strict";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorLogStore } from "../../src/server/error-log-store.ts";
import { createDevelopmentErrorRecorder } from "../../src/server/error-diagnostics.ts";
import { createDiagnosticIntake } from "../../src/server/error-log-intake.ts";
import { exportErrorLog } from "../../scripts/export_error_log.mjs";
import { readDiagnosticExport } from "../../src/diagnostic-import.ts";
import { diagnosticSelection, selectDiagnosticEvents } from "../../src/diagnostic-report.ts";
import { capturedScopeDraftContext } from "../../src/server/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./proposal_fixture.mjs";
import { scopeDraftHarness } from "./scope_draft_harness.mjs";
import { loadTsx } from "./tsx_loader.mjs";

const parent = process.argv[2]; assert.ok(isAbsolute(parent));
const owner = await lstat(parent); assert.equal(owner.uid, process.getuid()); assert.equal(owner.mode & 0o777, 0o700);
const directory = join(parent, "log"), store = new ErrorLogStore(directory);
const intake = createDiagnosticIntake(createDevelopmentErrorRecorder(value => store.append(value), () => "development"));
const wire = []; let finish;
const delivered = new Promise(resolve => { finish = resolve; });
const priorFetch = globalThis.fetch, priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/dev/error-log"); assert.equal(options.cache, "no-store"); assert.equal(options.credentials, "same-origin");
  const intent = JSON.parse(options.body); assert.deepEqual(Object.keys(intent).sort(), ["code", "eventId"]);
  const response = await intake(new Request("http://127.0.0.1:3100" + url, { ...options,
    headers: { ...options.headers, origin: "http://127.0.0.1:3100", "sec-fetch-site": "same-origin" } }), "development");
  assert.equal(response.status, 204); wire.push(intent); finish(); return response;
};
Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement() { throw Error("PRIVATE_EXCEPTION_CANARY"); } } });
try {
  assert.equal(process.env.NODE_ENV, "development");
  const h = scopeDraftHarness(capturedScopeDraftContext(proposalReport())); h.mount();
  const field = (tag, suffix) => h.nodes().find(row => row.type === tag && row.props.id?.endsWith(suffix));
  const button = label => h.nodes().find(row => row.type === "button" && row.props.children === label);
  field("textarea", "-population-wording").props.onChange({ currentTarget: { value: "PRIVATE_WORDING_CANARY" } });
  field("select", "-population-references").props.onChange({ currentTarget: { selectedOptions: [{ value: `${proposalId(3)}:2` }] } });
  button("Review scope draft").props.onClick(); button("Download scope preparation").props.onClick();
  await delivered; await new Promise(resolve => setImmediate(resolve));
  assert.equal(wire.length, 1); assert.equal(wire[0].code, "scope_draft_export");
  assert.equal(field("textarea", "-population-wording").props.value, "PRIVATE_WORDING_CANARY");
  const output = join(parent, "export.json"); await exportErrorLog(directory, output);
  const raw = await readFile(output), report = readDiagnosticExport(new Uint8Array(raw).buffer);
  assert.equal(report.schemaVersion, 9); assert.equal(report.events.length, 1); assert.equal(report.counts.scope_draft_export, 1);
  assert.equal(report.captureCompleteness, "unknown"); assert.equal(report.buildBinding, "not_bound_to_a_deployed_build");
  assert.doesNotMatch(raw.toString(), /PRIVATE_|filename|captureId|proposalId|sourceUrl|stack|message/);
  const selection = diagnosticSelection({ code: "scope_draft_export", origin: "browser" });
  assert.equal(selectDiagnosticEvents(report, selection).events[0].eventId, wire[0].eventId);
  const { DiagnosticWorkspace } = loadTsx(new URL("../../src/diagnostic-workspace-view.tsx", import.meta.url));
  const html = renderToStaticMarkup(createElement(DiagnosticWorkspace, { result: { kind: "available", report }, selection }));
  assert.ok(html.includes("editorial preview / download scope preparation")); assert.ok(html.includes(wire[0].eventId));
  assert.doesNotMatch(html, /PRIVATE_|filename|captureId|proposalId|sourceUrl/);
  await writeFile(join(parent, "WORKSPACE.html"), html, { flag: "wx", mode: 0o600 });
  assert.equal((await lstat(directory)).mode & 0o777, 0o700); assert.equal((await lstat(output)).mode & 0o777, 0o600);
  const result = { evidenceKind: "actual_scope_export_default_observer_in_process_filesystem_chain", events: 1,
    reportVersion: 9, browserVerified: false, networkRequests: 0, serversStarted: 0, databaseChanged: false,
    captureCompleteness: "unknown" };
  await writeFile(join(parent, "RESULT.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(JSON.stringify({ ownedTemporaryDirectory: parent, ...result }) + "\n");
} finally {
  globalThis.fetch = priorFetch;
  if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument); else delete globalThis.document;
}
