import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { exportWeeklyRehearsal } from "../src/weekly-rehearsal-export.ts";
import { weeklyStatusHarness } from "./helpers/weekly_status_harness.mjs";
import { createClientErrorReporter, observeClientError } from "../src/client-error-diagnostics.ts";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";
import { createDevelopmentErrorRecorder } from "../src/server/error-diagnostics.ts";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { readDiagnosticExport } from "../src/diagnostic-import.ts";
import { diagnosticSelection, selectDiagnosticEvents } from "../src/diagnostic-report.ts";
import { exportErrorLog } from "../scripts/export_error_log.mjs";

function observed() { return { state: "observed", observation: {
  schemaVersion: 1, evidenceKind: "current_local_fictional_weekly_status", observedAt: "2026-10-03T14:36:03.626268+00:00",
  dueAt: "2026-09-28T06:00:00Z", windowKey: "2026-W40", graceMinutes: 60, state: "attention", reason: "run_not_completed",
  coverage: "unknown", totalReceipts: 8, unreadableReceipts: 0, pendingReceipts: 0, realScheduleEnabled: false,
  trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0,
} }; }

test("dated report preserves exact historical assessment without acquiring live evidence or permission", () => {
  const input = observed(), result = exportWeeklyRehearsal(input), value = JSON.parse(result.body);
  assert.equal(result.filename, "terrafracta-weekly-rehearsal-2026-W40.json");
  assert.equal(value.artifactKind, "fictional_weekly_rehearsal_status"); assert.equal(value.historicalObservation, true);
  assert.deepEqual(value.observation, input.observation); assert.ok(result.body.endsWith("\n"));
  assert.match(value.limitation, /No authenticated live run evidence/);
  assert.doesNotMatch(result.body, /privatePath|fingerprint|sourceVersionId|\/home\/dj/);
  assert.deepEqual(exportWeeklyRehearsal(input), result, "export does not substitute a new clock for the observed historical date");
});

test("export refuses held, idle, private fields, grants and contradictory healthy or clock claims", () => {
  for (const input of [{ state: "held", reason: "weekly_rehearsal_unavailable" }, { state: "idle" },
    { ...observed(), privatePath: "private-canary" },
    ...[{ sourceRequests: 1 }, { realScheduleEnabled: true }, { totalReceipts: 0 }, { privateNote: "private-canary" },
      { observedAt: "2026-09-28T05:59:59.999999Z" }].map(change => ({ state: "observed", observation: { ...observed().observation, ...change } }))])
    assert.throws(() => exportWeeklyRehearsal(input));
});

test("actual manual download creates only checked JSON and clears its button/message on refresh", async () => {
  const fetch = globalThis.fetch, document = globalThis.document, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  let resolve, blob, link, clicked = 0, removed = 0, reads = 0; const revoked = [];
  globalThis.fetch = async () => { reads++; return new Promise(done => { resolve = done; }); };
  URL.createObjectURL = value => { blob = value; return "blob:local-weekly-test"; };
  URL.revokeObjectURL = value => revoked.push(value);
  globalThis.document = { createElement(tag) { assert.equal(tag, "a"); link = { click() { clicked++; }, remove() { removed++; } }; return link; },
    body: { append(value) { assert.equal(value, link); } } };
  const codes = [], ui = weeklyStatusHarness(code => codes.push(code));
  try {
    ui.mount(); assert.equal(ui.buttons().length, 1); assert.equal(reads, 0); assert.equal(clicked, 0);
    ui.button().onClick(); resolve(Response.json(observed())); await new Promise(done => setTimeout(done, 0));
    assert.equal(ui.buttons().length, 2); assert.equal(clicked, 0);
    const earlierDownload = ui.buttons()[1].onClick;
    earlierDownload(); assert.equal(clicked, 1); assert.equal(removed, 1); assert.equal(reads, 1);
    assert.equal(link.download, "terrafracta-weekly-rehearsal-2026-W40.json"); assert.equal(blob.type, "application/json");
    assert.deepEqual(JSON.parse(await blob.text()).observation, observed().observation);
    assert.match(ui.markup(), /Download requested/); assert.doesNotMatch(ui.markup(), /file was saved|download completed/);
    ui.button().onClick(); assert.equal(ui.buttons().length, 1); assert.doesNotMatch(ui.markup(), /Download requested/);
    earlierDownload(); assert.equal(clicked, 1, "previous render cannot export while a refresh is pending");
    resolve(Response.json({ state: "held", reason: "weekly_rehearsal_unavailable" })); await new Promise(done => setTimeout(done, 0));
    assert.equal(ui.buttons().length, 1);
    earlierDownload(); assert.equal(clicked, 1, "previous render cannot export after a held refresh");
    assert.deepEqual(codes, [], "successful export and expected retired/held callbacks are not faults");
    await new Promise(done => setTimeout(done, 1_050)); assert.deepEqual(revoked, ["blob:local-weekly-test"]);
  } finally { ui.unmount(); globalThis.fetch = fetch; globalThis.document = document; URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
});

test("a retained download callback cannot run after its page has unmounted", async () => {
  const fetch = globalThis.fetch, create = URL.createObjectURL;
  let urls = 0; globalThis.fetch = async () => Response.json(observed());
  URL.createObjectURL = () => { urls++; return "blob:must-not-exist"; };
  const codes = [], ui = weeklyStatusHarness(code => codes.push(code));
  try {
    ui.mount(); ui.button().onClick(); await new Promise(done => setTimeout(done, 0));
    const earlierDownload = ui.buttons()[1].onClick; ui.unmount(); earlierDownload(); assert.equal(urls, 0);
    assert.deepEqual(codes, []);
  } finally { globalThis.fetch = fetch; URL.createObjectURL = create; }
});

test("download setup failure preserves the dated result without a saved-file claim", async () => {
  const fetch = globalThis.fetch, create = URL.createObjectURL;
  globalThis.fetch = async () => Response.json(observed()); URL.createObjectURL = () => { throw new Error("private-canary"); };
  const codes = [], ui = weeklyStatusHarness(code => {
    codes.push(code); observeClientError(code, () => { throw new Error("private-reporting-canary"); });
  });
  try {
    ui.mount(); ui.button().onClick(); await new Promise(done => setTimeout(done, 0)); ui.buttons()[1].onClick();
    assert.match(ui.markup(), /assessment could not be exported/); assert.match(ui.markup(), /weekly rehearsal did not complete/);
    assert.doesNotMatch(ui.markup(), /private-canary|Download requested/);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(codes, ["weekly_assessment_export"]); assert.doesNotMatch(ui.markup(), /private-reporting-canary/);
  } finally { ui.unmount(); globalThis.fetch = fetch; URL.createObjectURL = create; }
});

test("native weekly assessment export failure reaches its specific private diagnostic record and saved report view", { timeout: 3000 }, async t => {
  const parent = await mkdtemp("/tmp/terrafracta-weekly-export-diagnostic-"), directory = join(parent, "log"),
    output = join(parent, "export.json"), store = new ErrorLogStore(directory), caught = [], wire = [];
  const record = createDevelopmentErrorRecorder(value => store.append(value), () => "development", () => 0),
    intake = createDiagnosticIntake(record, () => 0);
  let finish, reads = 0;
  const accepted = new Promise(resolve => { finish = resolve; });
  const reporter = createClientErrorReporter("development", async (url, options) => {
    assert.equal(url, "/api/dev/error-log"); wire.push(JSON.parse(options.body));
    const response = await intake(new Request("http://127.0.0.1:3000" + url, {
      ...options, headers: { ...options.headers, origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
    }), "development");
    finish(response.status); return response;
  }, () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd", () => 0);
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, "/api/dev/update-rehearsal/status"); reads++; return Response.json(observed());
  });
  t.mock.method(URL, "createObjectURL", () => { throw new Error("PRIVATE_WEEKLY_CANARY"); });
  const ui = weeklyStatusHarness(code => { caught.push(code); observeClientError(code, reporter); });
  try {
    ui.mount(); ui.button().onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.buttons().length, 2); ui.buttons()[1].onClick();
    assert.match(ui.markup(), /assessment could not be exported/); assert.match(ui.markup(), /weekly rehearsal did not complete/);
    assert.doesNotMatch(ui.markup(), /PRIVATE_WEEKLY_CANARY|Download requested/);
    t.diagnostic(JSON.stringify({ privateTemporaryArchive: parent, caughtCodes: caught, statusReads: reads }));
    assert.deepEqual(caught, ["weekly_assessment_export"]);
    assert.equal(await accepted, 204); assert.equal(reads, 1);
    assert.deepEqual(Object.keys(wire[0]).sort(), ["code", "eventId"]);
    const inspection = await store.inspect(); assert.equal(inspection.events.length, 1);
    const event = inspection.events[0], original = await readFile(join(directory, event.eventId + ".json"));
    await exportErrorLog(directory, output);
    const bytes = await readFile(output), parsed = readDiagnosticExport(new Uint8Array(bytes).buffer);
    assert.equal(event.code, "weekly_assessment_export"); assert.equal(event.origin, "browser"); assert.equal(event.schemaVersion, 1);
    assert.deepEqual(Object.keys(event).sort(), ["code", "eventId", "occurredAt", "origin", "schemaVersion"]);
    assert.equal(parsed.counts.weekly_assessment_export, 1); assert.equal(parsed.counts.browser_runtime, 0);
    assert.equal(parsed.captureCompleteness, "unknown"); assert.equal(parsed.buildBinding, "not_bound_to_a_deployed_build");
    assert.ok(!bytes.toString().includes("PRIVATE_WEEKLY_CANARY"));
    assert.deepEqual(await readFile(join(directory, event.eventId + ".json")), original);
    const selection = diagnosticSelection({ code: "weekly_assessment_export", origin: "browser", ref: event.eventId });
    assert.ok(selection); const selected = selectDiagnosticEvents(parsed, selection);
    assert.equal(selected.total, 1); assert.equal(selected.groups[0].location, "update rehearsal / download dated assessment");
    function load(file) {
      const native = createRequire(file), exports = {}, code = ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      new Function("require", "exports", code)(name => {
        if (name.startsWith(".")) { const typed = new URL(name + ".tsx", file), exact = new URL(name, file);
          if (existsSync(typed)) return load(typed); if (name.endsWith(".tsx")) return load(exact); }
        return native(name);
      }, exports); return exports;
    }
    const { DiagnosticWorkspace } = load(new URL("../src/diagnostic-workspace-view.tsx", import.meta.url)),
      html = renderToStaticMarkup(createElement(DiagnosticWorkspace, { result: { kind: "available", report: parsed }, selection }));
    assert.ok(html.includes("update rehearsal / download dated assessment")); assert.ok(html.includes(event.eventId));
    assert.ok(!html.includes("PRIVATE_WEEKLY_CANARY"));
  } finally { ui.unmount(); }
});
