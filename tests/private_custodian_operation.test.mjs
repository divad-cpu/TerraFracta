import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createPrivateCustodianHandler, privateCustodianEnvironment } from "../src/server/private-custodian-operation.ts";
import { parsePrivateCustodianExecution, parsePrivateCustodianOperationStatus } from "../src/private-custodian-operation.ts";
import { inventedCustodianExecution } from "./helpers/private_custodian_execution.mjs";

const url = "http://127.0.0.1:3000/api/dev/private-custodian";
const action = '{"action":"run_invented_custodian"}';
function request(method = "POST", body = action, headers = {}, signal) {
  return new Request(url, { method, headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000", ...headers },
    ...(method === "POST" ? { body } : {}), signal });
}
function isolatedHandler(run) {
  let saved = { state: "idle" };
  return createPrivateCustodianHandler({ inspect: async () => saved, start: async () => {
    saved = { state: "running" };
    try { saved = { state: "checked", result: parsePrivateCustodianExecution(await run()) }; return saved; }
    catch (error) { saved = { state: "held", reason: "private_test_unavailable" }; throw error; }
  } });
}
async function inspect(handle) { return (await handle(request("GET"), "development")).json(); }
async function finished(handle) {
  for (let i = 0; i < 100; i++) { const value = await inspect(handle); if (value.state !== "running") return value; await delay(1); }
  throw new Error("Invented handler did not finish");
}

test("production/test/unknown modes and foreign origins never start a process", async () => {
  let calls = 0;const handle = isolatedHandler(async () => { calls++; return inventedCustodianExecution(); });
  for (const environment of ["production", "test", undefined]) {
    for (const method of ["GET", "POST"]) assert.equal((await handle(request(method), environment)).status, 404);
  }
  for (const headers of [{ origin: "https://example.org" }, { host: "example.org" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await handle(request("POST", action, headers), "development")).status, 403);
  }
  assert.equal(calls, 0);
});

test("exact action, bounded bytes, duplicate keys and private selectors are checked before starting", async () => {
  let calls = 0;const handle = isolatedHandler(async () => { calls++; return inventedCustodianExecution(); });
  for (const body of ['{}', '[]', '{"action":"run_invented_custodian","action":"run_invented_custodian"}',
    '{"action":"run_invented_custodian","url":"https://example.org"}', '{"action":"run_real_source"}',
    '{"action":"run_invented_custodian","sql":"select 1"}', ' '.repeat(65), new Uint8Array([255, 255])]) {
    assert.equal((await handle(request("POST", body), "development")).status, 400);
  }
  for (const headers of [{ "content-length": "1000" }, { "content-length": "NaN" }]) {
    assert.equal((await handle(request("POST", action, headers), "development")).status, 400);
  }
  assert.equal((await handle(request("POST", action, { "content-type": "text/plain" }), "development")).status, 415);
  assert.equal(calls, 0);assert.deepEqual(await inspect(handle), { state: "idle" });
});

test("repeated starts and polling share one owned invocation without credentials or private fields", async () => {
  let calls = 0, resolve;const pending = new Promise((done) => { resolve = done; });
  const handle = isolatedHandler(async () => { calls++; return pending; });
  assert.deepEqual(await inspect(handle), { state: "idle" });
  const results = await Promise.all([handle(request(), "development"), handle(request(), "development")]);
  assert.ok(results.every((result) => result.status === 202));assert.equal(calls, 1);
  assert.equal(results[0].headers.get("cache-control"), "no-store");
  assert.equal(results[0].headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await inspect(handle), { state: "running" });
  resolve(inventedCustodianExecution());
  const result = await finished(handle);
  assert.deepEqual(parsePrivateCustodianOperationStatus(result), { state: "checked", result: inventedCustodianExecution() });
  assert.equal((await handle(request(), "development")).status, 200);assert.equal(calls, 1);
  assert.ok(!/(?:password|privateEvidenceDirectory|sourceFingerprint|rawBody)/.test(JSON.stringify(result)));
});

test("oversized body rejection does not wait for an unresponsive or rejected transport cancellation", async () => {
  for (const cancellation of [new Promise(() => {}), () => Promise.reject(new Error("private-transport-canary"))]) {
    let starts = 0, reads = 0, cancels = 0;
    const handle = createPrivateCustodianHandler({
      inspect: async () => { reads++; return { state: "idle" }; },
      start: async () => { starts++; return { state: "idle" }; },
    });
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(65)); },
      cancel() { cancels++; return typeof cancellation === "function" ? cancellation() : cancellation; },
    });
    const input = new Request(url, { method: "POST", body, duplex: "half",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" } });
    const timeout = new AbortController();
    try {
      const response = await Promise.race([handle(input, "development"),
        delay(300, undefined, { signal: timeout.signal }).then(() => { throw new Error("Body refusal did not return promptly"); })]);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid_private_test_request" });
      assert.equal(starts, 0);assert.equal(reads, 0);assert.equal(cancels, 1);
    } finally { timeout.abort(); }
  }
});

test("failed or invalid outputs stay held without a second execution or diagnostic leak", async () => {
  for (const run of [async () => { throw new Error("private-body-canary"); },
    async () => ({ ...inventedCustodianExecution(), rawBody: "private-body-canary" }),
    async () => ({ ...inventedCustodianExecution(), publicationEnabled: true })]) {
    let calls = 0;const handle = isolatedHandler(async () => { calls++; return run(); });
    await handle(request(), "development");
    const value = await finished(handle);
    assert.deepEqual(value, { state: "held", reason: "private_test_unavailable" });
    assert.ok(!JSON.stringify(value).includes("canary"));
    await handle(request(), "development");assert.equal(calls, 1);
  }
});

test("cancellation before acceptance starts nothing; browser cancellation after acceptance does not retry or kill the job", async () => {
  let calls = 0, resolve;const pending = new Promise((done) => { resolve = done; });
  const handle = isolatedHandler(async () => { calls++; return pending; });
  const early = new AbortController();early.abort();
  assert.equal((await handle(request("POST", action, {}, early.signal), "development")).status, 409);
  assert.equal(calls, 0);
  const accepted = new AbortController();await handle(request("POST", action, {}, accepted.signal), "development");
  accepted.abort();resolve(inventedCustodianExecution());
  assert.equal((await finished(handle)).state, "checked");assert.equal(calls, 1);
});

test("result contract cannot accept source contact, premature cleanup or public qualification", () => {
  const saved = inventedCustodianExecution();assert.deepEqual(parsePrivateCustodianExecution(saved), saved);
  for (const [key, value] of [["sourceRequests", false], ["sourceRequests", 1], ["modelCalls", 1], ["savedPairs", true],
    ["originalHttpModuleExecuted", true], ["publicQualificationIssued", true], ["sourcePermissionIssued", true],
    ["ownedProcessesEnded", false], ["checkpointAdvanced", true], ["rawPath", "/private/canary"]]) {
    assert.throws(() => parsePrivateCustodianExecution({ ...saved, [key]: value }));
  }
  assert.throws(() => parsePrivateCustodianOperationStatus({ state: "checked", result: saved, privatePath: "canary" }));
});

test("retained execution is a distinct strict result without promoting legacy history", () => {
  const legacy = inventedCustodianExecution();
  const retained = { ...legacy, evidenceKind: "fresh_invented_retained_custodian_result", retainedStoreTransaction: true };
  assert.deepEqual(parsePrivateCustodianExecution(retained), retained);
  assert.deepEqual(parsePrivateCustodianExecution(legacy), legacy);
  for (const changed of [{ ...retained, retainedStoreTransaction: false }, { ...retained, retainedStoreTransaction: 1 },
    { ...retained, rawRoot: "private-canary" }, { ...legacy, retainedStoreTransaction: true }]) {
    assert.throws(() => parsePrivateCustodianExecution(changed));
  }
  const { retainedStoreTransaction, ...missing } = retained;
  assert.throws(() => parsePrivateCustodianExecution(missing));
});

test("the trial parent receives discovery variables without development secrets or injection overrides", () => {
  const parent = { PATH: "/trusted/bin", HOME: "/private/home", SUPABASE_SERVICE_ROLE_KEY: "private-canary",
    PYTHONPATH: "/injected", UV_ENV_FILE: "/private/.env", UV_NO_ENV_FILE: "0", NODE_OPTIONS: "injected" };
  const result = privateCustodianEnvironment(parent);
  assert.deepEqual(result, { PATH: parent.PATH, HOME: parent.HOME, NODE_ENV: "development", UV_CACHE_DIR: "/tmp/terrafracta-uv-cache",
    PYTHONDONTWRITEBYTECODE: "1", UV_NO_ENV_FILE: "1" });
  assert.doesNotMatch(JSON.stringify(result), /private-canary|injected|\.env/);
});

test("v4 journal claims require their exact contract and cannot promote retained history", () => {
  const legacy = inventedCustodianExecution();
  const journaled = { ...legacy, evidenceKind: "fresh_invented_journaled_custodian_result_v4",
    retainedStoreTransaction: true, privateJournalRecorded: true, creatingParentGuardRequested: true,
    nativeCleanupConfirmed: true, remoteRollbackAttested: false, historicalObservationOnly: true };
  assert.deepEqual(parsePrivateCustodianExecution(journaled), journaled);
  for (const changed of [{ ...journaled, nativeCleanupConfirmed: false }, { ...journaled, privateJournalRecorded: false },
    { ...journaled, remoteRollbackAttested: true }, { ...journaled, rawPath: "/private-canary" },
    { ...journaled, evidenceKind: "fresh_invented_retained_custodian_result" }])
    assert.throws(() => parsePrivateCustodianExecution(changed));
  const { privateJournalRecorded, ...missing } = journaled;
  assert.throws(() => parsePrivateCustodianExecution(missing));
  assert.equal(parsePrivateCustodianExecution(legacy).evidenceKind, "fresh_invented_private_custodian_result");
});


test("a new handler reads retained success or interruption without starting another process", async () => {
  for (const saved of [{ state: "checked", result: inventedCustodianExecution() },
    { state: "held", reason: "private_test_unavailable" }]) {
    let starts = 0, reads = 0;
    const operation = { start: async () => { starts++; throw new Error("must not start"); },
      inspect: async () => { reads++; return saved; } };
    const first = createPrivateCustodianHandler(operation);
    assert.deepEqual(await inspect(first), saved);
    const restarted = createPrivateCustodianHandler(operation);
    assert.deepEqual(await (await restarted(request(), "development")).json(), saved);
    assert.deepEqual(await inspect(restarted), saved);assert.equal(starts, 0);assert.equal(reads, 3);
  }
});

test("unavailable or invalid persisted status holds before starting and exposes no diagnostic", async () => {
  for (const read of [async () => { throw new Error("private-path-canary"); },
    async () => ({ state: "checked", result: inventedCustodianExecution(), privatePath: "canary" })]) {
    let starts = 0;const handle = createPrivateCustodianHandler({ inspect: read,
      start: async () => { starts++; return { state: "idle" }; } });
    const response = await handle(request(), "development");
    assert.deepEqual(await response.json(), { state: "held", reason: "private_test_unavailable" });assert.equal(starts, 0);
  }
});

test("read-only refresh detects consumption by another app process", async () => {
  let saved = { state: "idle" }, starts = 0;
  const handle = createPrivateCustodianHandler({ inspect: async () => saved,
    start: async () => { starts++; throw new Error("must not start"); } });
  assert.deepEqual(await inspect(handle), saved);
  saved = { state: "running" };
  assert.deepEqual(await inspect(handle), saved);
  saved = { state: "checked", result: inventedCustodianExecution() };
  assert.deepEqual(await (await handle(request(), "development")).json(), saved);assert.equal(starts, 0);
});
