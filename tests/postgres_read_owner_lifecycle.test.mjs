import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createPostgresReadOwner } from "../src/server/postgres-read-owner.ts";
import { createPostgresIssueTransport } from "../src/server/postgres-issue-provider.ts";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";

const config = { host: "db.example.org", port: 5432, database: "terrafracta", user: "fictional_reader",
  password: "FICTITIOUS_TEST_ONLY", transport: { kind: "verified-tls" } };
const turn = () => new Promise(resolve => setImmediate(resolve));
class Client extends EventEmitter {
  connected = 0; ended = 0; queries = 0;
  async connect() { this.connected++; }
  async end() { this.ended++; }
  async query() { this.queries++; return { command: "SELECT", rowCount: 1,
    fields: [{ name: "admitted", dataTypeID: 16 }, { name: "candidate", dataTypeID: 25 }],
    rows: [[true, JSON.stringify(sample())]] }; }
}
function parent() {
  const controller = new AbortController(), listeners = new Set();
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (kind, listener, options) => { listeners.add(listener); add(kind, listener, options); };
  controller.signal.removeEventListener = (kind, listener) => { listeners.delete(listener); remove(kind, listener); };
  return { controller, listeners };
}

for (const phase of ["parent-listener", "deadline"]) test(`failed ${phase} setup starts no client and preserves later reader capacity`, async t => {
  const p = parent(), clients = [];
  const owner = createPostgresReadOwner(config, "terrafracta.current-reader", false, async () => {
    const c = new Client(); clients.push(c); return c;
  });
  const added = p.controller.signal.addEventListener;
  if (phase === "parent-listener") t.mock.method(p.controller.signal, "addEventListener", (...args) => { added(...args); throw new Error("PRIVATE_SETUP_CANARY"); });
  else t.mock.method(globalThis, "setTimeout", () => { throw new Error("PRIVATE_SETUP_CANARY"); });
  try {
    for (let n = 0; n < 2; n++) await assert.rejects(owner.run(p.controller.signal, async () => "never"), { message: "read_unavailable" });
    assert.equal(clients.length, 0); assert.equal(p.listeners.size, 0);
    t.mock.restoreAll();
    assert.equal(await owner.run(p.controller.signal, async () => "fresh"), "fresh");
    assert.equal(clients.length, 1); assert.equal(clients[0].ended, 1);
    assert.equal(await owner.shutdown(), true);
  } finally { t.mock.restoreAll(); p.controller.abort(); }
});

test("parent cancellation during registration starts no client and releases unused ownership", async () => {
  const p = parent(); const add = p.controller.signal.addEventListener; let factories = 0;
  p.controller.signal.addEventListener = (...args) => { add(...args); p.controller.abort(); };
  const owner = createPostgresReadOwner(config, "terrafracta.current-reader", false, async () => { factories++; return new Client(); });
  await assert.rejects(owner.run(p.controller.signal, async () => "never"), { message: "read_unavailable" });
  assert.equal(factories, 0); assert.equal(p.listeners.size, 0); assert.equal(await owner.shutdown(), true);
});

for (const phase of ["deadline-clear", "parent-remove"]) test(`${phase} refusal cannot replace a verified reader response or skip independent retirement`, async t => {
  const p = parent(), clients = [], timers = new Set();
  const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (...args) => { const timer = nativeSet(...args); timers.add(timer); return timer; });
  t.mock.method(globalThis, "clearTimeout", timer => { timers.delete(timer); nativeClear(timer); if (phase === "deadline-clear") throw new Error("PRIVATE_CLEANUP_CANARY"); });
  const remove = p.controller.signal.removeEventListener;
  if (phase === "parent-remove") t.mock.method(p.controller.signal, "removeEventListener", (...args) => { remove(...args); throw new Error("PRIVATE_CLEANUP_CANARY"); });
  const transport = createPostgresIssueTransport(config, async () => { const c = new Client(); clients.push(c); return c; });
  try {
    const outcome = await createPublicIssueReader(transport.readCandidate, undefined, async () => "unavailable")(sample().requestedRoute, p.controller.signal);
    assert.equal(outcome.status, 200); assert.equal(clients.length, 1);
    assert.equal(clients[0].queries, 1); assert.equal(clients[0].ended, 1); assert.equal(p.listeners.size, 0); assert.equal(timers.size, 0);
    t.mock.restoreAll(); assert.equal(await transport.shutdown(), true);
  } finally { t.mock.restoreAll(); for (const timer of timers) nativeClear(timer); p.controller.abort(); }
});

test("failed retirement cannot release a cancelled physical acquisition before settlement and close acknowledgement", async t => {
  const p = parent(); let resolve, finish, calls = 0;
  const acquisition = new Promise(done => { resolve = done; }), closing = new Promise(done => { finish = done; });
  const owner = createPostgresReadOwner(config, "terrafracta.current-reader", false, async () => { calls++; return acquisition; });
  const a = owner.run(p.controller.signal, async () => assert.fail("Cancelled work executed"));
  const b = owner.run(p.controller.signal, async () => assert.fail("Cancelled work executed"));
  await turn();
  const remove = p.controller.signal.removeEventListener;
  t.mock.method(p.controller.signal, "removeEventListener", (...args) => { remove(...args); throw new Error("PRIVATE_REMOVE_CANARY"); });
  p.controller.abort();
  try {
    await Promise.all([a,b].map(read => assert.rejects(read, { message: "read_unavailable" })));
    t.mock.restoreAll();
    await assert.rejects(owner.run(new AbortController().signal, async () => "never"), { message: "read_unavailable" });
    assert.equal(calls, 2); assert.equal(await owner.shutdown(), false);
    const client = new Client(); client.end = async () => { client.ended++; return closing; }; resolve(client); await turn();
    assert.equal(client.connected, 0); assert.equal(client.queries, 0); assert.equal(client.ended, 2);
    assert.equal(await owner.shutdown(), false); finish(); await turn(); assert.equal(await owner.shutdown(), true);
  } finally { t.mock.restoreAll(); finish?.(); resolve?.(new Client()); await turn(); }
});

test("an initial clock exception is fixed-detail, acquires no connection and permits an explicit healthy retry", async () => {
  let faulty = true, calls = 0;
  const owner = createPostgresReadOwner(config, "terrafracta.current-reader", false, async () => { calls++; return new Client(); },
    () => { if (faulty) throw Error("PRIVATE_INITIAL_CLOCK_CANARY"); return 0; });
  await assert.rejects(owner.run(new AbortController().signal, async () => "never"), { message: "read_unavailable" });
  assert.equal(calls, 0); faulty = false;
  assert.equal(await owner.run(new AbortController().signal, async () => "fresh"), "fresh");
  assert.equal(calls, 1); assert.equal(await owner.shutdown(), true);
});
