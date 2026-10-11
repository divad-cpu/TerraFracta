import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createClientErrorReporter, installClientErrorListeners } from "../src/client-error-diagnostics.ts";
import { makeDiagnosticEvent } from "../src/error-diagnostics.ts";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { exportErrorLog } from "../scripts/export_error_log.mjs";
import { readDiagnosticExport } from "../src/diagnostic-import.ts";

const id = n => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function connection() {
  const parent = await mkdtemp("/tmp/terrafracta-client-diagnostic-connection-"), directory = join(parent, "events");
  const store = new ErrorLogStore(directory), calls = [];
  const intake = createDiagnosticIntake((code, reference) => store.append(makeDiagnosticEvent(code, reference, new Date("2026-10-07T07:00:00.000Z"))));
  let identities = 0;
  const report = createClientErrorReporter("development", async (url, options) => {
    assert.equal(url, "/api/dev/error-log"); assert.equal(options.credentials, "same-origin");
    calls.push(JSON.parse(options.body));
    // Invoke actual native request/intake code directly: no HTTP or server.
    return intake(new Request("http://127.0.0.1" + url, { ...options, headers: {
      ...options.headers, host: "127.0.0.1", origin: "http://127.0.0.1", "sec-fetch-site": "same-origin",
    } }), "development");
  }, () => id(++identities));
  return { parent, directory, store, report, calls };
}
async function checkedExport(c, expected) {
  const output = join(c.parent, "saved-export.json");
  assert.equal((await exportErrorLog(c.directory, output)).events, expected.length);
  const bytes = await readFile(output), file = new File([bytes], "PRIVATE_FILENAME_NOT_RETURNED.json");
  const report = readDiagnosticExport(await file.arrayBuffer());
  assert.equal(report.schemaVersion, 8); assert.equal(Object.keys(report.locations).length, 33);
  assert.equal(report.inspectionComplete, true); assert.equal(report.captureCompleteness, "unknown");
  assert.equal(report.buildBinding, "not_bound_to_a_deployed_build");
  assert.deepEqual(report.events.map(event => [event.eventId, event.code]), expected);
  for (const event of report.events) {
    assert.deepEqual(Object.keys(event).sort(), ["code", "eventId", "occurredAt", "origin", "schemaVersion"]);
    assert.equal(event.origin, "browser"); assert.equal(event.occurredAt, "2026-10-07T07:00:00.000Z");
    assert.equal((await lstat(join(c.directory, event.eventId + ".json"))).mode & 0o777, 0o600);
  }
  assert.equal((await lstat(c.directory)).mode & 0o777, 0o700); assert.equal((await lstat(output)).mode & 0o777, 0o600);
  assert.equal(bytes.includes(Buffer.from("PRIVATE_FILENAME")), false);
}

test("reporter setup recovery connects to actual private intake, export and saved-file decoder", async t => {
  const c = await connection();
  t.mock.method(globalThis, "AbortController", function () { throw Error("PRIVATE_CONTROLLER_NOT_EXPORTED"); });
  assert.equal(await c.report("browser_runtime"), null); assert.deepEqual(c.calls, []);
  assert.deepEqual(await readdir(c.parent), []); t.mock.restoreAll();
  assert.equal(await c.report("browser_runtime"), id(1)); assert.deepEqual(c.calls, [{ eventId: id(1), code: "browser_runtime" }]);
  await checkedExport(c, [[id(1), "browser_runtime"]]);
});

test("retired global callbacks cannot duplicate actual stored events, while a fresh listener owner remains usable", async () => {
  const c = await connection(), kept = new Map(), pending = [];
  const target = { addEventListener(name, fn) { kept.set(name, fn); }, removeEventListener() { throw Error("PRIVATE_LISTENER_REMOVAL_NOT_EXPORTED"); } };
  const stop = installClientErrorListeners(target, code => { const work = c.report(code); pending.push(work); return work; });
  const oldRuntime = kept.get("error"), oldPromise = kept.get("unhandledrejection");
  const poison = new Proxy({}, { get() { assert.fail("Private error field read"); } });
  oldRuntime(poison); await tick(); assert.equal(await pending[0], id(1)); stop();
  oldRuntime(poison); oldPromise(poison); await tick(); assert.equal(pending.length, 1);
  const nextStop = installClientErrorListeners(target, code => { const work = c.report(code); pending.push(work); return work; });
  oldRuntime(poison); kept.get("unhandledrejection")(poison); await tick(); assert.equal(await pending[1], id(2)); nextStop();
  assert.deepEqual(c.calls, [{ eventId: id(1), code: "browser_runtime" }, { eventId: id(2), code: "browser_promise" }]);
  await checkedExport(c, [[id(1), "browser_runtime"], [id(2), "browser_promise"]]);
});
