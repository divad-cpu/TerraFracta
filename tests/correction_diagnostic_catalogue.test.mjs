import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { diagnosticCodes, diagnosticCodesV5, diagnosticCodesV4, diagnosticCodesV3, diagnosticCodesV2, legacyDiagnosticCodes, diagnosticEventSchema, makeDiagnosticEvent } from "../src/error-diagnostics.ts";
import { buildDiagnosticReport, parseDiagnosticReport, diagnosticSelection, selectDiagnosticEvents } from "../src/diagnostic-report.ts";
import { readDiagnosticExport } from "../src/diagnostic-import.ts";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { createDevelopmentErrorRecorder } from "../src/server/error-diagnostics.ts";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";
import { createClientErrorReporter } from "../src/client-error-diagnostics.ts";
import { createCorrectionReviewObserver } from "../src/server/correction-review-operation.ts";
import { createSupervisedCorrectionReviewObserver } from "../src/server/supervised-correction-review-operation.ts";
import { exportErrorLog } from "../scripts/export_error_log.mjs";

const operations = [
  ["correction_review_observer", "correction review / observe saved review", (inspect, record) => createCorrectionReviewObserver(inspect, undefined, record), "correction-review"],
  ["supervised_review_observer", "correction review / observe supervised saved review", createSupervisedCorrectionReviewObserver, "supervised-correction-review"],
];
const paths = [1, 2, 3, 4].map(version => new URL(`../fixtures/diagnostics/report-v${version}.sample.json`, import.meta.url));
const originals = paths.map(path => readFileSync(path));
const historical = () => originals.map(bytes => JSON.parse(bytes));
const uuid = n => "00000000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
const event = (code, n = 1) => makeDiagnosticEvent(code, uuid(n), new Date("2026-10-05T18:09:00.000Z"));
const report = events => buildDiagnosticReport({ events, filesObserved: events.length, unreadable: 0, stable: true, locked: false });
const decode = input => readDiagnosticExport(new TextEncoder().encode(JSON.stringify(input)).buffer);
function load(source) {
  const native = createRequire(source), exports = {};
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", compiled)(name => {
    if (name.startsWith(".")) {
      const candidate = new URL(name.endsWith(".tsx") ? name : name + ".tsx", source);
      if (existsSync(candidate)) return load(candidate);
    }
    return native(name);
  }, exports);
  return exports;
}
const { DiagnosticWorkspace } = load(new URL("../src/diagnostic-workspace-view.tsx", import.meta.url));

// Use the actual handler -> recorder -> filesystem -> exporter -> import -> React
// path. Only the private interpreter boundary supplies an invented failure.
test("both actual review observers persist distinct identities through the existing private export and view", { timeout: 3000 }, async t => {
  const parent = await mkdtemp("/tmp/terrafracta-correction-diagnostic-"), directory = join(parent, "log");
  const store = new ErrorLogStore(directory), record = createDevelopmentErrorRecorder(value => store.append(value), () => "development");
  for (const [code, , create, path] of operations) {
    let resolve, calls = 0; const saved = new Promise(done => { resolve = done; });
    const handle = create(async () => { throw Error("PRIVATE_SQL_JOURNAL_CANARY"); }, async value => {
      calls++; assert.equal(value, code); const result = await record(value); resolve(result); return result;
    });
    const request = () => new Request(`http://127.0.0.1:3000/api/dev/${path}`, { headers: { "sec-fetch-site": "same-origin" } });
    const responses = await Promise.all([handle(request(), "development"), handle(request(), "development")]);
    for (const response of responses) assert.deepEqual(await response.json(), { state: "held", reason: "private_test_unavailable" });
    assert.equal(await saved, "saved"); assert.equal(calls, 1);
  }
  const generic = event("server_route", 100); assert.equal(await store.append(generic), "saved");
  const before = await store.inspect(); assert.equal(before.events.length, 3); assert.equal(before.unreadable, 0);
  const bytesBefore = await Promise.all(before.events.map(value => readFile(join(directory, value.eventId + ".json"))));
  const output = join(parent, "export.json"); await exportErrorLog(directory, output);
  const bytes = await readFile(output), exported = JSON.parse(bytes), imported = readDiagnosticExport(new Uint8Array(bytes).buffer);
  assert.equal(exported.schemaVersion, 8); assert.equal(Object.keys(exported.locations).length, 33); assert.deepEqual(imported, exported);
  assert.equal((await lstat(directory)).mode & 0o777, 0o700); assert.equal((await lstat(output)).mode & 0o777, 0o600);
  for (const [code, location] of operations) {
    const selection = diagnosticSelection({ code, origin: "server" }), selected = selectDiagnosticEvents(imported, selection);
    assert.equal(selected.total, 1); assert.equal(selected.groups[0].location, location); assert.equal(imported.counts[code], 1);
    const saved = selected.events[0]; assert.equal(saved.origin, "server");
    assert.deepEqual(Object.keys(saved).sort(), ["code", "eventId", "occurredAt", "origin", "schemaVersion"]);
    assert.equal((await lstat(join(directory, saved.eventId + ".json"))).mode & 0o777, 0o600);
    const html = renderToStaticMarkup(createElement(DiagnosticWorkspace, { result: { kind: "available", report: imported }, selection }));
    assert.ok(html.includes(`value="${code}"`)); assert.ok(html.includes(location)); assert.ok(html.includes(saved.eventId));
    assert.ok(html.includes("1 matching record; 1 function")); assert.ok(!html.includes(generic.eventId));
    assert.equal(selectDiagnosticEvents(imported, diagnosticSelection({ code, origin: "browser" })).total, 0);
  }
  assert.deepEqual(selectDiagnosticEvents(imported, diagnosticSelection({ code: "server_route" })).events, [generic]);
  assert.equal(imported.captureCompleteness, "unknown"); assert.equal(imported.buildBinding, "not_bound_to_a_deployed_build");
  assert.doesNotMatch(bytes.toString(), /PRIVATE_|SQL_JOURNAL|password|stack/);
  for (const [index, value] of before.events.entries()) assert.deepEqual(await readFile(join(directory, value.eventId + ".json")), bytesBefore[index]);
  t.diagnostic(JSON.stringify({ ownedTemporaryDirectory: parent, privateExport: output, events: 3 }));
});

test("exact genuine v1/v2/v3/v4 reports retain all original bytes, attribution and uncertainty when read by v6", () => {
  const catalogues = [legacyDiagnosticCodes, diagnosticCodesV2, diagnosticCodesV3, diagnosticCodesV4];
  assert.deepEqual(Object.keys(diagnosticCodesV5).filter(code => !Object.hasOwn(diagnosticCodesV4, code)), operations.map(([code]) => code));
  assert.equal(Object.keys(diagnosticCodesV4).length, 21);
  assert.equal(createHash("sha256").update(originals[3]).digest("hex"), "bf82253e123a7f4d880dd8b4981a11e794f634be2d0c73c496e3cd6f7350e427");
  for (const [index, old] of historical().entries()) {
    assert.deepEqual(old.locations, catalogues[index]); const before = JSON.stringify(old), current = decode(old);
    assert.equal(current.schemaVersion, 8); assert.deepEqual(parseDiagnosticReport(current), current);
    for (const key of ["events", "exportedAt", "archiveState", "inspectionComplete", "locked", "filesObserved", "unreadableFiles", "capacityReached", "captureCompleteness", "buildBinding", "instructions"])
      assert.deepEqual(current[key], old[key]);
    for (const [code, count] of Object.entries(old.counts)) assert.equal(current.counts[code], count);
    for (const [code] of operations) assert.equal(current.counts[code], 0);
    assert.equal(JSON.stringify(old), before); assert.deepEqual(readFileSync(paths[index]), originals[index]);
    assert.equal(current.counts.server_route, old.counts.server_route);
  }
});

test("historical v4 missing, locked, partial and capacity states are preserved without implying health", () => {
  const initial = historical()[3];
  for (const changes of [{ locked: true, inspectionComplete: false },
    { unreadableFiles: 1, filesObserved: initial.events.length + 1, inspectionComplete: false },
    { unreadableFiles: 1000 - initial.events.length, filesObserved: 1000, capacityReached: true, inspectionComplete: false },
    { archiveState: "missing", events: [], counts: Object.fromEntries(Object.keys(initial.counts).map(key => [key, 0])), filesObserved: 0, inspectionComplete: false }]) {
    const value = { ...initial, ...changes }, current = decode(value);
    for (const key of Object.keys(changes).filter(key => key !== "counts")) assert.deepEqual(current[key], value[key]);
    assert.equal(current.captureCompleteness, "unknown"); assert.equal(current.buildBinding, "not_bound_to_a_deployed_build");
    for (const [code] of operations) assert.equal(current.counts[code], 0);
  }
});

test("v6 refuses new events inside old reports and partial, forged, mixed or unknown report contracts", () => {
  for (const [code] of operations) {
    const current = report([event(code)]); assert.deepEqual(decode(current), current);
    for (const old of historical()) {
      const laterEvent = structuredClone(old); laterEvent.events[0] = event(code);
      const laterCatalogue = structuredClone(old); laterCatalogue.locations[code] = diagnosticCodes[code]; laterCatalogue.counts[code] = 0;
      for (const bad of [laterEvent, laterCatalogue, { ...current, schemaVersion: old.schemaVersion }, { ...old, schemaVersion: 6 }]) assert.throws(() => decode(bad));
    }
    const missingCount = structuredClone(current); delete missingCount.counts[code];
    const missingLocation = structuredClone(current); delete missingLocation.locations[code];
    const wrongLocation = structuredClone(current); wrongLocation.locations[code].location = "PRIVATE_LABEL_CANARY";
    const wrongOrigin = structuredClone(current); wrongOrigin.locations[code].origin = "browser";
    const wrongCount = structuredClone(current); wrongCount.counts[code] = 0;
    const unknown = structuredClone(current); unknown.events[0].code = "correction_private_journal";
    for (const bad of [missingCount, missingLocation, wrongLocation, wrongOrigin, wrongCount, unknown,
      { ...current, schemaVersion: 9 }, { ...current, privatePath: "PRIVATE_PATH_CANARY" }]) assert.throws(() => decode(bad));
  }
});

test("new server-only identities refuse valid browser intake grammar, extra fields and production persistence", async () => {
  let writes = 0, sends = 0;
  const intake = createDiagnosticIntake(async () => { writes++; return "saved"; });
  const client = createClientErrorReporter("development", async () => { sends++; return new Response(null, { status: 204 }); });
  const request = code => new Request("http://127.0.0.1:3000/api/dev/error-log", { method: "POST", headers: {
    origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify({ eventId: uuid(1), code }) });
  for (const [code] of operations) {
    assert.match(code, /^[a-z_]{1,32}$/); assert.equal((await intake(request(code), "development")).status, 400);
    assert.equal(await client(code), null); const value = event(code); assert.ok(Buffer.byteLength(JSON.stringify(value)) < 512);
    for (const bad of [{ ...value, origin: "browser" }, { ...value, origin: "worker" }, { ...value, message: "PRIVATE_CANARY" }]) assert.equal(diagnosticEventSchema.safeParse(bad).success, false);
    assert.equal(await createDevelopmentErrorRecorder(() => assert.fail("Production sink accessed"), () => "production")(code), "unavailable");
  }
  assert.equal(writes, 0); assert.equal(sends, 0);
  assert.equal((await intake(request("browser_runtime"), "development")).status, 204); assert.equal(writes, 1);
  assert.equal((await intake(new Proxy({}, { get() { assert.fail("Production request accessed"); } }), "production")).status, 404);
});
