import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";

const eventId="11111111-1111-4111-8111-111111111111";
const bytes=new TextEncoder().encode(JSON.stringify({eventId,code:"browser_runtime"}));
function request(chunks=[bytes]) {
  const body=new ReadableStream({start(source){for(const part of chunks)source.enqueue(part);source.close();}});
  return new Request("http://127.0.0.1:3000/api/dev/error-log",{method:"POST",body,duplex:"half",
    headers:{"content-type":"application/json",origin:"http://127.0.0.1:3000"}});
}
for(const [phase,values] of [
  ["chunk",[100,120,110,130,140,150]],
  ["EOF",[100,110,130,120,140,150]],
  ["parse",[100,110,120,140,130,150]],
  ["validation",[100,110,120,130,150,140]],
]) test(`native diagnostic ${phase} backward observation refuses before saving a permitted intent`,async()=>{
  let n=0;const saves=[],r=request();
  const intake=createDiagnosticIntake(async(...args)=>{saves.push(args);return "saved";},
    ()=>values[Math.min(n++,values.length-1)]);
  const response=await intake(r,"development");
  assert.equal(response.status,400);assert.equal(await response.text(),"");assert.deepEqual(saves,[]);
  assert.equal(r.body.locked,false);assert.equal(getEventListeners(r.signal,"abort").length,0);
});
test("partial native delivery cannot renew the original observation interval",async()=>{
  const values=[100,110,130,120,140,150,160];let n=0;const saves=[];
  const r=request([bytes.subarray(0,20),bytes.subarray(20)]);
  const intake=createDiagnosticIntake(async(...args)=>{saves.push(args);return "saved";},
    ()=>values[Math.min(n++,values.length-1)]);
  const response=await intake(r,"development");assert.equal(response.status,400);assert.deepEqual(saves,[]);
  assert.equal(r.body.locked,false);assert.equal(getEventListeners(r.signal,"abort").length,0);
});
test("fresh explicit request retains its own equal finite clock and exact two-field sink intent",async()=>{
  let value=-100;const saves=[];
  const intake=createDiagnosticIntake(async(...args)=>{saves.push(args);return "saved";},()=>value);
  for(const origin of [-100,-200]){
    value=origin;const r=request(),response=await intake(r,"development");
    assert.equal(response.status,204);assert.equal(await response.text(),"");
    assert.equal(r.body.locked,false);assert.equal(getEventListeners(r.signal,"abort").length,0);
  }
  assert.deepEqual(saves,[["browser_runtime",eventId],["browser_runtime",eventId]]);
});
