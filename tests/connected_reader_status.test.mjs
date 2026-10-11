import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectedStatusIdentity, connectedStatusPayload, interpretConnectedStatus } from "../src/connected-reader-status.ts";
import { handleConnectedReaderStatus } from "../src/server/connected-reader-status.ts";
import { startConnectedReaderWatch } from "../src/connected-reader-watch.ts";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";

const snapshot = () => ({ ...connectedInput(), generation: 1 });
const outcome = (s) => ({ kind: "snapshot", snapshot: s });
const request = (options = {}) => new Request("http://127.0.0.1:3100/api/dev/connected-reader", {
  headers: { "sec-fetch-site": "same-origin", "x-terrafracta-edition": "1", ...options.headers }, ...options,
});
test("actual read-only status handler reveals only current identity and no claim or private fields", async () => {
  const saved = snapshot(); saved.privateCanary = "must-not-leak";
  const calls = [];
  const response = await handleConnectedReaderStatus(request(), "development", async (edition) => { calls.push(edition); return outcome(saved); });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.deepEqual(payload, connectedStatusPayload(outcome(saved)));
  assert.ok(!JSON.stringify(payload).includes("must-not-leak")); assert.ok(!JSON.stringify(payload).includes("27.4"));
  assert.ok(!JSON.stringify(payload).includes("example.org")); assert.deepEqual(calls, [1]);
});
test("production, foreign authority, queries and invalid edition never reach storage", async () => {
  const read = async () => assert.fail("private store must stay unused");
  for (const environment of ["production", "test", undefined]) assert.equal((await handleConnectedReaderStatus(request(), environment, read)).status, 404);
  for (const bad of [request({ method: "POST" }),
    new Request("http://127.0.0.1:3100/api/dev/connected-reader?path=/private", { headers: { "sec-fetch-site": "same-origin", "x-terrafracta-edition": "1" } }),
    request({ headers: { origin: "https://other.example", "x-terrafracta-edition": "1" } }),
    request({ headers: { "sec-fetch-site": "cross-site", "x-terrafracta-edition": "1" } }),
    request({ headers: { "sec-fetch-site": "same-origin", host: "foreign.example", "x-terrafracta-edition": "1" } })]) {
    assert.ok((await handleConnectedReaderStatus(bad, "development", read)).status >= 400);
  }
  for (const edition of [null, "0", "129", "1,2", "../1"]) {
    const headers = { "sec-fetch-site": "same-origin" }; if (edition !== null) headers["x-terrafracta-edition"] = edition;
    assert.equal((await handleConnectedReaderStatus(request({ headers }), "development", read)).status, 400);
  }
});
test("newer, unavailable or throwing readbacks expose no old wording or failure details", async () => {
  for (const read of [async () => ({ kind: "changed", currentGeneration: 2 }), async () => ({ kind: "unavailable" }), async () => { throw new Error("private-path-canary"); }]) {
    const response = await handleConnectedReaderStatus(request(), "development", read);
    const text = await response.text(); assert.ok(!text.includes("27.4")); assert.ok(!text.includes("canary"));
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
test("status parser refuses substituted execution, publication, state and private claim fields", () => {
  const saved = snapshot(), expected = connectedStatusIdentity(saved), good = connectedStatusPayload(outcome(saved));
  assert.deepEqual(interpretConnectedStatus(good, expected), { kind: "current" });
  for (const change of [{ generation: 2 }, { executionId: randomUUID() }, { publicationId: randomUUID() }, { state: "suppressed" }, { observedAt: "2026-10-01T11:00:00Z" }, { privateClaim: "canary" }]) {
    assert.deepEqual(interpretConnectedStatus({ ...good, ...change }, expected), { kind: "unavailable" });
  }
  assert.deepEqual(interpretConnectedStatus({ schemaVersion: 1, kind: "changed", currentGeneration: 2 }, expected), { kind: "changed", currentGeneration: 2 });
  for (const generation of [0, 1, 129, true]) assert.deepEqual(interpretConnectedStatus({ schemaVersion: 1, kind: "changed", currentGeneration: generation }, expected), { kind: "unavailable" });
});
function controls() {
  const intervals = new Map(), timeouts = new Map(); let id = 0;
  return { intervals, timeouts, visibleNow: true,
    visible() { return this.visibleNow; },
    interval(fn, ms) { assert.equal(ms, 15000); intervals.set(++id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
    timeout(fn, ms) { assert.equal(ms, 3000); timeouts.set(++id, fn); return id; }, clearTimeout(id) { timeouts.delete(id); } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
test("pure watch permits one request, skips hidden views and aborts its own request on stop", async () => {
  const c = controls(), changes = []; let reads = 0, signal, resolve;
  const s = snapshot(), expected = connectedStatusIdentity(s);
  const watch = startConnectedReaderWatch(expected, (value) => changes.push(value), async (_identity, selected) => { reads++; signal = selected; return new Promise((done) => { resolve = done; }); }, c);
  await watch.check(); assert.equal(reads, 1);
  watch.stop(); assert.equal(signal.aborted, true); assert.equal(c.intervals.size, 0);
  resolve(connectedStatusPayload(outcome(s))); await flush(); assert.deepEqual(changes, []); assert.equal(c.timeouts.size, 0);
  const hidden = controls(); hidden.visibleNow = false;
  const h = startConnectedReaderWatch(expected, () => assert.fail("hidden update"), async () => assert.fail("hidden request"), hidden);
  await h.check(); h.stop();
});
test("changed or unavailable watch withholds once and cannot unmask an old edition later", async () => {
  for (const value of [{ schemaVersion: 1, kind: "changed", currentGeneration: 2 }, { schemaVersion: 1, kind: "unavailable" }, { privateCanary: "invalid" }]) {
    const c = controls(), updates = []; let calls = 0;
    const watch = startConnectedReaderWatch(connectedStatusIdentity(snapshot()), (v) => updates.push(v), async () => { calls++; return value; }, c);
    await flush(); await watch.check(); assert.equal(calls, 1); assert.equal(updates.length, 1); assert.equal(c.intervals.size, 0); watch.stop();
  }
});
test("a timed-out pure watch aborts and reports only unavailable", async () => {
  const c = controls(), updates = [];
  const watch = startConnectedReaderWatch(connectedStatusIdentity(snapshot()), (v) => updates.push(v), async (_expected, signal) => new Promise((_done, reject) => signal.addEventListener("abort", () => reject(new Error("private transport canary")), { once: true })), c);
  for (const fn of c.timeouts.values()) fn(); await flush();
  assert.deepEqual(updates, [{ kind: "unavailable" }]); assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0); watch.stop();
});
