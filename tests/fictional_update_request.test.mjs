import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FictionalUpdateRequestError, requestFictionalUpdate } from "../src/fictional-update-request.ts";

const report = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
const receipt = () => ({ execution: { id: "11111111-1111-4111-8111-111111111111", kind: "local_fictional",
  scenario: "standard", executedAt: "2026-10-02T14:00:00Z", durationMs: 1 }, report: structuredClone(report) });
const unconfirmed = (error) => error instanceof FictionalUpdateRequestError && error.reason === "unconfirmed";

test("fictional request uses one fixed POST and checks its selected trigger and example", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push([url, options]);return Response.json(receipt()); });
  assert.deepEqual(await requestFictionalUpdate("scheduled", "standard", new AbortController().signal), receipt());
  assert.equal(calls.length, 1);assert.equal(calls[0][0], "/api/dev/update-rehearsal");
  assert.equal(calls[0][1].cache, "no-store");assert.equal(calls[0][1].body, '{"trigger":"scheduled","scenario":"standard"}');
  await assert.rejects(requestFictionalUpdate("manual", "standard", new AbortController().signal), unconfirmed);
  await assert.rejects(requestFictionalUpdate("scheduled", "missing_source", new AbortController().signal), unconfirmed);
  assert.equal(calls.length, 3);
});

test("timeout or caller cancellation ends waiting without retry or an invented outcome", async (t) => {
  let fire, calls = 0, cleared = 0;
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => { assert.equal(milliseconds, 20_000);fire = callback;return 1; });
  t.mock.method(globalThis, "clearTimeout", () => { cleared++; });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  });
  const outer = new AbortController(), timed = requestFictionalUpdate("manual", "standard", outer.signal);
  fire();await assert.rejects(timed, unconfirmed);assert.equal(outer.signal.aborted, false);
  const other = new AbortController(), cancelled = requestFictionalUpdate("manual", "standard", other.signal);
  other.abort();await assert.rejects(cancelled, unconfirmed);
  await assert.rejects(requestFictionalUpdate("manual", "standard", other.signal), unconfirmed);
  assert.equal(calls, 2);assert.equal(cleared, 3);
});

test("known refusal categories remain bounded and arbitrary diagnostics are withheld", async (t) => {
  for (const [status, value, reason] of [[429, { error: "private-canary" }, "busy"],
    [503, { error: "fictional_archive_full" }, "archive_full"], [503, { error: "private-canary" }, "unconfirmed"],
    [200, { ...receipt(), privateBody: "private-canary" }, "unconfirmed"]]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++;return Response.json(value, { status }); });
    await assert.rejects(requestFictionalUpdate("scheduled", "standard", new AbortController().signal), (error) => {
      assert.equal(error.reason, reason);assert.ok(!error.message.includes("canary"));return true;
    });
    assert.equal(calls, 1);
  }
});

test("a result arriving after cancellation cannot become a confirmed display", async (t) => {
  let body, fire;
  t.mock.method(globalThis, "setTimeout", (callback) => { fire = callback;return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  // A deliberately non-cooperating byte reader keeps the same late-body seam;
  // cancellation cannot settle the owned read until its explicit result arrives.
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, headers: new Headers(), body: {
    getReader: () => ({ read: () => new Promise(resolve => { body = value => resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(value)) }); }),
      cancel: async () => {}, releaseLock() {} }),
  } }));
  const pending = requestFictionalUpdate("scheduled", "standard", new AbortController().signal);
  await Promise.resolve();await Promise.resolve();fire();body(receipt());
  await assert.rejects(pending, unconfirmed);
});
