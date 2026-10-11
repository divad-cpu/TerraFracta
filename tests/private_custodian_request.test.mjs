import assert from "node:assert/strict";
import test from "node:test";
import { requestPrivateCustodianStatus } from "../src/private-custodian-request.ts";

test("browser requests use the fixed endpoint/action and never retry a refused POST", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push([url, options]);return Response.json({ state: "idle" });
  });
  const outer = new AbortController();
  assert.deepEqual(await requestPrivateCustodianStatus("GET", outer.signal), { state: "idle" });
  assert.deepEqual(await requestPrivateCustodianStatus("POST", outer.signal), { state: "idle" });
  assert.equal(calls.length, 2);assert.ok(calls.every(([url]) => url === "/api/dev/private-custodian"));
  assert.equal(calls[0][1].body, undefined);assert.equal(calls[1][1].body, '{"action":"run_invented_custodian"}');
  t.mock.method(globalThis, "fetch", async () => { calls.push("refused");throw new Error("invented refusal"); });
  await assert.rejects(requestPrivateCustodianStatus("POST", outer.signal));assert.equal(calls.length, 3);
});

test("unmount or timeout cancels only the in-flight browser request", async (t) => {
  let accepted, signal, calls = 0, fireTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => {
    assert.equal(milliseconds, 5_000);fireTimeout = callback;return 1;
  });
  t.mock.method(globalThis, "clearTimeout", () => {});
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;signal = options.signal;
    return new Promise((_resolve, reject) => {
      accepted = true;signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
  });
  const outer = new AbortController();const pending = requestPrivateCustodianStatus("POST", outer.signal);
  assert.equal(accepted, true);outer.abort();await assert.rejects(pending);assert.equal(signal.aborted, true);
  const other = new AbortController();const timed = requestPrivateCustodianStatus("GET", other.signal);
  fireTimeout();await assert.rejects(timed);assert.equal(other.signal.aborted, false);assert.equal(calls, 2);
  await assert.rejects(requestPrivateCustodianStatus("POST", outer.signal));assert.equal(calls, 2);
});

test("unavailable or private-field replies cannot become a displayed result", async (t) => {
  for (const response of [Response.json({ state: "idle" }, { status: 503 }),
    Response.json({ state: "held", reason: "private_test_unavailable", rawBody: "private-canary" })]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(requestPrivateCustodianStatus("GET", new AbortController().signal));
  }
});
