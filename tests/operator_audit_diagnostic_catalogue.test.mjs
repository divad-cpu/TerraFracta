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
import * as diagnostics from "../src/error-diagnostics.ts";
import { buildDiagnosticReport, parseDiagnosticReport, diagnosticSelection, selectDiagnosticEvents } from "../src/diagnostic-report.ts";
import { readDiagnosticExport } from "../src/diagnostic-import.ts";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { createDevelopmentErrorRecorder } from "../src/server/error-diagnostics.ts";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";
import { createClientErrorReporter } from "../src/client-error-diagnostics.ts";
import { exportErrorLog } from "../scripts/export_error_log.mjs";

const code = "operator_audit_read", location = "editorial audit / read recorded metadata";
const uuid = n => "00000000-0000-4000-8000-" + n.toString(16).padStart(12, "0");
const event = (value = code, n = 1) => diagnostics.makeDiagnosticEvent(value, uuid(n), new Date("2026-10-05T13:15:00.000Z"));
const report = events => buildDiagnosticReport({ events, filesObserved: events.length, unreadable: 0, stable: true, locked: false });
const decode = value => readDiagnosticExport(new TextEncoder().encode(JSON.stringify(value)).buffer);
const paths = [1, 2, 3].map(version => new URL("../fixtures/diagnostics/report-v" + version + ".sample.json", import.meta.url));
const originalBytes = paths.map(path => readFileSync(path));
const historical = () => originalBytes.map(bytes => JSON.parse(bytes.toString("utf8")));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

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
const render = (value, selection) => renderToStaticMarkup(createElement(DiagnosticWorkspace, {
  result: { kind: "available", report: value }, selection,
}));

test("actual existing recorder persists audit identity through private store, export, import and view controls", async t => {
  const parent = await mkdtemp("/tmp/terrafracta-audit-diagnostic-catalogue-"), directory = join(parent, "log");
  const store = new ErrorLogStore(directory), record = createDevelopmentErrorRecorder(value => store.append(value), () => "development");
  assert.equal(await record(code, uuid(101)), "saved");
  const generic = event("server_route", 102); assert.equal(await store.append(generic), "saved");
  const original = await readFile(join(directory, uuid(101) + ".json"));
  const inspected = await store.inspect(); assert.equal(inspected.stable, true);
  const saved = inspected.events.find(value => value.eventId === uuid(101));
  assert.deepEqual(Object.keys(saved).sort(), ["code", "eventId", "occurredAt", "origin", "schemaVersion"]);
  assert.equal(saved.schemaVersion, 1); assert.equal(saved.origin, "server"); assert.equal(saved.code, code);
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(directory, uuid(101) + ".json"))).mode & 0o777, 0o600);
  const output = join(parent, "export.json"); await exportErrorLog(directory, output);
  const bytes = await readFile(output), exported = JSON.parse(bytes);
  assert.equal(exported.schemaVersion, 9); assert.equal(Object.keys(exported.locations).length, 34);
  assert.equal(exported.counts[code], 1); assert.equal((await lstat(output)).mode & 0o777, 0o600);
  const imported = readDiagnosticExport(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.deepEqual(imported, exported);
  const selected = diagnosticSelection({ code, origin: "server", ref: uuid(101) });
  assert.ok(selected); const filtered = selectDiagnosticEvents(imported, selected);
  assert.deepEqual(filtered.events, [saved]); assert.equal(filtered.groups[0].location, location);
  assert.equal(filtered.groups[0].origin, "server"); assert.equal(filtered.total, 1);
  const html = render(imported, selected);
  assert.ok(html.includes('value="operator_audit_read"')); assert.ok(html.includes(location)); assert.ok(html.includes(uuid(101)));
  assert.ok(html.includes("Reported origin: server")); assert.ok(html.includes("1 matching record; 1 function"));
  assert.ok(!html.includes(uuid(102))); assert.ok(!html.includes("PRIVATE_"));
  assert.equal(selectDiagnosticEvents(imported, diagnosticSelection({ code, origin: "browser" })).total, 0);
  assert.deepEqual(selectDiagnosticEvents(imported, diagnosticSelection({ code: "server_route" })).events, [generic]);
  assert.deepEqual(await readFile(join(directory, uuid(101) + ".json")), original);
  assert.equal(imported.captureCompleteness, "unknown"); assert.equal(imported.buildBinding, "not_bound_to_a_deployed_build");
  t.diagnostic(JSON.stringify({ ownedTemporaryDirectory: parent, events: 2, privateExport: output }));
});

test("exact historical v1/v2/v3 catalogues normalize only in memory and retain sealed bytes and all uncertainty flags", () => {
  assert.deepEqual(Object.keys(diagnostics.diagnosticCodesV3).length, 20);
  assert.deepEqual(Object.keys(diagnostics.diagnosticCodesV4).filter(value => !Object.hasOwn(diagnostics.diagnosticCodesV3, value)), [code]);
  assert.deepEqual(diagnostics.diagnosticCodes[code], { origin: "server", location });
  const catalogues = [diagnostics.legacyDiagnosticCodes, diagnostics.diagnosticCodesV2, diagnostics.diagnosticCodesV3];
  for (const [index, original] of historical().entries()) {
    assert.deepEqual(original.locations, catalogues[index]);
    const before = JSON.stringify(original), value = decode(original);
    assert.equal(value.schemaVersion, 9); assert.equal(value.counts[code], 0);
    for (const key of ["events", "exportedAt", "archiveState", "inspectionComplete", "locked", "filesObserved", "unreadableFiles", "capacityReached", "captureCompleteness", "buildBinding", "instructions"])
      assert.deepEqual(value[key], original[key], key);
    for (const [key, count] of Object.entries(original.counts)) assert.equal(value.counts[key], count);
    assert.equal(JSON.stringify(original), before); assert.deepEqual(parseDiagnosticReport(value), value);
    assert.equal(selectDiagnosticEvents(value, diagnosticSelection({ code })).total, 0);
    for (const changes of [{ locked: true, inspectionComplete: false },
      { unreadableFiles: 1, filesObserved: original.events.length + 1, inspectionComplete: false },
      { unreadableFiles: 1000 - original.events.length, filesObserved: 1000, capacityReached: true, inspectionComplete: false },
      { archiveState: "missing", events: [], counts: Object.fromEntries(Object.keys(original.counts).map(key => [key, 0])), filesObserved: 0, inspectionComplete: false }]) {
      const changed = { ...original, ...changes }, parsed = decode(changed);
      for (const key of Object.keys(changes).filter(key => key !== "counts")) assert.deepEqual(parsed[key], changed[key]);
      assert.equal(parsed.captureCompleteness, "unknown"); assert.equal(parsed.counts[code], 0);
    }
    assert.deepEqual(readFileSync(paths[index]), originalBytes[index]);
  }
  assert.equal(sha(originalBytes[2]), "c3310d53a95bfdd9143fc8386cd86cad0474b1ad98ade0eaafa746181bd6f51f");
});

test("exact version catalogues refuse later events, partial/forged/mixed labels/counts and unknown versions", () => {
  const current = report([event()]);
  assert.deepEqual(decode(current), current);
  for (const old of historical()) {
    const added = structuredClone(old); added.events[0] = { ...added.events[0], code, origin: "server" };
    const mixed = structuredClone(old); mixed.locations[code] = diagnostics.diagnosticCodes[code]; mixed.counts[code] = 0;
    for (const bad of [added, mixed, { ...current, schemaVersion: old.schemaVersion }, { ...old, schemaVersion: 4 }])
      assert.throws(() => decode(bad));
  }
  const missingCount = structuredClone(current); delete missingCount.counts[code];
  const missingLocation = structuredClone(current); delete missingLocation.locations[code];
  const forgedLocation = structuredClone(current); forgedLocation.locations[code].location = "PRIVATE_LOCATION";
  const wrongOrigin = structuredClone(current); wrongOrigin.locations[code].origin = "browser";
  const wrongCount = structuredClone(current); wrongCount.counts[code] = 0;
  const unknownEvent = structuredClone(current); unknownEvent.events[0].code = "operator_audit_private";
  for (const bad of [missingCount, missingLocation, forgedLocation, wrongOrigin, wrongCount, unknownEvent,
    { ...current, schemaVersion: 10 }, { ...current, privateRaw: "PRIVATE_CANARY" }])
    assert.throws(() => decode(bad));
});

test("server-only code refuses browser/client authority and free-form fields without persistence or network", async () => {
  let writes = 0, sends = 0;
  const intake = createDiagnosticIntake(async () => { writes++; return "saved"; });
  const client = createClientErrorReporter("development", async () => { sends++; return new Response(null, { status: 204 }); });
  assert.equal(await client(code), null); assert.equal(sends, 0);
  const request = body => new Request("http://127.0.0.1/api/dev/error-log", { method: "POST", headers: {
    origin: "http://127.0.0.1", "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify(body) });
  for (const body of [{ eventId: uuid(1), code }, { eventId: uuid(1), code, origin: "server" },
    { eventId: uuid(1), code, scope: "PRIVATE_RAW" }, { eventId: uuid(1), code: "operator_audit_private" }])
    assert.equal((await intake(request(body), "development")).status, 400);
  assert.equal(writes, 0);
  const value = event();
  for (const invalid of [{ ...value, origin: "browser" }, { ...value, origin: "worker" }, { ...value, stack: "PRIVATE_CANARY" }, { ...value, code: "operator_audit_private" }])
    assert.equal(diagnostics.diagnosticEventSchema.safeParse(invalid).success, false);
  assert.equal(await createDevelopmentErrorRecorder(() => assert.fail("Production sink observed"), () => "production")(code), "unavailable");
  assert.equal((await intake(new Proxy({}, { get() { assert.fail("Production request observed"); } }), "production")).status, 404);
});
