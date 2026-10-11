import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { handleFictionalUpdateRequest } from "../src/server/fictional-update-operation.ts";
import { parseFictionalUpdateResult } from "../src/fictional-update-result.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
const revised = JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json", import.meta.url), "utf8"));
function report(trigger = "manual") {
  return { ...structuredClone(saved), trigger,
    scheduledDueAt: trigger === "manual" ? null : saved.scheduledDueAt,
    requestKey: trigger === "manual" ? "fictional:manual:2026w40" : saved.requestKey };
}
function scenarioReport(trigger, scenario) {
  if (scenario === "revised_value") return { ...structuredClone(revised), trigger,
    scheduledDueAt: trigger === "manual" ? null : revised.scheduledDueAt,
    requestKey: trigger === "manual" ? "fictional:manual:2026w40" : revised.requestKey };
  const result = report(trigger);
  if (scenario === "missing_source") {
    return { ...result, items: [], state: "partial", coveredSourceKeys: [], fictionalCandidate: null };
  }
  if (scenario === "invalid_citation") {
    Object.assign(result.items[0], { outcome: "held", reasonCodes: ["source_reference_invalid"], source: null, sourceBindingValid: false });
    return { ...result, state: "partial", coveredSourceKeys: [], fictionalCandidate: null };
  }
  return result;
}
function request(body = '{"trigger":"manual"}', options = {}) {
  return new Request("http://127.0.0.1:3000/api/dev/update-rehearsal", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" },
    body, ...options,
  });
}

test("fresh local execution wraps the shared fictional report without changing fixture dates", async () => {
  let seen;
  const response = await handleFictionalUpdateRequest(request(), "development", async (trigger) => {
    seen = trigger; return report(trigger);
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = parseFictionalUpdateResult(await response.json());
  assert.equal(seen, "manual");
  assert.equal(result.report.publicChanges, 0);
  assert.equal(result.report.startedAt, saved.startedAt);
  assert.ok(Math.abs(Date.now() - Date.parse(result.execution.executedAt)) < 5000);
});

test("production and unspecified environments refuse before touching the runner", async () => {
  for (const environment of ["production", "test", undefined]) {
    const response = await handleFictionalUpdateRequest(request(), environment, async () => {
      assert.fail("runner must remain unused");
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  }
});

test("Next internal localhost URL preserves the browser's checked loopback authority", async () => {
  const internal = new Request("http://localhost:3000/api/dev/update-rehearsal", {
    method: "POST", headers: { "content-type": "application/json",
      host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    body: '{"trigger":"manual"}',
  });
  assert.equal((await handleFictionalUpdateRequest(internal, "development", async () => report())).status, 200);
  const foreign = request(undefined, { headers: { "content-type": "application/json",
    host: "evil.example:3000", origin: "http://evil.example:3000" } });
  assert.equal((await handleFictionalUpdateRequest(foreign, "development", async () => assert.fail("foreign authority"))).status, 403);
});

test("cross-origin, foreign host, missing origin and query attempts cannot start a worker", async () => {
  for (const invalid of [
    request(undefined, { headers: { origin: "https://other.example", "content-type": "application/json" } }),
    request(undefined, { headers: { "content-type": "application/json" } }),
    new Request("http://evil.example/api/dev/update-rehearsal", { method: "POST", body: '{"trigger":"manual"}', headers: { origin: "http://evil.example", "content-type": "application/json" } }),
    new Request("http://127.0.0.1:3000/api/dev/update-rehearsal?mode=publish", { method: "POST", body: '{"trigger":"manual"}', headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" } }),
    request(undefined, { headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json", "sec-fetch-site": "cross-site" } }),
  ]) {
    const response = await handleFictionalUpdateRequest(invalid, "development", async () => assert.fail("not admitted"));
    assert.equal(response.status, 403);
  }
});

test("request grammar excludes source URLs, modes, commands, duplicates and oversized bodies", async () => {
  for (const body of [
    '{}', '{"trigger":"manual","mode":"publish_eligible"}',
    '{"trigger":"manual","source":"https://example.org"}',
    '{"trigger":"manual","trigger":"scheduled"}',
    '{"trigger":"manual","scenario":"arbitrary"}',
    '{"trigger":"manual","scenario":"standard","scenario":"missing_source"}',
    '{"trigger":"$(command)"}', '{"trigger":"m\\u0061nual"}',
    '{"trigger":"manual"}' + " ".repeat(129),
  ]) {
    const response = await handleFictionalUpdateRequest(request(body), "development", async () => assert.fail("not admitted"));
    assert.equal(response.status, 400, body);
  }
});

test("unsupported content type and declared body overflow are refused", async () => {
  assert.equal((await handleFictionalUpdateRequest(request(undefined, {
    headers: { origin: "http://127.0.0.1:3000", "content-type": "text/plain" },
  }), "development")).status, 415);
  assert.equal((await handleFictionalUpdateRequest(request(undefined, {
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json", "content-length": "999999" },
  }), "development")).status, 400);
});

test("cancelled valid bodies are refused before runner or saving admission", async () => {
  for (const timing of ["before-body", "during-body"]) {
    const controller = new AbortController();
    let source, calls = 0, saves = 0, diagnostics = 0;
    const body = new ReadableStream({ start(value) { source = value; } });
    if (timing === "before-body") controller.abort();
    const pending = handleFictionalUpdateRequest(request(body, { signal: controller.signal, duplex: "half" }), "development",
      async () => { calls++; return report(); }, async () => { saves++; }, async () => { diagnostics++; return "unavailable"; });
    if (timing === "during-body") {
      await Promise.resolve();
      controller.abort();
    }
    source.enqueue(new TextEncoder().encode('{"trigger":"manual"}'));
    source.close();
    const response = await pending;
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "request_cancelled" });
    assert.equal(calls, 0);assert.equal(saves, 0);assert.equal(diagnostics, 0);
  }
});

test("oversized body refusal returns without a cancellation acknowledgement", async () => {
  for (const cancellation of [new Promise(() => {}), () => Promise.reject(new Error("transport-canary"))]) {
    let cancels = 0, calls = 0, saves = 0, diagnostics = 0;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(129)); },
      cancel() { cancels++; return typeof cancellation === "function" ? cancellation() : cancellation; },
    });
    const timeout = new AbortController();
    try {
      const response = await Promise.race([
        handleFictionalUpdateRequest(request(body, { duplex: "half" }), "development",
          async () => { calls++; return report(); }, async () => { saves++; }, async () => { diagnostics++; return "unavailable"; }),
        delay(300, undefined, { signal: timeout.signal }).then(() => assert.fail("oversize refusal waited for cancellation")),
      ]);
      assert.equal(response.status, 400);assert.equal(cancels, 1);
      assert.equal(calls, 0);assert.equal(saves, 0);assert.equal(diagnostics, 0);
    } finally { timeout.abort(); }
  }
});

test("a completed accepted result remains saved when its caller disconnects", async () => {
  const controller = new AbortController();
  let complete, admitted, saves = 0;
  const started = new Promise(resolve => { admitted = resolve; });
  const pending = handleFictionalUpdateRequest(request(undefined, { signal: controller.signal }), "development", async () => {
    admitted();return new Promise(resolve => { complete = () => resolve(report()); });
  }, async () => { saves++; });
  await started;
  controller.abort();complete();
  assert.equal((await pending).status, 200);assert.equal(saves, 1);
  assert.equal((await handleFictionalUpdateRequest(request(), "development", async () => report())).status, 200,
    "the accepted slot is released only after actual result saving settles");
});

test("scheduled trigger uses the same operation and preserves its exact fixture window", async () => {
  const response = await handleFictionalUpdateRequest(request('{"trigger":"scheduled"}'), "development", async (trigger) => report(trigger));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).report.scheduledDueAt, saved.scheduledDueAt);
});

test("fixed scenarios are passed only as bounded literals and recorded on the execution", async () => {
  for (const scenario of ["standard", "missing_source", "invalid_citation", "revised_value"]) {
    let seen;
    const response = await handleFictionalUpdateRequest(request(JSON.stringify({ trigger: "manual", scenario })), "development", async (trigger, _signal, selection) => {
      seen = selection; return scenarioReport(trigger, selection);
    });
    assert.equal(response.status, 200);
    assert.equal(seen, scenario);
    assert.equal((await response.json()).execution.scenario, scenario);
  }
});

test("a valid report for a substituted fixed example is rejected", async () => {
  for (const [requested, returned] of [["missing_source", "standard"], ["standard", "invalid_citation"], ["invalid_citation", "missing_source"], ["revised_value", "standard"], ["standard", "revised_value"]]) {
    const response = await handleFictionalUpdateRequest(request(JSON.stringify({ trigger: "manual", scenario: requested })), "development", async () => scenarioReport("manual", returned));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "rehearsal_unavailable" });
  }
});

test("a worker failure is generic and does not leak its command or output", async () => {
  const response = await handleFictionalUpdateRequest(request(), "development", async () => {
    throw new Error("private-command-canary /private/source/path");
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "rehearsal_unavailable" });
});

test("the route cannot report success when saving its fictional receipt fails", async () => {
  const response = await handleFictionalUpdateRequest(request(), "development", async () => report(), async () => { throw new Error("private-archive-canary"); });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "rehearsal_unavailable" });
  assert.equal((await handleFictionalUpdateRequest(request(), "development", async () => report())).status, 200, "the single-worker guard is released");
});

test("untrusted worker output cannot claim a live execution or mismatch its trigger", async () => {
  for (const invalid of [
    { ...report(), reportKind: "verified_run" },
    { ...report(), mode: "publish_eligible" },
    { ...report(), privatePath: "/private/canary" },
    report("scheduled"),
  ]) {
    const response = await handleFictionalUpdateRequest(request(), "development", async () => invalid);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "rehearsal_unavailable" });
  }
});

test("only one child can run in the local server process and the guard is released", async () => {
  let release;
  let admitted;
  const started = new Promise((resolve) => { admitted = resolve; });
  const first = handleFictionalUpdateRequest(request(), "development", async () => {
    admitted();
    return new Promise((resolve) => { release = () => resolve(report()); });
  });
  await started;
  const second = await handleFictionalUpdateRequest(request(), "development", async () => assert.fail("overlap"));
  assert.equal(second.status, 429);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await handleFictionalUpdateRequest(request(), "development", async () => report())).status, 200);
});
