import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { createPostgresIssueTransport, POSTGRES_CURRENT_ISSUE_SQL } from "../src/server/postgres-issue-provider.ts";
import { createPublicIssueReader, readPublicIssue, PUBLIC_CANDIDATE_BYTES } from "../src/server/public-issue-reader.ts";

const route = () => sample().requestedRoute;
const config = () => ({ host: "db.example.org", port: 5432, database: "terrafracta", user: "fictional_reader",
  password: "FICTITIOUS_TEST_ONLY", transport: { kind: "verified-tls" } });
const held = { status: 503, cacheControl: "no-store" };
const result = value => ({ command: "SELECT", rowCount: 1,
  fields: [{ name: "admitted", dataTypeID: 16 }, { name: "candidate", dataTypeID: 25 }],
  rows: [[true, value === null ? null : JSON.stringify(value)]] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class Client extends EventEmitter {
  connected = 0; ended = 0; queries = [];
  constructor(value = sample()) { super(); this.output = result(value); }
  async connect() { this.connected++; }
  async query(query) { this.queries.push(query); return this.output; }
  async end() { this.ended++; }
}
const signal = () => new AbortController().signal;
const turn = () => new Promise(resolve => setImmediate(resolve));

test("one fresh authenticated result flows through the exact existing reader, then closes; no default activation", async () => {
  const clients = [], options = [];
  const transport = createPostgresIssueTransport(config(), async value => { options.push(value); const c = new Client(); clients.push(c); return c; });
  const read = createPublicIssueReader(transport.readCandidate);
  assert.equal((await read(route())).status, 200);
  assert.equal((await read(route())).status, 200);
  assert.equal(clients.length, 2); assert.ok(clients.every(c => c.connected === 1 && c.ended === 1 && c.queries.length === 1));
  assert.deepEqual(clients[0].queries[0].values, [route().jurisdictionSlug, route().issueSlug]);
  assert.equal(clients[0].queries[0].text, POSTGRES_CURRENT_ISSUE_SQL);
  assert.equal(clients[0].queries[0].rowMode, "array");
  for (const value of options) {
    assert.equal(value.password, "FICTITIOUS_TEST_ONLY"); assert.ok(Object.isFrozen(value));
    assert.equal(value.ssl.rejectUnauthorized, true); assert.equal(value.pipeline, false);
    assert.ok(value.options.includes("default_transaction_read_only=on"));
    assert.ok(value.options.includes("client_connection_check_interval=100"));
    assert.equal(value.connectionString, undefined);
  }
  assert.deepEqual(await readPublicIssue(route()), held);
  assert.equal(await transport.shutdown(), true);
  await assert.rejects(transport.readCandidate(route(), signal()), { message: "read_unavailable" });
  assert.equal(clients.length, 2);
});

test("admitted SQL null means absence, denied principal and unchecked results mean unavailable", async () => {
  const c = new Client(null);
  const transport = createPostgresIssueTransport(config(), async () => c);
  const read = createPublicIssueReader(transport.readCandidate);
  assert.deepEqual(await read(route()), { status: 404, cacheControl: "no-store" });
  c.output.rows = [[false, null]];
  assert.deepEqual(await read(route()), held);
  c.output = result(sample()); c.output.rows.push([true, "null"]);
  assert.deepEqual(await read(route()), held);
  c.output = result(sample()); c.output.fields[1].dataTypeID = 3802;
  assert.deepEqual(await read(route()), held);
  assert.equal(await transport.shutdown(), true);
});

test("changed head, revoked rights, foreign routes and malformed candidate bytes never become old claims", async () => {
  const c = new Client(); const t = createPostgresIssueTransport(config(), async () => c);
  const read = createPublicIssueReader(t.readCandidate);
  assert.equal((await read(route())).status, 200);
  const revoked = sample(); revoked.sources[0].registration.allow_public_derived = false;
  c.output = result(revoked); assert.deepEqual(await read(route()), held);
  const head = sample(); head.head.current_publication_id = "00000000-0000-4000-8000-000000000099";
  c.output = result(head); assert.deepEqual(await read(route()), held);
  c.output = result(sample()); assert.deepEqual(await read({ ...route(), issueSlug: "different-issue" }), held);
  c.output.rows = [[true, "invalid-json"]]; assert.deepEqual(await read(route()), held);
  c.output.rows = [[true, "é".repeat(Math.floor(PUBLIC_CANDIDATE_BYTES / 2) + 1)]];
  assert.deepEqual(await read(route()), held);
  assert.equal(await t.shutdown(), true);
});

test("invalid routes, aborted inputs and closed selectors do not construct a connection", async () => {
  let factories = 0;
  const t = createPostgresIssueTransport(config(), async () => { factories++; return new Client(); });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(t.readCandidate(route(), abort.signal), { message: "read_unavailable" });
  for (const bad of [{ ...route(), sql: "PRIVATE_CANARY" }, { ...route(), issueSlug: "../canary" }, null])
    await assert.rejects(t.readCandidate(bad, signal()), { message: "read_unavailable" });
  for (const bad of [{ ...config(), connectionString: "PRIVATE_CANARY" }, { ...config(), password: "" },
    { ...config(), host: "/tmp/private" }, { ...config(), host: "db.example.org/path" },
    { ...config(), transport: { kind: "verified-tls", rejectUnauthorized: false } },
    { ...config(), transport: { kind: "verified-tls", key: "PRIVATE_CANARY" } },
    { ...config(), port: 0 }, { ...config(), user: "owner; DROP ROLE canary" }])
    assert.throws(() => createPostgresIssueTransport(bad), { message: "read_unavailable" });
  assert.equal(factories, 0); assert.equal(await t.shutdown(), true);
});

test("cleartext is an explicit literal-loopback development exception and cannot survive a mode change", async () => {
  const old = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const local = { ...config(), host: "127.0.0.1", transport: { kind: "loopback-development" } };
    assert.throws(() => createPostgresIssueTransport(local), { message: "read_unavailable" });
    process.env.NODE_ENV = "development";
    for (const host of ["localhost", "db.internal", "127.0.0.2"])
      assert.throws(() => createPostgresIssueTransport({ ...local, host }), { message: "read_unavailable" });
    let calls = 0; const t = createPostgresIssueTransport(local, async options => { calls++; assert.equal(options.ssl, false); return new Client(); });
    assert.equal((await createPublicIssueReader(t.readCandidate)(route())).status, 200);
    process.env.NODE_ENV = "production";
    await assert.rejects(t.readCandidate(route(), signal()), { message: "read_unavailable" });
    assert.equal(calls, 1); assert.equal(await t.shutdown(), true);
  } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});

test("abort during query closes once, reports no private error and withholds a late result", async () => {
  const answer = deferred(); const c = new Client();
  c.query = async query => { c.queries.push(query); return answer.promise; };
  const t = createPostgresIssueTransport(config(), async () => c);
  const abort = new AbortController(); const read = createPublicIssueReader(t.readCandidate);
  const pending = read(route(), abort.signal); await turn(); abort.abort();
  assert.deepEqual(await pending, held); assert.equal(c.ended, 1);
  answer.resolve(result(sample())); await turn();
  assert.equal(await t.shutdown(), true); assert.equal(c.ended, 1);
});

test("two owned slots include unresolved acquisition; overflow never queues or creates more clients", async () => {
  const factories = [deferred(), deferred()]; let calls = 0;
  const t = createPostgresIssueTransport(config(), async () => factories[calls++].promise);
  const a = new AbortController(), b = new AbortController();
  const reads = [t.readCandidate(route(), a.signal), t.readCandidate(route(), b.signal)];
  await assert.rejects(t.readCandidate(route(), signal()), { message: "read_unavailable" });
  assert.equal(calls, 2); a.abort(); b.abort();
  await Promise.all(reads.map(p => assert.rejects(p, { message: "read_unavailable" })));
  assert.equal(await t.shutdown(), false);
  const clients = [new Client(), new Client()]; factories.forEach((f, i) => f.resolve(clients[i]));
  await turn(); assert.equal(await t.shutdown(), true);
  assert.ok(clients.every(c => c.connected === 0 && c.queries.length === 0 && c.ended === 1));
});

test("unacknowledged cleanup withholds success and retains capacity until the same close acknowledges", async () => {
  const ending = deferred(); const clients = [];
  const t = createPostgresIssueTransport(config(), async () => {
    const c = new Client(); c.end = async () => { c.ended++; return ending.promise; }; clients.push(c); return c;
  });
  const read = createPublicIssueReader(t.readCandidate);
  assert.deepEqual(await read(route()), held); assert.deepEqual(await read(route()), held);
  assert.deepEqual(await read(route()), held); assert.equal(clients.length, 2);
  assert.equal(await t.shutdown(), false); assert.ok(clients.every(c => c.ended === 1));
  ending.resolve(); await turn(); assert.equal(await t.shutdown(), true);
});

test("connection, query and asynchronous client failures stay detail-free and close owned clients", async () => {
  for (const phase of ["connect", "query", "event"]) {
    const c = new Client();
    if (phase === "connect") c.connect = async () => { throw new Error("PRIVATE_PASSWORD_CANARY"); };
    if (phase === "query") c.query = async () => { throw new Error("PRIVATE_SQL_CANARY"); };
    if (phase === "event") c.connect = async () => { c.emit("error", new Error("PRIVATE_PATH_CANARY")); };
    const t = createPostgresIssueTransport(config(), async () => c);
    assert.deepEqual(await createPublicIssueReader(t.readCandidate)(route()), held);
    await turn(); assert.equal(c.ended, 1); assert.equal(await t.shutdown(), true);
  }
});

test("native-driver forcing is refused without creating a database connection", async () => {
  const old = process.env.NODE_PG_FORCE_NATIVE;
  try {
    process.env.NODE_PG_FORCE_NATIVE = "1";
    const t = createPostgresIssueTransport(config());
    assert.deepEqual(await createPublicIssueReader(t.readCandidate)(route()), held);
    assert.equal(await t.shutdown(), true);
  } finally { if (old === undefined) delete process.env.NODE_PG_FORCE_NATIVE; else process.env.NODE_PG_FORCE_NATIVE = old; }
});


test("monotonic expiry withholds late work even before the timer runs", async () => {
  for (const elapsed of [2500, 2700, -1, NaN, Infinity]) {
    let clock = 0; const c = new Client();
    c.query = async () => { clock = elapsed; return result(sample()); };
    const t = createPostgresIssueTransport(config(), async () => c, () => clock);
    assert.deepEqual(await createPublicIssueReader(t.readCandidate)(route()), held);
    assert.equal(await t.shutdown(), true); assert.equal(c.ended, 1);
  }
  let calls = 0;
  const t = createPostgresIssueTransport(config(), async () => {calls++;return new Client();}, () => NaN);
  await assert.rejects(t.readCandidate(route(),signal()),{message:"read_unavailable"});
  assert.equal(calls,0);assert.equal(await t.shutdown(),true);
});

test("rejected close acknowledgement holds capacity and shutdown never claims completion", async () => {
  const clients=[];
  const t=createPostgresIssueTransport(config(),async()=>{
    const c=new Client();c.end=async()=>{c.ended++;throw new Error("PRIVATE_CLOSE_CANARY");};clients.push(c);return c;
  });
  const read=createPublicIssueReader(t.readCandidate);
  for(let i=0;i<3;i++)assert.deepEqual(await read(route()),held);
  assert.equal(clients.length,2);assert.ok(clients.every(c=>c.ended===1));
  assert.equal(await t.shutdown(),false);
});


test("environment replication/binary selectors cannot construct the default connection", async () => {
  for (const key of ["PGREPLICATION", "PGBINARY"]) {
    const old=process.env[key];
    try {
      process.env[key]=key==="PGREPLICATION"?"database":"true";
      const t=createPostgresIssueTransport(config());
      assert.deepEqual(await createPublicIssueReader(t.readCandidate)(route()),held);
      assert.equal(await t.shutdown(),true);
    } finally {if(old===undefined)delete process.env[key];else process.env[key]=old;}
  }
});
