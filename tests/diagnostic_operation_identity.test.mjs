import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeDiagnosticEvent, diagnosticEventSchema, diagnosticCodes, diagnosticCodesV3, diagnosticCodesV2, legacyDiagnosticCodes } from "../src/error-diagnostics.ts";
import { buildDiagnosticReport, parseDiagnosticReport, diagnosticSelection, selectDiagnosticEvents } from "../src/diagnostic-report.ts";
import { readDiagnosticExport, DIAGNOSTIC_IMPORT_BYTES } from "../src/diagnostic-import.ts";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { createDevelopmentErrorRecorder } from "../src/server/error-diagnostics.ts";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";
import { createClientErrorReporter } from "../src/client-error-diagnostics.ts";
import { createCurrentCopyScopeObserver } from "../src/server/current-copy-scope.ts";
import { createCurrentParentSourceObserver } from "../src/server/current-parent-source.ts";
import { createCurrentPreparationObserver } from "../src/server/current-private-preparation.ts";
import { createWeeklyRehearsalObserver } from "../src/server/weekly-rehearsal-status.ts";
import { exportErrorLog } from "../scripts/export_error_log.mjs";

const fixed = new Date("2026-10-05T09:00:00.000Z");
const operations = [
  ["copy_scope_observer", "source preparation / observe copy scope", createCurrentCopyScopeObserver, "copy-scope"],
  ["parent_source_observer", "source preparation / compare prepared parent source", createCurrentParentSourceObserver, "parent-source"],
  ["preparation_observer", "source preparation / observe private readiness", createCurrentPreparationObserver, "source-readiness"],
  ["weekly_status_observer", "update rehearsal / observe weekly status", createWeeklyRehearsalObserver, "update-rehearsal/status"],
];
const legacyText = readFileSync(new URL("../fixtures/diagnostics/report-v1.sample.json", import.meta.url), "utf8");
const legacy = () => JSON.parse(legacyText);
const historicalV2Text = readFileSync(new URL("../fixtures/diagnostics/report-v2.sample.json", import.meta.url), "utf8");
const historicalV2 = () => JSON.parse(historicalV2Text);
const event = (code, n = 1) => makeDiagnosticEvent(code, `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`, fixed);
const report = events => buildDiagnosticReport({ events, filesObserved: events.length, unreadable: 0, stable: true, locked: false }, fixed);
const imported = value => readDiagnosticExport(new TextEncoder().encode(JSON.stringify(value)).buffer);
const request = path => new Request(`http://127.0.0.1:3000/api/dev/${path}`, { headers: { "sec-fetch-site": "same-origin" } });

function load(relative) {
  const source = new URL(relative, import.meta.url), native = createRequire(source), exports = {};
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = name => name.startsWith(".") && name.endsWith(".tsx") ? load(new URL(name, source).href) : native(name);
  new Function("require", "exports", compiled)(require, exports);
  return exports;
}

test("fixed operation codes retain closed event shape and server-only provenance", () => {
  for (const [code] of operations) {
    const value = event(code);
    assert.deepEqual(Object.keys(value).sort(), ["code", "eventId", "occurredAt", "origin", "schemaVersion"]);
    assert.equal(value.schemaVersion, 1); assert.equal(value.origin, "server");
    assert.ok(Buffer.byteLength(JSON.stringify(value)) < 512);
    for (const invalid of [{ ...value, origin: "browser" }, { ...value, origin: "worker" }, { ...value, message: "PRIVATE_CANARY" }, { ...value, code: code + "_PRIVATE_CANARY" }])
      assert.equal(diagnosticEventSchema.safeParse(invalid).success, false);
  }
});

test("four real observers persist distinguishable codes through one private store, export and saved reader", { timeout: 2500 }, async () => {
  const parent = await mkdtemp("/tmp/terrafracta-operation-identity-"), directory = join(parent, "log");
  const store = new ErrorLogStore(directory);
  for (const [code, , create, path] of operations) {
    let finish, calls = 0;
    const saved = new Promise(resolve => { finish = resolve; });
    const record = createDevelopmentErrorRecorder(value => store.append(value), () => "development");
    const handle = create(async () => { throw new Error("PRIVATE_CANARY"); }, () => fixed.valueOf(), async value => {
      calls++; const result = await record(value); finish(result); return result;
    });
    const responses = await Promise.all([handle(request(path), "development"), handle(request(path), "development")]);
    for (const response of responses) assert.equal((await response.json()).state, "held");
    assert.equal(await saved, "saved"); assert.equal(calls, 1);
    assert.equal((await store.inspect()).events.filter(value => value.code === code).length, 1);
  }
  const output = join(parent, "export.json"); await exportErrorLog(directory, output);
  const bytes = await readFile(output), parsed = readDiagnosticExport(new Uint8Array(bytes).buffer);
  assert.equal(parsed.schemaVersion, 8); assert.equal(parsed.events.length, 4);
  assert.equal(parsed.counts.server_route, 0); assert.ok(!bytes.toString().includes("PRIVATE_CANARY"));
  for (const [code, location] of operations) {
    const selected = selectDiagnosticEvents(parsed, diagnosticSelection({ code }));
    assert.equal(selected.total, 1); assert.equal(selected.groups.length, 1);
    assert.equal(selected.groups[0].code, code); assert.equal(selected.groups[0].location, location);
  }
});

test("genuine saved v1 export stays readable without attributing historical generic faults to new operations", () => {
  const old = legacy(), original = JSON.stringify(old), value = imported(old);
  assert.equal(value.schemaVersion, 8); assert.equal(value.exportedAt, old.exportedAt);
  assert.deepEqual(value.events, old.events); assert.equal(value.counts.server_route, 1);
  assert.equal(value.counts.update_worker, 1); assert.equal(value.captureCompleteness, "unknown");
  assert.equal(value.buildBinding, "not_bound_to_a_deployed_build");
  for (const [code] of operations) assert.equal(value.counts[code], 0);
  for (const key of ["archiveState", "inspectionComplete", "locked", "filesObserved", "unreadableFiles", "capacityReached"])
    assert.equal(value[key], old[key]);
  assert.equal(JSON.stringify(old), original);
  assert.deepEqual(parseDiagnosticReport(value), value);
});

test("exact historical v1/v2 catalogues normalize in memory without reattributing generic events or rewriting fixtures", () => {
  assert.equal(Object.keys(legacyDiagnosticCodes).length, 14);
  assert.equal(Object.keys(diagnosticCodesV2).length, 18);
  assert.equal(Object.keys(diagnosticCodes).length, 33);
  assert.deepEqual(legacy().locations, legacyDiagnosticCodes);
  assert.deepEqual(historicalV2().locations, diagnosticCodesV2);
  assert.deepEqual(Object.keys(diagnosticCodesV3).filter(code => !Object.hasOwn(diagnosticCodesV2, code)),
    ["saved_run_export", "weekly_assessment_export"]);
  for (const old of [legacy(), historicalV2()]) {
    const original = JSON.stringify(old), value = imported(old);
    assert.equal(value.schemaVersion, 8); assert.equal(value.exportedAt, old.exportedAt);
    assert.deepEqual(value.events, old.events);
    assert.equal(value.counts.saved_run_export, 0); assert.equal(value.counts.weekly_assessment_export, 0);
    for (const [code, count] of Object.entries(old.counts)) assert.equal(value.counts[code], count);
    for (const key of ["archiveState", "inspectionComplete", "locked", "filesObserved", "unreadableFiles", "capacityReached", "captureCompleteness", "buildBinding", "instructions"])
      assert.deepEqual(value[key], old[key]);
    assert.equal(JSON.stringify(old), original); assert.deepEqual(parseDiagnosticReport(value), value);
  }
  assert.equal(readFileSync(new URL("../fixtures/diagnostics/report-v1.sample.json", import.meta.url), "utf8"), legacyText);
  assert.equal(readFileSync(new URL("../fixtures/diagnostics/report-v2.sample.json", import.meta.url), "utf8"), historicalV2Text);
});

test("historical v2 and current v6 refuse added action codes inside old or partial/forged/unknown catalogues", () => {
  const current = report([event("saved_run_export"), event("weekly_assessment_export", 2)]), v2 = historicalV2();
  assert.deepEqual(imported(current), current);
  for (const code of ["saved_run_export", "weekly_assessment_export"]) {
    for (const old of [legacy(), historicalV2()]) {
      const addedEvent = structuredClone(old); addedEvent.events[0] = { ...addedEvent.events[0], code, origin: "browser" };
      const mixedCatalogue = structuredClone(old); mixedCatalogue.locations[code] = diagnosticCodes[code]; mixedCatalogue.counts[code] = 0;
      assert.throws(() => imported(addedEvent)); assert.throws(() => imported(mixedCatalogue));
    }
    const missingCount = structuredClone(current); delete missingCount.counts[code];
    const missingLocation = structuredClone(current); delete missingLocation.locations[code];
    const forgedLocation = structuredClone(current); forgedLocation.locations[code].location = "PRIVATE_CANARY";
    const wrongOrigin = structuredClone(current); wrongOrigin.locations[code].origin = "server";
    for (const invalid of [missingCount, missingLocation, forgedLocation, wrongOrigin]) assert.throws(() => imported(invalid));
    const value = event(code);
    for (const invalid of [{ ...value, origin: "server" }, { ...value, origin: "worker" },
      { ...value, message: "PRIVATE_CANARY" }, { ...value, code: code + "_PRIVATE_CANARY" }])
      assert.equal(diagnosticEventSchema.safeParse(invalid).success, false);
  }
  const unknownEvent = structuredClone(current); unknownEvent.events[0].code = "unknown_download";
  const forgedV2 = structuredClone(v2); forgedV2.locations.weekly_status_observer.location = "PRIVATE_CANARY";
  const wrongV2Count = structuredClone(v2); wrongV2Count.counts.browser_runtime = 2;
  for (const invalid of [{ ...current, schemaVersion: 1 }, { ...current, schemaVersion: 2 }, { ...current, schemaVersion: 9 },
    { ...v2, schemaVersion: 3 }, { ...v2, counts: current.counts }, { ...current, locations: v2.locations },
    { ...v2, privateDetail: "PRIVATE_CANARY" }, unknownEvent, forgedV2, wrongV2Count]) assert.throws(() => imported(invalid));
});

test("current v6 export and exact legacy v1 catalogue refuse mixed, forged and partially upgraded contracts", () => {
  const current = report([event(operations[0][0])]), old = legacy();
  assert.deepEqual(imported(current), current);
  const partial = structuredClone(current); delete partial.counts[operations[1][0]];
  const historicalNew = structuredClone(old); historicalNew.events[0].code = operations[0][0]; historicalNew.counts.server_route = 0;
  const forged = structuredClone(old); forged.locations.server_route.location = "PRIVATE_CANARY";
  const wrongCount = structuredClone(old); wrongCount.counts.server_route = 2;
  for (const invalid of [
    { ...current, schemaVersion: 1 }, { ...old, schemaVersion: 2 }, { ...current, schemaVersion: 2 }, { ...current, schemaVersion: 9 },
    { ...current, counts: old.counts }, { ...old, locations: current.locations }, partial, historicalNew, forged, wrongCount,
    { ...old, privateDetail: "PRIVATE_CANARY" },
  ]) assert.throws(() => imported(invalid));
});

test("legacy v1/v2 missing, locked, partial and capacity evidence keeps its status instead of becoming an upgraded health claim", () => {
  for (const initial of [legacy(), historicalV2()]) for (const changes of [
    { inspectionComplete: false, locked: true },
    { inspectionComplete: false, filesObserved: initial.events.length + 1, unreadableFiles: 1 },
    { inspectionComplete: false, filesObserved: 1000, unreadableFiles: 1000 - initial.events.length, capacityReached: true },
    { archiveState: "missing", inspectionComplete: false, events: [], filesObserved: 0, counts: Object.fromEntries(Object.keys(initial.counts).map(key => [key, 0])) },
  ]) {
    const old = { ...initial, ...changes }, parsed = imported(old);
    for (const key of Object.keys(changes).filter(key => key !== "counts")) assert.deepEqual(parsed[key], old[key]);
    for (const [code, count] of Object.entries(old.counts)) assert.equal(parsed.counts[code], count);
    assert.equal(parsed.captureCompleteness, "unknown"); assert.equal(parsed.buildBinding, "not_bound_to_a_deployed_build");
  }
});

test("action-specific codes are browser-only while unknown, private and production submissions write nothing", async () => {
  const wire = [], writes = [], intake = createDiagnosticIntake(async (code, id) => { writes.push({ code, id }); return "saved"; }, () => 0);
  const client = createClientErrorReporter("development", async (url, options) => {
    assert.equal(url, "/api/dev/error-log"); wire.push(JSON.parse(options.body));
    return intake(new Request("http://127.0.0.1:3000" + url, { ...options,
      headers: { ...options.headers, origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" } }), "development");
  }, () => event("saved_run_export").eventId, () => 0);
  for (const code of ["saved_run_export", "weekly_assessment_export"]) assert.ok(await client(code));
  assert.deepEqual(writes.map(value => value.code), ["saved_run_export", "weekly_assessment_export"]);
  for (const intent of wire) assert.deepEqual(Object.keys(intent).sort(), ["code", "eventId"]);
  assert.equal(await client("unknown_download"), null); assert.equal(wire.length, 2);
  const production = createClientErrorReporter("production", () => assert.fail("Production diagnostic send"));
  for (const code of ["saved_run_export", "weekly_assessment_export"]) assert.equal(await production(code), null);
  for (const body of [JSON.stringify({ eventId: event("saved_run_export").eventId, code: "unknown_download" }),
    JSON.stringify({ eventId: event("saved_run_export").eventId, code: "saved_run_export", message: "PRIVATE_CANARY" })]) {
    const response = await intake(new Request("http://127.0.0.1:3000/api/dev/error-log", { method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }, body }), "development");
    assert.equal(response.status, 400);
  }
  assert.equal(writes.length, 2);
});

test("new server codes cannot be submitted or impersonated by the browser reporter or local intake", async () => {
  let writes = 0, sends = 0;
  const intake = createDiagnosticIntake(async () => { writes++; return "saved"; });
  const client = createClientErrorReporter("development", async () => { sends++; return new Response(null, { status: 204 }); });
  const intent = code => new Request("http://127.0.0.1:3000/api/dev/error-log", { method: "POST", headers: {
    origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    // Same accepted wire grammar as the actual browser reporter.
    body: JSON.stringify({ eventId: event(code).eventId, code }) });
  for (const [code] of operations) {
    assert.equal((await intake(intent(code), "development")).status, 400);
    assert.equal(await client(code), null);
  }
  assert.equal(writes, 0); assert.equal(sends, 0);
  assert.equal((await intake(intent("browser_runtime"), "development")).status, 204);
  assert.ok(await client("browser_runtime"));
  assert.equal(writes, 1); assert.equal(sends, 1);
});

test("current and historical reports render distinct curated function labels and preserve generic history", () => {
  const { DiagnosticWorkspace } = load("../src/diagnostic-workspace-view.tsx");
  const value = report(operations.map(([code], i) => event(code, i + 1)));
  const html = renderToStaticMarkup(createElement(DiagnosticWorkspace, { result: { kind: "available", report: value }, selection: diagnosticSelection({}) }));
  for (const [, location] of operations) assert.ok(html.includes(location));
  const historical = renderToStaticMarkup(createElement(DiagnosticWorkspace, { result: { kind: "available", report: imported(legacy()) }, selection: diagnosticSelection({ code: "server_route" }) }));
  assert.ok(historical.includes("website / route handler")); assert.ok(historical.includes(legacy().events[0].eventId));
});

test("expanded complete export still fits the existing fixed local-file size limit", () => {
  const codes = Object.keys(diagnosticCodes);
  const value = report(Array.from({ length: 1001 }, (_, n) => event(codes[n % codes.length], n + 1)));
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
  assert.ok(bytes.byteLength < DIAGNOSTIC_IMPORT_BYTES);
  assert.equal(readDiagnosticExport(bytes.buffer).events.length, 1001);
  assert.equal(value.capacityReached, true);
});
