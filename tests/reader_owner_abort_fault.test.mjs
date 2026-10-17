import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresReadOwner } from "../src/server/postgres-read-owner.ts";
const config = { host: "db.example.org", port: 5432, database: "terrafracta", user: "fictional_reader",
  password: "FICTITIOUS_TEST_ONLY", transport: { kind: "verified-tls" } };
const turn = () => new Promise(resolve => setImmediate(resolve));
function setup(t, fault) {
  const NativeController = AbortController, parent = new NativeController(), timers = [], clients = [];
  let executions = 0;
  t.mock.method(globalThis, "setTimeout", (callback, ms) => { assert.ok(ms === 250 || ms === 2500); const value = { callback, ms }; timers.push(value); return value; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  if (fault) t.mock.method(globalThis, "AbortController", function () {
    const controller = new NativeController(); controller.abort = () => { throw Error("PRIVATE_READER_ABORT"); }; return controller;
  });
  const owner = createPostgresReadOwner(config, "terrafracta.current-reader", false, async () => {
    let connect, end;
    const connection = new Promise(resolve => { connect = resolve; }), closing = new Promise(resolve => { end = resolve; });
    const client = { connect: () => connection, end: () => { client.ends++; return closing; }, ends: 0,
      on: () => {}, query: () => assert.fail("No SQL may run"), connectDone: connect, closeDone: end };
    clients.push(client); return client;
  }, () => 0);
  const read = () => owner.run(parent.signal, async () => { executions++; return "verified"; });
  return { owner, read, clients, timers, executions: () => executions };
}
for (const mode of ["deadline", "shutdown"]) test(`reader ${mode} abort refusal rejects both observers and keeps both physical slots until acknowledged`, async t => {
  const v = setup(t, true), results = [];
  const a = v.read().then(() => results.push("unexpected"), e => results.push(e.message));
  const b = v.read().then(() => results.push("unexpected"), e => results.push(e.message));
  await turn(); assert.equal(v.clients.length, 2);
  let shutdown;
  if (mode === "deadline") for (const timer of v.timers.filter(v => v.ms === 2500)) assert.doesNotThrow(() => timer.callback());
  else { shutdown = v.owner.shutdown(); shutdown.catch(() => {}); }
  await turn(); assert.deepEqual(results, ["read_unavailable", "read_unavailable"]);
  assert.equal(v.executions(), 0); assert.deepEqual(v.clients.map(c => c.ends), [1, 1]);
  await assert.rejects(v.read(), { message: "read_unavailable" }); assert.equal(v.clients.length, 2);
  for (const client of v.clients) client.connectDone(); await turn();
  await assert.rejects(v.read(), { message: "read_unavailable" });
  for (const client of v.clients) client.closeDone(); await turn(); await Promise.all([a, b]);
  if (shutdown) assert.equal(await shutdown, true);
  assert.equal(await v.owner.shutdown(), true); assert.equal(v.executions(), 0);
});
test("native reader success survives retirement and old deadline callbacks cannot cancel a later read", async t => {
  const v = setup(t, false); const first = v.read(); await turn();
  v.clients[0].connectDone(); await turn(); v.clients[0].closeDone(); assert.equal(await first, "verified");
  const old = v.timers.find(value => value.ms === 2500); const second = v.read(); await turn(); old.callback();
  v.clients[1].connectDone(); await turn(); v.clients[1].closeDone(); assert.equal(await second, "verified");
  assert.equal(v.executions(), 2); assert.equal(await v.owner.shutdown(), true);
});
