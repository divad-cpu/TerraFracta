import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createPostgresReadOwner } from "../src/server/postgres-read-owner.ts";

const config = { host: "db.example.org", port: 5432, database: "terrafracta", user: "fictional_reader",
  password: "FICTITIOUS_TEST_ONLY", transport: { kind: "verified-tls" } };
const signal = () => new AbortController().signal;
const turn = () => new Promise(resolve => setImmediate(resolve));
class Client extends EventEmitter {
  connected=0; ended=0;
  async connect() { this.connected++; }
  async end() { this.ended++; }
}
function fixture(phase) {
  let tick=100, factories=0, callbacks=0;
  const client=new Client();
  const originalConnect=client.connect.bind(client), originalEnd=client.end.bind(client);
  client.connect=async () => { await originalConnect(); if (phase==="connect") tick=110; };
  client.end=async () => { await originalEnd(); if (phase==="close") tick=110; };
  const owner=createPostgresReadOwner(config,"terrafracta.current-reader",false,async () => {
    factories++; tick=120; return client;
  },() => tick);
  const execute=async (_client,active) => {
    callbacks++;
    if (phase==="callback") { tick=140; active(); tick=130; active(); }
    return "fictional-checked-result";
  };
  return { owner,client,execute,setTick: value => { tick=value; }, counts: () => ({ factories,callbacks }) };
}

for (const phase of ["connect","callback","close"]) test(`backward ${phase} observation withholds result and closes owned client`,async () => {
  const f=fixture(phase);
  await assert.rejects(f.owner.run(signal(),f.execute),{ message:"read_unavailable" });
  await turn();
  assert.equal(f.client.ended,1); assert.equal(await f.owner.shutdown(),true);
  assert.equal(f.counts().callbacks,phase==="connect" ? 0 : 1);
});

test("positive elapsed from origin cannot hide an intermediate backward clock",async () => {
  let observations=0, factories=0;
  const ticks=[100,100,140,130,130],client=new Client();
  const owner=createPostgresReadOwner(config,"terrafracta.operator-audit",true,async () => { factories++; return client; },
    () => ticks[Math.min(observations++,ticks.length-1)]);
  await assert.rejects(owner.run(signal(),async () => "fictional-audit"),{ message:"read_unavailable" });
  assert.equal(factories,1);assert.equal(client.ended,1);assert.equal(await owner.shutdown(),true);
});

test("each separately admitted read has its own clock history",async () => {
  let tick=100;const clients=[];
  const owner=createPostgresReadOwner(config,"terrafracta.current-reader",false,async () => {
    const client=new Client();clients.push(client);tick+=10;return client;
  },() => tick);
  assert.equal(await owner.run(signal(),async (_client,active) => { tick+=1;active();return "first"; }),"first");
  tick=5;
  assert.equal(await owner.run(signal(),async (_client,active) => { tick+=1;active();return "second"; }),"second");
  assert.equal(clients.length,2);assert.ok(clients.every(client => client.ended===1));
  assert.equal(await owner.shutdown(),true);
});

test("equal observations and negative origin preserve one bounded healthy read",async () => {
  const client=new Client();
  const owner=createPostgresReadOwner(config,"terrafracta.current-reader",false,async () => client,() => -100);
  assert.equal(await owner.run(signal(),async (_client,active) => { active();active();return "healthy"; }),"healthy");
  assert.equal(client.ended,1);assert.equal(await owner.shutdown(),true);
});

test("clock refusal after a started callback retains physical capacity until settlement",async () => {
  let tick=100,calls=0,finish;
  const waiting=new Promise(resolve => { finish=resolve; });
  const clients=[];
  const owner=createPostgresReadOwner(config,"terrafracta.proposal-worker",true,async () => {
    calls++;const c=new Client();clients.push(c);return c;
  },() => tick);
  const first=owner.run(signal(),async (_client,active) => { tick=140;active();await waiting;tick=130;active();return "late"; });
  const refused=assert.rejects(first,{ message:"read_unavailable" });
  await turn();
  tick=100;
  assert.equal(await owner.run(signal(),async () => "independent"),"independent");
  assert.equal(calls,2);
  finish();await refused;await turn();
  assert.ok(clients.every(c => c.ended===1));assert.equal(await owner.shutdown(),true);
});
