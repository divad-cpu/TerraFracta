import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { diagnosticCodes, diagnosticCodesV7, fictionalCorrectionDiagnosticCodes, makeDiagnosticEvent,
  diagnosticEventSchema, DIAGNOSTIC_FILE_BYTES } from "../src/error-diagnostics.ts";
import { buildDiagnosticReport, parseDiagnosticReport, diagnosticSelection, selectDiagnosticEvents } from "../src/diagnostic-report.ts";
import { readDiagnosticExport, DIAGNOSTIC_IMPORT_BYTES } from "../src/diagnostic-import.ts";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";
import { createClientErrorReporter } from "../src/client-error-diagnostics.ts";
import { createDevelopmentErrorRecorder } from "../src/server/error-diagnostics.ts";

const fixed = new Date("2026-10-06T16:13:29.000Z"), id = n => `cc000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const codes = Object.keys(fictionalCorrectionDiagnosticCodes);
const decode = input => readDiagnosticExport(new TextEncoder().encode(JSON.stringify(input)).buffer);
const event = (code = codes[0], n = 1) => makeDiagnosticEvent(code, id(n), fixed);

test("genuine prechange v7 and exact historical v1-v6 preserve bytes events dates counts and generic attribution", () => {
  assert.equal(Object.keys(diagnosticCodesV7).length, 25); assert.equal(Object.keys(diagnosticCodes).length, 34);
  for (let version = 1; version <= 7; version++) {
    const path = new URL(`../fixtures/diagnostics/report-v${version}.sample.json`, import.meta.url);
    const raw = readFileSync(path), old = JSON.parse(raw), current = decode(old);
    assert.equal(current.schemaVersion, 9); assert.equal(current.exportedAt, old.exportedAt);
    assert.deepEqual(current.events, old.events);
    for (const [code, count] of Object.entries(old.counts)) assert.equal(current.counts[code], count);
    for (const code of codes) assert.equal(current.counts[code], 0);
    assert.equal(current.captureCompleteness, old.captureCompleteness); assert.equal(current.buildBinding, old.buildBinding);
    assert.deepEqual(readFileSync(path), raw);
    if (version === 7) {
      assert.equal(createHash("sha256").update(raw).digest("hex"), "262b43c6e3b30c4ab560a1420fbf900a2a2329b71c28084710cecf08bf006aef");
      assert.deepEqual(old.locations, diagnosticCodesV7); assert.equal(old.events.length, 25);
      assert.equal(current.events.find(value => value.code === "browser_promise").code, "browser_promise");
      assert.equal(selectDiagnosticEvents(current, diagnosticSelection({ code: codes[0] })).total, 0);
    }
    assert.throws(() => decode({ ...old, schemaVersion: 8 }));
    assert.throws(() => decode({ ...old, events: [event()], filesObserved: 1 }));
  }
});

test("v8 checks exact catalogue counts uncertainty privacy and all eight five-field event identities", () => {
  const events = codes.map((code, n) => event(code, n + 1));
  const report = buildDiagnosticReport({ events, unreadable: 0, filesObserved: 8, stable: true, locked: false }, fixed);
  assert.deepEqual(decode(report), report);
  for (const value of events) {
    assert.equal(value.origin, "browser"); assert.equal(value.schemaVersion, 1);
    assert.deepEqual(Object.keys(value).sort(), ["code", "eventId", "occurredAt", "origin", "schemaVersion"]);
    assert.ok(Buffer.byteLength(JSON.stringify(value)) < DIAGNOSTIC_FILE_BYTES);
    for (const patch of [{ origin: "server" }, { origin: "worker" }, { details: "PRIVATE_BODY" }, { executionId: id(90) }])
      assert.equal(diagnosticEventSchema.safeParse({ ...value, ...patch }).success, false);
    assert.equal(selectDiagnosticEvents(report, diagnosticSelection({ code: value.code, origin: "browser" })).total, 1);
  }
  const missing = structuredClone(report); delete missing.counts[codes[0]];
  const label = structuredClone(report); label.locations[codes[0]].location = "PRIVATE_LOCATION";
  for (const bad of [missing, label, { ...report, schemaVersion: 7 }, { ...report, schemaVersion: 10 },
    { ...report, extra: "PRIVATE_BODY" }, { ...report, counts: { ...report.counts, [codes[0]]: 0 } }])
    for (const parse of [decode, parseDiagnosticReport]) assert.throws(() => parse(bad));
  const partial = decode({ ...report, locked: true, inspectionComplete: false });
  assert.equal(partial.captureCompleteness, "unknown"); assert.equal(partial.inspectionComplete, false);
  assert.equal(decode(buildDiagnosticReport(null, fixed)).archiveState, "missing");
});

test("new browser identities retain intake bounds while production refusal precedes any request or sink", async () => {
  const intake = createDiagnosticIntake(() => assert.fail("production sink"));
  const hostile = new Proxy({}, { get: () => assert.fail("production observed request") });
  assert.equal((await intake(hostile, "production")).status, 404);
  for (const code of codes) {
    assert.equal(await createClientErrorReporter("production", () => assert.fail("production dispatch"))(code), null);
    assert.equal(await createDevelopmentErrorRecorder(() => assert.fail("production store"), () => "production")(code), "unavailable");
    const body = JSON.stringify({ eventId: id(1), code }); assert.ok(Buffer.byteLength(body) < 256);
    for (const extra of [{ origin: "server" }, { message: "PRIVATE_BODY" }, { reportId: id(2) }]) {
      const request = new Request("http://127.0.0.1:3100/api/dev/error-log", { method: "POST",
        headers: { origin: "http://127.0.0.1:3100", "sec-fetch-site": "same-origin", "content-type": "application/json" },
        body: JSON.stringify({ eventId: id(1), code, ...extra }) });
      assert.equal((await intake(request, "development")).status, 400);
    }
  }
});

test("expanded catalogue fits unchanged import capacity and refuses invalid partial or oversized exports", () => {
  const events = Array.from({ length: 1_001 }, (_, n) => event(codes[n % codes.length], n + 1));
  const report = buildDiagnosticReport({ events, unreadable: 0, filesObserved: 1_001, stable: false, locked: false }, fixed);
  const bytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
  assert.ok(bytes.byteLength < DIAGNOSTIC_IMPORT_BYTES);
  const parsed = readDiagnosticExport(bytes.buffer);
  assert.equal(parsed.capacityReached, true); assert.equal(parsed.inspectionComplete, false);
  assert.equal(parsed.captureCompleteness, "unknown"); assert.equal(parsed.events.length, 1_001);
  assert.throws(() => readDiagnosticExport(new ArrayBuffer(DIAGNOSTIC_IMPORT_BYTES + 1)));
  assert.throws(() => decode({ ...report, filesObserved: 1_000 }));
});
