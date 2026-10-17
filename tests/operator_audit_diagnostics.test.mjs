import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { createDevelopmentErrorRecorder } from "../src/server/error-diagnostics.ts";
import { exportErrorLog } from "../scripts/export_error_log.mjs";
import { readDiagnosticExport } from "../src/diagnostic-import.ts";
import { diagnosticSelection, selectDiagnosticEvents } from "../src/diagnostic-report.ts";
import { createOperatorAuditReader, OPERATOR_AUDIT_TIMEOUT_MS } from "../src/server/operator-audit-reader.ts";
import { audit, scope, id, bytes } from "./helpers/operator_audit_fixture.mjs";

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const held = { kind: "unavailable" };
function faultReader(provider, clock = () => performance.now(), sink = async () => "saved") {
  const calls = [];
  const read = createOperatorAuditReader(provider, clock, (...args) => { calls.push(args); return sink(...args); });
  return { read, calls };
}

test("caught recorded-audit provider failure has one fixed detail-free diagnostic intent", async () => {
  const { read, calls } = faultReader(async () => { throw new Error("PRIVATE_PASSWORD_SQL_UUID_CANARY"); });
  assert.deepEqual(await read(scope()), held); await flush();
  assert.deepEqual(calls, [["operator_audit_read"]]);
});


test("malformed private wire and mismatched report scope are withheld and log only the fixed code", async () => {
  const wrongScope = audit(); wrongScope.requested.issueId = id(99);
  const privateReport = audit(); privateReport.privateRaw = "PRIVATE_WIRE_CANARY";
  for (const raw of [new Uint8Array([0xff, 0xff]), bytes(null), bytes("PRIVATE_CANARY"), bytes(wrongScope),
    bytes(privateReport), new Uint8Array(65_537), new Uint8Array(1), "PRIVATE_CANARY", new ArrayBuffer(4)]) {
    const { read, calls } = faultReader(async () => raw);
    assert.deepEqual(await read(scope()), held); await flush();
    assert.deepEqual(calls, [["operator_audit_read"]]);
  }
});

test("invalid selection unconfigured missing changed and successful reports are not logged", async () => {
  const cases = [
    [undefined, scope(), { kind: "unconfigured" }],
    [async () => assert.fail("Invalid selection reached provider"), { ...scope(), directory: "PRIVATE_CANARY" }, { kind: "invalid_scope" }],
    [async () => bytes({ schemaVersion: 1, status: "not_found", requested: scope() }), scope(), { kind: "not_found" }],
    [async requested => bytes({ schemaVersion: 1, status: "changed", requested }),
      { ...scope(), cursor: { latestRevision: 2, headPublicationId: id(6), beforeRevision: 1 } }, { kind: "changed" }],
    [async () => bytes(audit()), scope(), { kind: "ok", report: audit() }],
  ];
  for (const [provider, input, decision] of cases) {
    const { read, calls } = faultReader(provider);
    assert.deepEqual(await read(input), decision); await flush(); assert.deepEqual(calls, []);
  }
});

test("parent preabort pending abort and aborted provider rejection never report a technical fault", async () => {
  const pre = new AbortController(); pre.abort();
  const preCase = faultReader(async () => assert.fail("Preaborted provider called"));
  assert.deepEqual(await preCase.read(scope(), pre.signal), held); await flush(); assert.deepEqual(preCase.calls, []);
  for (const rejection of [false, true]) {
    const parent = new AbortController(); let finish, child;
    const { read, calls } = faultReader(async (_scope, signal) => {
      child = signal; return new Promise((resolve, reject) => { finish = rejection ? reject : resolve; });
    });
    const pending = read(scope(), parent.signal); await Promise.resolve(); parent.abort();
    assert.deepEqual(await pending, held); assert.equal(child.aborted, true);
    finish(rejection ? new Error("PRIVATE_CANCELLED_CANARY") : bytes(audit()));
    await flush(); assert.deepEqual(calls, []);
  }
  const parent = new AbortController(), abortedFailure = faultReader(async () => {
    parent.abort(); throw new Error("PRIVATE_CANCELLED_CANARY");
  });
  assert.deepEqual(await abortedFailure.read(scope(), parent.signal), held); await flush(); assert.deepEqual(abortedFailure.calls, []);
});

test("own fixed timeout is one technical fault and cancels provider without waiting for logger", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let child;
  const { read, calls } = faultReader(async (_scope, signal) => { child = signal; return new Promise(() => {}); },
    () => 0, () => new Promise(() => {}));
  const pending = read(scope()); await Promise.resolve(); t.mock.timers.tick(OPERATOR_AUDIT_TIMEOUT_MS);
  assert.deepEqual(await pending, held); await flush(); assert.equal(child.aborted, true);
  assert.deepEqual(calls, [["operator_audit_read"]]);
});

test("initial thrown or nonfinite clock and invalid elapsed clocks are withheld with one fault", async () => {
  const clocks = [() => { throw new Error("PRIVATE_CLOCK_CANARY"); }, () => NaN,
    ...[[0, 0, 3000], [0, 0, -1], [0, 0, Infinity], [0, 0, NaN], [0, 0, 1, 3000]].map(times => {
      let n = 0; return () => times[Math.min(n++, times.length - 1)];
    })];
  for (const clock of clocks) {
    const { read, calls } = faultReader(async () => bytes(audit()), clock);
    assert.deepEqual(await read(scope()), held); await flush(); assert.deepEqual(calls, [["operator_audit_read"]]);
  }
});

test("throwing rejected or unfinished logger cannot delay change or disclose provider exception fields", async () => {
  const opaque = Object.defineProperties({}, {
    message: { get() { assert.fail("Provider message inspected"); } },
    stack: { get() { assert.fail("Provider stack inspected"); } },
    digest: { get() { assert.fail("Provider digest inspected"); } },
  });
  for (const sink of [() => { throw new Error("PRIVATE_SINK_CANARY"); }, async () => { throw new Error("PRIVATE_SINK_CANARY"); },
    () => new Promise(() => {})]) {
    const { read, calls } = faultReader(() => { throw opaque; }, () => 0, sink);
    assert.deepEqual(await read(scope()), held); await flush(); assert.deepEqual(calls, [["operator_audit_read"]]);
  }
});


test("actual caught audit fault persists once and reaches bounded export import and function filter", { timeout: 2500 }, async () => {
  const parent = await mkdtemp("/tmp/terrafracta-operator-audit-diagnostic-"), directory = join(parent, "log");
  const store = new ErrorLogStore(directory); let finish;
  const acknowledged = new Promise(resolve => { finish = resolve; });
  const record = createDevelopmentErrorRecorder(event => store.append(event), () => "development");
  const read = createOperatorAuditReader(async () => { throw new Error("PRIVATE_PROVIDER_CANARY"); }, () => 0,
    async code => { const result = await record(code); finish(result); return result; });
  assert.deepEqual(await read(scope()), held);
  assert.equal(await acknowledged, "saved");
  const inspected = await store.inspect(); assert.equal(inspected.events.length, 1);
  assert.equal(inspected.events[0].code, "operator_audit_read"); assert.equal(inspected.events[0].origin, "server");
  const output = join(parent, "export.json"); assert.equal((await exportErrorLog(directory, output)).events, 1);
  const raw = await readFile(output), buffer = Uint8Array.from(raw).buffer, report = readDiagnosticExport(buffer);
  assert.equal(report.counts.operator_audit_read, 1); assert.equal(report.schemaVersion, 9);
  assert.equal(report.captureCompleteness, "unknown");
  assert.equal(report.buildBinding, "not_bound_to_a_deployed_build");
  const selected = selectDiagnosticEvents(report, diagnosticSelection({ code: "operator_audit_read", origin: "server" }));
  assert.equal(selected.total, 1); assert.equal(selected.groups[0].location, "editorial audit / read recorded metadata");
  assert.ok(!raw.includes("PRIVATE_PROVIDER_CANARY")); assert.ok(!raw.includes(scope().runId)); assert.ok(!raw.includes(scope().issueId));
  assert.equal((await lstat(directory)).mode & 0o777, 0o700); assert.equal((await lstat(output)).mode & 0o777, 0o600);
  await writeFile(join(parent, "TEST_ORIGIN.json"), JSON.stringify({ kind: "invented_operator_audit_fault_to_existing_log", source: "tests/operator_audit_diagnostics.test.mjs", log: "log", export: "export.json", events: 1, realSource: false }) + "\n", { mode: 0o600, flag: "wx" });
});
