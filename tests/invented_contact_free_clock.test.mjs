import assert from "node:assert/strict";
import test from "node:test";
import { createInventedContactFreeClock as create, observeInventedContactFreeClock as read } from "../src/invented-contact-free-clock.ts";
const NOW=Date.parse("2026-10-08T10:00:00Z"),held={kind:"held"};
const fresh=()=>create({kind:"fresh_invented_clock",utcAtMs:NOW});
test("issued clock jointly owns fixture UTC and captured native monotonic progression",async()=>{
 const clock=fresh();assert.equal(clock.kind,"ready");const a=read(clock.token);await new Promise(r=>setImmediate(r));const b=read(clock.token);
 assert.equal(a.utcAtMs,NOW);assert.equal(b.utcAtMs,NOW);assert.ok(b.observationAtMs>=a.observationAtMs);assert.equal(Object.isFrozen(clock.token),true);
 assert.equal(clock.advanceForTrial({utcAtMs:NOW+100,observationDeltaMs:2100}).kind,"advanced_invented");const c=read(clock.token);
 assert.equal(c.utcAtMs,NOW+100);assert.ok(c.observationAtMs-b.observationAtMs>=2100);
});
test("decoded/copied/proxied tokens and raw callbacks cannot establish owned clock provenance",()=>{
 const clock=fresh();for(const token of [{},JSON.parse(JSON.stringify(clock.token)),new Proxy(clock.token,{}),()=>NOW,null])assert.deepEqual(read(token),held);
});
test("lost context remains held and cannot be restarted by trial advance",()=>{
 const clock=fresh();clock.loseContextForTrial();assert.deepEqual(read(clock.token),held);assert.deepEqual(clock.advanceForTrial({utcAtMs:NOW+1}),held);
});
for(const [name,input] of [["UTC reversal",{utcAtMs:NOW-1}],["negative delta",{observationDeltaMs:-1}],
 ["nonfinite",{observationDeltaMs:Infinity}],["overflow",{utcAtMs:Number.MAX_SAFE_INTEGER}],
 ["empty",{}],["extra context",{utcAtMs:NOW,details:"INVENTED_PRIVATE_CANARY"}]])test(`invalid ${name} permanently holds clock continuity`,()=>{
 const clock=fresh();assert.deepEqual(clock.advanceForTrial(input),held);assert.deepEqual(read(clock.token),held);
});
test("advance getter cannot reenter a second atomic transition",()=>{
 const clock=fresh();const input={get utcAtMs(){clock.advanceForTrial({utcAtMs:NOW+1});return NOW+2;}};
 assert.deepEqual(clock.advanceForTrial(input),held);assert.deepEqual(read(clock.token),held);
});
test("advance getter context loss cannot return a known snapshot",()=>{
 const clock=fresh();assert.deepEqual(clock.advanceForTrial({get utcAtMs(){clock.loseContextForTrial();return NOW+1;}}),held);assert.deepEqual(read(clock.token),held);
});
test("factory rejects unsupported initialization without any state token",()=>{
 for(const input of [null,{kind:"restored_clock",utcAtMs:NOW},{kind:"fresh_invented_clock",utcAtMs:NOW,email:"INVENTED_PRIVATE_CANARY"}])assert.deepEqual(create(input),held);
});
