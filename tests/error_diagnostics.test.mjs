import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, lstat, mkdir, symlink, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makeDiagnosticEvent, diagnosticEventSchema } from "../src/error-diagnostics.ts";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";
import { createDevelopmentErrorRecorder } from "../src/server/error-diagnostics.ts";
import { createClientErrorReporter, installClientErrorListeners } from "../src/client-error-diagnostics.ts";
import { exportErrorLog } from "../scripts/export_error_log.mjs";

const fixture = () => mkdtemp("/tmp/terrafracta-error-log-test-");
const event = (code = "browser_runtime") => makeDiagnosticEvent(code, randomUUID(), new Date("2026-10-04T14:00:00.000Z"));
const request = (body, overrides = {}) => new Request("http://127.0.0.1/api/dev/error-log", {
  method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "sec-fetch-site": "same-origin", "content-type": "application/json", ...overrides.headers },
  body: typeof body === "string" ? body : JSON.stringify(body), ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "headers")),
});
const intent = () => ({ eventId: randomUUID(), code: "browser_runtime" });

test("closed events reject payloads, false provenance, noncanonical identity/date and private getters", () => {
  const good = event();
  assert.ok(diagnosticEventSchema.safeParse(good).success);
  for (const value of [{ ...good, message: "PRIVATE_CANARY" }, { ...good, origin: "worker" },
    { ...good, eventId: "../../PRIVATE_CANARY" }, { ...good, occurredAt: "yesterday" }, { ...good, code: "PRIVATE_CANARY" }])
    assert.equal(diagnosticEventSchema.safeParse(value).success, false);
  const error = Object.defineProperties({}, { message: { get() { assert.fail("message read"); } }, stack: { get() { assert.fail("stack read"); } } });
  assert.ok(makeDiagnosticEvent("server_render", randomUUID())); // No error parameter exists.
  assert.equal(Object.keys(error).length, 0);
});
test("actual filesystem saves private exclusive events and exports only validated fields", async () => {
  const parent = await fixture(), directory = join(parent, "log"), store = new ErrorLogStore(directory), value = event();
  assert.equal(await store.append(value), "saved");
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  const file = join(directory, value.eventId + ".json"), original = await readFile(file);
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  assert.equal(await store.append(value), "unavailable"); assert.deepEqual(await readFile(file), original);
  const inspected = await store.inspect(); assert.equal(inspected.stable, true); assert.deepEqual(inspected.events, [value]);
  const output = join(parent, "export.json"); assert.equal((await exportErrorLog(directory, output)).events, 1);
  const bundle = JSON.parse(await readFile(output, "utf8")); assert.equal(bundle.inspectionComplete, true);
  assert.equal(bundle.captureCompleteness, "unknown"); assert.equal(bundle.counts.browser_runtime, 1);
  assert.equal((await lstat(output)).mode & 0o777, 0o600);
  await assert.rejects(exportErrorLog(directory, output)); assert.deepEqual(await readFile(file), original);
});
test("archive rejects symbolic links, insecure directories, corrupt/foreign fields and preserves unknown files", async () => {
  const parent = await fixture(), directory = join(parent, "log"); await mkdir(directory, { mode: 0o700 });
  const value = event(), privateBytes = JSON.stringify({ ...value, message: "PRIVATE_CANARY" });
  await writeFile(join(directory, value.eventId + ".json"), privateBytes, { mode: 0o600 });
  await writeFile(join(directory, "unknown"), "PRIVATE_CANARY", { mode: 0o600 });
  await symlink(join(directory, "unknown"), join(directory, randomUUID() + ".json"));
  const store = new ErrorLogStore(directory), result = await store.inspect();
  assert.equal(result.events.length, 0); assert.equal(result.unreadable, 3);
  const output = join(parent, "export.json"); await exportErrorLog(directory, output);
  assert.ok(!(await readFile(output, "utf8")).includes("PRIVATE_CANARY"));
  assert.equal(JSON.parse(await readFile(output, "utf8")).inspectionComplete, false);
  await symlink(directory, join(parent, "alias")); assert.equal(await new ErrorLogStore(join(parent, "alias")).append(event()), "unavailable");
  const insecure = join(parent, "insecure"); await mkdir(insecure, { mode: 0o755 });
  assert.equal(await new ErrorLogStore(insecure).append(event()), "unavailable");
  await symlink(parent, join(parent, "parent-alias"));
  assert.equal(await new ErrorLogStore(join(parent, "parent-alias", "other")).append(event()), "unavailable");
  assert.equal(await readFile(join(directory, "unknown"), "utf8"), "PRIVATE_CANARY");
});
test("shared lock and quota include unknown entries and admit at most one parallel final slot", async () => {
  const parent = await fixture(), directory = join(parent, "log"); await mkdir(directory, { mode: 0o700 });
  for (let i = 0; i < 999; i++) await writeFile(join(directory, `preserved-${i}`), "", { mode: 0o600 });
  const first = new ErrorLogStore(directory), second = new ErrorLogStore(directory);
  const results = await Promise.all([first.append(event()), second.append(event())]);
  assert.equal(results.filter(value => value === "saved").length, 1);
  assert.equal((await readdir(directory)).length, 1000);
  assert.equal(await first.append(event()), "full");
  const lockedParent = await fixture(), locked = join(lockedParent, "log"); await mkdir(locked, { mode: 0o700 });
  await mkdir(join(locked, ".write-lock"), { mode: 0o700 });
  assert.equal(await new ErrorLogStore(locked).append(event()), "busy");
  assert.equal((await new ErrorLogStore(locked).inspect()).locked, true);
});
test("browser intake persists server-timed records; production refusal precedes request getters", async () => {
  const parent = await fixture(), store = new ErrorLogStore(join(parent, "log")); let calls = 0;
  const intake = createDiagnosticIntake(async (code, id) => { calls++; return store.append(makeDiagnosticEvent(code, id)); });
  const poison = new Proxy({}, { get() { assert.fail("production observed request"); } });
  assert.equal((await intake(poison, "production")).status, 404); assert.equal(calls, 0);
  const value = intent(); assert.equal((await intake(request(value), "development")).status, 204);
  const saved = (await store.inspect()).events[0]; assert.equal(saved.eventId, value.eventId); assert.equal(saved.origin, "browser");
  assert.equal((await intake(request({ ...intent(), code: "update_worker" }), "development")).status, 400);
  assert.equal(calls, 1);
});
test("intake refuses foreign authority, payload smuggling, duplicate keys and oversize before writing", async () => {
  let writes = 0; const intake = createDiagnosticIntake(async () => { writes++; return "saved"; });
  for (const [value, overrides, expected] of [
    [intent(), { headers: { origin: "https://foreign.invalid" } }, 403],
    [intent(), { headers: { "sec-fetch-site": "same-site" } }, 403],
    [{ ...intent(), message: "PRIVATE_CANARY" }, {}, 400],
    ['{"eventId":"' + randomUUID() + '","code":"browser_runtime","code":"server_render"}', {}, 400],
    ["X".repeat(257), {}, 400], [intent(), { headers: { "content-type": "text/plain" } }, 415],
  ]) assert.equal((await intake(request(value, overrides), "development")).status, expected);
  assert.equal(writes, 0);
});
test("intake limits request storms and contains sink failures without diagnostic leakage", async () => {
  const intake = createDiagnosticIntake(async () => { throw new Error("PRIVATE_CANARY"); }, () => 0);
  for (let i = 0; i < 60; i++) { const response = await intake(request(intent()), "development"); assert.equal(response.status, 503); assert.equal(await response.text(), ""); }
  assert.equal((await intake(request(intent()), "development")).status, 429);
});
test("client logs only closed intents, returns saved reference, bounds volume and refuses production", async () => {
  let calls = 0; const id = randomUUID();
  const report = createClientErrorReporter("development", async (url, options) => {
    calls++; assert.equal(url, "/api/dev/error-log"); assert.deepEqual(JSON.parse(options.body), { eventId: id, code: "browser_runtime" });
    return new Response(null, { status: 204 });
  }, () => id, () => 0);
  for (let i = 0; i < 10; i++) assert.equal(await report("browser_runtime"), id);
  assert.equal(await report("browser_runtime"), null); assert.equal(calls, 10);
  assert.equal(await createClientErrorReporter("production", () => { assert.fail("production fetch"); })("browser_runtime"), null);
  assert.equal(await createClientErrorReporter("development", async () => { throw new Error("PRIVATE_CANARY"); })("page_render"), null);
});
test("global browser listeners never inspect private events and consume reporter failures", async () => {
  const listeners = new Map(), removed = [], observed = [];
  const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => removed.push(name) };
  const uninstall = installClientErrorListeners(target, async code => { observed.push(code); throw new Error("PRIVATE_CANARY"); });
  const poison = new Proxy({}, { get() { assert.fail("event body read"); } });
  listeners.get("error")(poison); listeners.get("unhandledrejection")(poison); await Promise.resolve();
  assert.deepEqual(observed, ["browser_runtime", "browser_promise"]); uninstall(); assert.deepEqual(removed, ["error", "unhandledrejection"]);
});
test("stalled client reporting returns at its deadline and retains ownership until late settlement", async () => {
  let settle, calls = 0;
  const report = createClientErrorReporter("development", () => { calls++; return new Promise(resolve => { settle = resolve; }); });
  assert.equal(await report("page_render"), null);
  assert.equal(await report("page_render"), null); assert.equal(calls, 1);
  settle(new Response(null, { status: 204 })); await new Promise(resolve => setImmediate(resolve));
  const later = report("page_render"); settle(new Response(null, { status: 204 })); assert.ok(await later); assert.equal(calls, 2);
});
test("cancelled, malformed UTF8 and stalled streamed intake never reach the writer", async () => {
  let writes = 0; const intake = createDiagnosticIntake(async () => { writes++; return "saved"; });
  const controller = new AbortController(); controller.abort();
  assert.equal((await intake(request(intent(), { signal: controller.signal }), "development")).status, 400);
  assert.equal((await intake(request("", { body: new Uint8Array([0xff]) }), "development")).status, 400);
  const stream = new ReadableStream({ start() {} });
  const streamed = request("", { body: stream, duplex: "half" });
  assert.equal((await intake(streamed, "development")).status, 400); assert.equal(writes, 0);
});
test("server recorder preserves one owned sink after timeout and never calls it in production", async () => {
  let calls = 0, settle;
  const record = createDevelopmentErrorRecorder(() => { calls++; return new Promise(resolve => { settle = resolve; }); }, () => "development");
  assert.equal(await record("server_render"), "unavailable");
  assert.equal(await record("server_route"), "busy"); assert.equal(calls, 1);
  settle("saved"); await new Promise(resolve => setImmediate(resolve));
  const later = record("server_render"); await Promise.resolve(); settle("saved"); assert.equal(await later, "saved");
  assert.equal(await createDevelopmentErrorRecorder(() => { assert.fail("Production sink touched"); }, () => "production")("server_route"), "unavailable");
});
test("Python worker records use the same actual archive, format and lock; export is interoperable", async () => {
  const parent = await fixture(), directory = join(parent, "log");
  await promisify(execFile)("/usr/bin/python3.12", ["-B", "-E", "-s", "-c", "from pathlib import Path; from workers.error_diagnostics import record_worker_error; import sys; assert record_worker_error('update_worker', directory=Path(sys.argv[1]))", directory]);
  const store = new ErrorLogStore(directory), result = await store.inspect(); assert.equal(result.events.length, 1); assert.equal(result.events[0].origin, "worker");
  assert.equal(await store.append(event("server_render")), "saved");
  await mkdir(join(directory, ".write-lock"), { mode: 0o700 });
  await promisify(execFile)("/usr/bin/python3.12", ["-B", "-E", "-s", "-c", "from pathlib import Path; from workers.error_diagnostics import record_worker_error; import sys; assert not record_worker_error('update_worker', directory=Path(sys.argv[1]))", directory]);
  const output = join(parent, "export.json"); await exportErrorLog(directory, output);
  const bundle = JSON.parse(await readFile(output, "utf8")); assert.equal(bundle.events.length, 2); assert.equal(bundle.locked, true); assert.equal(bundle.inspectionComplete, false);
});
test("server fault acknowledgement rechecks elapsed time before reporting a saved event", async () => {
  for (const finish of [1000, -1, NaN, Infinity]) {
    let time = 0;
    const record = createDevelopmentErrorRecorder(async () => { time = finish; return "saved"; }, () => "development", () => time);
    assert.equal(await record("server_render"), "unavailable");
  }
});
test("client fault reference is withheld after late or regressed clock acknowledgement", async () => {
  for (const finish of [1500, -1, NaN, Infinity]) {
    let time = 0;
    const record = createClientErrorReporter("development", async () => { time = finish; return new Response(null, { status: 204 }); }, randomUUID, () => time);
    assert.equal(await record("page_render"), null);
  }
});
