import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresReadOwner } from "../src/server/postgres-read-owner.ts";

const config = { host: "db.example.org", port: 5432, database: "terrafracta", user: "fictional_reader",
  password: "FICTITIOUS_TEST_ONLY", transport: { kind: "verified-tls" } };
const turn = () => new Promise(setImmediate);

for (const duringClock of [true, false])
  test(`reader admission preserves two physical clients across initial clock observation: reentry ${duringClock}`, async () => {
    const parent = new AbortController(), clients = [], results = [];
    let owner, initial = true;
    const read = label => {
      const result = owner.run(parent.signal, async () => label);
      results.push(result.then(value => ({ value }), error => ({ error: error.message })));
    };
    owner = createPostgresReadOwner(config, "terrafracta.current-reader", true, async () => {
      let connectDone;
      const connect = new Promise(resolve => { connectDone = resolve; });
      const client = { connect: () => connect, end: async () => { client.ends++; }, on() {},
        query() { assert.fail("no SQL permitted"); }, ends: 0, connectDone };
      clients.push(client); return client;
    }, () => {
      if (initial) {
        initial = false;
        if (duringClock) { read("nested-first"); read("nested-second"); }
      }
      return 0;
    });
    try {
      read("outer");
      if (!duringClock) { read("ordinary-second"); read("ordinary-third"); }
      await turn();
      assert.equal(clients.length, 2, "a clock observation cannot overbook the physical connection budget");
      await assert.rejects(owner.run(parent.signal, async () => assert.fail("capacity is occupied")), { message: "read_unavailable" });
      assert.equal(clients.length, 2, "an occupied owner refuses immediately instead of queuing");
      for (const client of clients) client.connectDone();
      const settled = await Promise.all(results);
      assert.deepEqual(settled.filter(v => v.error), [{ error: "read_unavailable" }]);
      assert.deepEqual(settled.filter(v => v.value).map(v => v.value), duringClock ? ["nested-first", "nested-second"] : ["outer", "ordinary-second"]);
      assert.deepEqual(clients.map(c => c.ends), [1, 1], "refusing a late admission cannot retire either existing owner");
      const retry = owner.run(parent.signal, async () => "explicit-fresh");
      await turn(); assert.equal(clients.length, 3); clients[2].connectDone();
      assert.equal(await retry, "explicit-fresh");
    } finally {
      clients.forEach(client => client.connectDone());
      await Promise.all(results);
      parent.abort();
      assert.equal(await owner.shutdown(), true);
    }
  });
