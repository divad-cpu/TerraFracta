import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { handleFictionalUpdateRequest } from "../src/server/fictional-update-operation.ts";
import { createPrivateCustodianHandler } from "../src/server/private-custodian-operation.ts";
const saved=JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json",import.meta.url),"utf8"));
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const shapes=[
 ["EOF",[100,120,110,130,140,150],false],
 ["post-read",[100,110,130,120,140,150],false],
 ["validation",[100,110,120,140,130,150],false],
 ["partial chunk",[100,130,120,140,150,160],true],
];
function setup(kind){
 let started=0,observed=0,archived=0;const faults=[];
 const record=async(...args)=>{faults.push(args);return "saved";};
 const handler=kind==="update" ? r=>handleFictionalUpdateRequest(r,"development",async()=>{
  started++;return {...structuredClone(saved),trigger:"manual",scheduledDueAt:null,requestKey:"fictional:manual:2026w40"};
 },async()=>{archived++;},record) : createPrivateCustodianHandler({inspect:async()=>{observed++;return {state:"idle"};},start:async()=>{started++;return {state:"held",reason:"private_test_unavailable"};}},{status:{state:"idle"}},record);
 return {invoke:r=>handler(r,"development"),counts:()=>({started,observed,archived}),faults};
}
function request(kind,partial=false){
 const raw=new TextEncoder().encode(kind==="update"?'{"trigger":"manual"}':'{"action":"run_invented_custodian"}');
 const body=new ReadableStream({start(c){if(partial){c.enqueue(raw.subarray(0,10));c.enqueue(raw.subarray(10));}else c.enqueue(raw);c.close();}});
 return new Request(`http://127.0.0.1:3000/api/dev/${kind==="update"?"update-rehearsal":"private-custodian"}`,{method:"POST",body,duplex:"half",headers:{origin:"http://127.0.0.1:3000","content-type":"application/json"}});
}
for(const kind of ["update","custodian"]){
 for(const [phase,values,partial] of shapes)test(`${kind} fixed action holds positive backward ${phase} history before any operation`,async t=>{
  let n=0;t.mock.method(performance,"now",()=>values[Math.min(n++,values.length-1)]);
  const s=setup(kind),r=request(kind,partial),response=await s.invoke(r);await tick();
  assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:kind==="update"?"invalid_rehearsal_request":"invalid_private_test_request"});
  assert.deepEqual(s.counts(),{started:0,observed:0,archived:0});assert.deepEqual(s.faults,[]);assert.equal(r.body.locked,false);
 });
 for(const bad of [null,false,"0"])test(`${kind} fixed action refuses non-native ${typeof bad}:${String(bad)} ticks`,async t=>{
  let n=0;t.mock.method(performance,"now",()=>n++===0?-100:bad);
  const s=setup(kind),r=request(kind),response=await s.invoke(r);await tick();
  assert.equal(response.status,400);assert.deepEqual(s.counts(),{started:0,observed:0,archived:0});assert.deepEqual(s.faults,[]);assert.equal(r.body.locked,false);
 });
 test(`${kind} fixed action keeps equal negative ticks and independently earlier request origins`,async t=>{
  let value=-100;t.mock.method(performance,"now",()=>value);
  for(const origin of [-100,-200]){value=origin;const s=setup(kind),r=request(kind),response=await s.invoke(r);await tick();
   assert.equal(response.status,kind==="update"?200:202);assert.deepEqual(s.counts(),kind==="update"?{started:1,observed:0,archived:1}:{started:1,observed:1,archived:0});assert.deepEqual(s.faults,[]);assert.equal(r.body.locked,false);
  }
 });
}
