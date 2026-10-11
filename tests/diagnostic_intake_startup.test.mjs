import assert from "node:assert/strict";
import test from "node:test";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";

const eventId = "11111111-1111-4111-8111-111111111111";
const bytes = new TextEncoder().encode(JSON.stringify({ eventId, code: "browser_runtime" }));
function request(t) {
  let reads = 0, cancels = 0, released = 0, added = 0, removed = 0;
  const body = new ReadableStream({ start(source) { source.enqueue(bytes); source.close(); } });
  const value = new Request("http://127.0.0.1:3000/api/dev/error-log", { method: "POST", body, duplex: "half",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" } });
  const getReader = value.body.getReader.bind(value.body);
  t.mock.method(value.body, "getReader", () => {
    const reader = getReader(), read = reader.read.bind(reader), cancel = reader.cancel.bind(reader), release = reader.releaseLock.bind(reader);
    t.mock.method(reader, "read", (...args) => { reads++; return read(...args); });
    t.mock.method(reader, "cancel", (...args) => { cancels++; return cancel(...args); });
    t.mock.method(reader, "releaseLock", (...args) => { released++; return release(...args); });
    return reader;
  });
  const add = value.signal.addEventListener.bind(value.signal), remove = value.signal.removeEventListener.bind(value.signal);
  t.mock.method(value.signal, "addEventListener", (...args) => { added++; add(...args); });
  t.mock.method(value.signal, "removeEventListener", (...args) => { removed++; remove(...args); });
  return { value, state: () => ({ reads, cancels, released, added, removed }), add };
}

test("intake contains a thrown initial clock before body access and a later explicit request succeeds", async t => {
  let failed = true, saves = 0;
  const intake = createDiagnosticIntake(async () => { saves++; return "saved"; }, () => { if (failed) throw new Error("PRIVATE_CLOCK_SETUP"); return 0; });
  const first = request(t); const result = await intake(first.value, "development");
  assert.equal(result.status, 503); assert.equal(await result.text(), ""); assert.equal(saves, 0);
  assert.deepEqual(first.state(), { reads: 0, cancels: 0, released: 0, added: 0, removed: 0 });
  assert.equal(first.value.body.locked, false);
  failed = false; assert.equal((await intake(request(t).value, "development")).status, 204); assert.equal(saves, 1);
});

test("intake timer setup failure never reads its body, cleans the reader and admits a later explicit request", async t => {
  let saves = 0, failed = true;
  const actualTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (...args) => { if (failed) throw new Error("PRIVATE_TIMER_SETUP"); return actualTimeout(...args); });
  const intake = createDiagnosticIntake(async () => { saves++; return "saved"; }, () => 0), first = request(t);
  const result = await intake(first.value, "development");
  assert.equal(result.status, 503); assert.equal(await result.text(), ""); assert.equal(saves, 0);
  const state = first.state(); assert.equal(state.reads, 0); assert.equal(state.cancels, 1); assert.equal(state.released, 1);
  assert.equal(first.value.body.locked, false);
  failed = false; assert.equal((await intake(request(t).value, "development")).status, 204); assert.equal(saves, 1);
});

test("intake partial listener setup failure cleans reader, subscription and timer before any read", async t => {
  let saves = 0, clear = 0;
  t.mock.method(globalThis, "setTimeout", () => 17);
  t.mock.method(globalThis, "clearTimeout", token => { assert.equal(token, 17); clear++; });
  const intake = createDiagnosticIntake(async () => { saves++; return "saved"; }, () => 0), first = request(t);
  t.mock.method(first.value.signal, "addEventListener", (...args) => { first.add(...args); throw new Error("PRIVATE_LISTENER_SETUP"); });
  const result = await intake(first.value, "development");
  assert.equal(result.status, 503); assert.equal(await result.text(), ""); assert.equal(saves, 0);
  const state = first.state(); assert.equal(state.reads, 0); assert.equal(state.cancels, 1); assert.equal(state.released, 1);
  assert.equal(state.removed, 1); assert.equal(clear, 1); assert.equal(first.value.body.locked, false);
  assert.equal((await intake(request(t).value, "development")).status, 204); assert.equal(saves, 1);
});
