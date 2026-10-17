import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { diagnosticCodes, diagnosticCodesV8, diagnosticEventSchema, makeDiagnosticEvent } from "../src/error-diagnostics.ts";
import { buildDiagnosticReport, parseDiagnosticReport, diagnosticSelection, selectDiagnosticEvents } from "../src/diagnostic-report.ts";
import { readDiagnosticExport } from "../src/diagnostic-import.ts";
import { createClientErrorReporter } from "../src/client-error-diagnostics.ts";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const path = new URL("../fixtures/diagnostics/report-v8.sample.json", import.meta.url);
const bytes = readFileSync(path), old = () => JSON.parse(bytes);
const code = "scope_draft_export", fixed = new Date("2026-10-13T12:30:00.000Z");
const event = () => makeDiagnosticEvent(code, "cc000000-0000-4000-8000-000000000009", fixed);
const report = () => buildDiagnosticReport({ events: [event()], unreadable: 0, filesObserved: 1, locked: false, stable: true }, fixed);
const decode = value => readDiagnosticExport(new TextEncoder().encode(JSON.stringify(value)).buffer);

test("actual scope view default observer reaches private export saved reader function filter and presenter", async t => {
  const parent = await mkdtemp("/tmp/terrafracta-scope-export-diagnostics-");
  const run = spawnSync(process.execPath, ["--experimental-strip-types",
    fileURLToPath(new URL("./helpers/scope_export_diagnostic_process.mjs", import.meta.url)), parent], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 10_000,
    maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, NODE_ENV: "development" },
  });
  assert.ifError(run.error); assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout); assert.equal(result.reportVersion, 9); assert.equal(result.events, 1);
  assert.equal(result.networkRequests, 0); assert.equal(result.browserVerified, false);
  const saved = JSON.parse(await readFile(`${parent}/RESULT.json`, "utf8"));
  assert.deepEqual({ ownedTemporaryDirectory: parent, ...saved }, result); t.diagnostic(JSON.stringify(result));
});

test("actual prechange v8 export retains all bytes identities counts dates and uncertainty when normalized to v9", () => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "e72b8d4fd4a40ee006c5db28b78c99027cf3115f161e01ecc6b7c6162aaa9a22");
  assert.deepEqual(old().locations, diagnosticCodesV8); assert.equal(Object.keys(diagnosticCodesV8).length, 33);
  assert.deepEqual(Object.keys(diagnosticCodes).filter(key => !Object.hasOwn(diagnosticCodesV8, key)), [code]);
  const original = old(), value = decode(original);
  assert.equal(value.schemaVersion, 9); assert.equal(value.counts[code], 0);
  for (const key of ["events", "exportedAt", "archiveState", "inspectionComplete", "captureCompleteness", "buildBinding", "unreadableFiles", "locked", "filesObserved", "capacityReached", "instructions"])
    assert.deepEqual(value[key], original[key]);
  for (const [key, count] of Object.entries(original.counts)) assert.equal(value.counts[key], count);
  assert.equal(selectDiagnosticEvents(value, diagnosticSelection({ code })).total, 0);
  assert.deepEqual(readFileSync(path), bytes); assert.deepEqual(parseDiagnosticReport(value), value);
});

test("v9 export admits one closed browser identity with exact curated label and no user fields", () => {
  const value = report(); assert.equal(value.schemaVersion, 9); assert.equal(Object.keys(value.locations).length, 34);
  assert.deepEqual(decode(value), value); assert.equal(value.counts[code], 1);
  assert.deepEqual(Object.keys(event()).sort(), ["code", "eventId", "occurredAt", "origin", "schemaVersion"]);
  assert.deepEqual(selectDiagnosticEvents(value, diagnosticSelection({ code })).groups[0], {
    code, origin: "browser", location: "editorial preview / download scope preparation", count: 1,
    firstAt: fixed.toISOString(), lastAt: fixed.toISOString(),
  });
  for (const patch of [{ origin: "server" }, { origin: "worker" }, { filename: "PRIVATE_FILE" }, { message: "PRIVATE_WORDING" }, { captureId: "PRIVATE_CAPTURE" }])
    assert.equal(diagnosticEventSchema.safeParse({ ...event(), ...patch }).success, false);
});

test("historical v8 refuses the new event and mixed catalogues while v9 refuses forgery unknown versions and wrong counts", () => {
  const historical = old(), current = report();
  const injected = { ...historical, events: [event()], filesObserved: 1 };
  const upgraded = { ...historical, locations: current.locations, counts: { ...historical.counts, [code]: 0 } };
  const missing = structuredClone(current); delete missing.counts[code];
  const label = structuredClone(current); label.locations[code].location = "PRIVATE_LABEL";
  const wrongCount = structuredClone(current); wrongCount.counts[code] = 0;
  for (const invalid of [injected, upgraded, missing, label, wrongCount, { ...current, schemaVersion: 8 }, { ...current, schemaVersion: 10 }, { ...current, wording: "PRIVATE_WORDING" }])
    for (const parse of [decode, parseDiagnosticReport]) assert.throws(() => parse(invalid));
  for (const patch of [{ locked: true, inspectionComplete: false }, { unreadableFiles: 1, filesObserved: historical.filesObserved + 1, inspectionComplete: false }]) {
    const value = decode({ ...historical, ...patch });
    for (const [key, expected] of Object.entries(patch)) assert.equal(value[key], expected);
    assert.equal(value.captureCompleteness, "unknown"); assert.equal(value.counts[code], 0);
  }
});

test("browser reporter sends only the two fixed intent fields and production performs no request or write", async () => {
  const writes = [], wire = [], intake = createDiagnosticIntake(async (observed, id) => { writes.push({ code: observed, eventId: id }); return "saved"; }, () => 0);
  const reporter = createClientErrorReporter("development", async (url, options) => {
    wire.push(JSON.parse(options.body));
    return intake(new Request("http://127.0.0.1:3000" + url, { ...options, headers: {
      ...options.headers, origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin",
    } }), "development");
  }, () => event().eventId, () => 0);
  assert.ok(await reporter(code)); assert.deepEqual(writes, [{ code, eventId: event().eventId }]); assert.deepEqual(wire, writes);
  assert.equal(await createClientErrorReporter("production", () => assert.fail("production request"))(code), null);
  assert.equal((await intake(new Proxy({}, { get: () => assert.fail("production request access") }), "production")).status, 404);
  assert.equal(writes.length, 1);
});
