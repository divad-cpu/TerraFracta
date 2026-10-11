import assert from "node:assert/strict";
import test from "node:test";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { createInventedContactFreePreparationTrial } from "../src/invented-contact-free-preparation-trial.ts";
const now=Date.parse("2026-10-08T01:00:00Z"), held={kind:"held"};
const identifiers={currentKey:"d8400000-4444-4444-8444-444444444444", previousKey:"d8400000-5555-4555-8555-555555555555",epoch:Math.floor(now/900000)};
const fixture=() => ({kind:"fresh_invented_trial",openReports:0,acceptedAtMs:[]});
const current=() => ({kind:"issue",issue:{...connectedInput().issue,publicationId:"d8400000-6666-4666-8666-666666666666"}});
const text=() => JSON.stringify({schemaVersion:1,requestId:"d8400000-1111-4111-8111-111111111111", draft:{target:deriveCorrectionTarget(current()).target,
  fields:{kind:"incorrect_statement",details:"Invented trial bytes: blåbær 日本語.",sourceUrl:"https://example.org/invented-only"}}});
const request=(value=text(),signal) => new Request("https://example.org/invented",{method:"POST",headers:{"content-type":"application/json"},body:value,duplex:"half",signal});
const trial=(selected=fixture(),clock=() => now,observationClock) => createInventedContactFreePreparationTrial(selected,clock,observationClock);
const flush=() => new Promise(resolve => setImmediate(resolve));
function hanging() { let acknowledge,cancels=0; const pending=new Promise(resolve=>{acknowledge=resolve;});
 return {stream:new ReadableStream({cancel(){cancels++;return pending;}},{highWaterMark:0}),acknowledge,cancels:()=>cancels}; }

test("combined native preparation measures bytes after reserving but never counts a write",async()=>{
 const runner=trial(), result=await runner.prepare(request(),identifiers,current);
 assert.equal(result.kind,"prepared_without_write"); assert.equal(result.bodyBytes,new TextEncoder().encode(text()).length);
 assert.deepEqual(runner.inspection.budget(),{kind:"counts",acceptedInHour:0,openReports:0,reserved:0,unknown:0,addressBuckets:1});
 assert.equal(runner.writer,undefined); assert.equal(runner.recovery,undefined); assert.equal(runner.publish,undefined);
});

test("address attempts gate the sixth preparation before obtaining a body reader",async()=>{
 const runner=trial(); for(let i=0;i<5;i++) assert.equal((await runner.prepare(request(),identifiers,current)).kind,"prepared_without_write");
 const req=request(); let acquired=0; const get=req.body.getReader.bind(req.body); Object.defineProperty(req.body,"getReader",{value(){acquired++;return get();}});
 assert.deepEqual(await runner.prepare(req,identifiers,current),held); assert.equal(acquired,0); assert.equal(req.bodyUsed,false);
});

test("oversized and malformed bytes consume attempts before body validation",async()=>{
 const runner=trial(); for(let i=0;i<5;i++) assert.deepEqual(await runner.prepare(request(i===0?new Uint8Array(16_385):"{private invalid invented fixture}"),identifiers,current),held);
 const req=request(); assert.deepEqual(await runner.prepare(req,identifiers,current),held); assert.equal(req.bodyUsed,false);
 assert.equal(runner.inspection.budget().reserved,0); assert.equal(runner.inspection.budget().acceptedInHour,0);
});

test("full open/global budgets and invalid rotation identifiers never access body",async()=>{
 for(const selected of [{...fixture(),openReports:200},{...fixture(),acceptedAtMs:Array(60).fill(now)}]){
  const runner=trial(selected),req=request();assert.deepEqual(await runner.prepare(req,identifiers,current),held);assert.equal(req.bodyUsed,false);
 }
 const runner=trial();for(const ids of [{...identifiers,epoch:identifiers.epoch-1},{...identifiers,rawAddress:"192.0.2.1"},{...identifiers,currentKey:identifiers.previousKey},null]){
  const req=request();assert.deepEqual(await runner.prepare(req,ids,current),held);assert.equal(req.bodyUsed,false);
 }
});

test("logical quota remains reserved while body is pending and third request never reads",async()=>{
 const runner=trial(),a=hanging(),b=hanging(),ca=new AbortController(),cb=new AbortController();
 const first=runner.prepare(request(a.stream,ca.signal),identifiers,current),second=runner.prepare(request(b.stream,cb.signal),identifiers,current); await flush();
 assert.equal(runner.inspection.budget().reserved,2);assert.equal(runner.inspection.body().activeReads,2);
 const third=request();assert.deepEqual(await runner.prepare(third,identifiers,current),held);assert.equal(third.bodyUsed,false);
 ca.abort();cb.abort();assert.deepEqual(await first,held);assert.deepEqual(await second,held);
 assert.equal(runner.inspection.budget().reserved,0);assert.equal(runner.inspection.body().activeReads,2);
 a.acknowledge();b.acknowledge();await flush();assert.equal(runner.inspection.body().activeReads,0);
});

test("released nonwrite does not release physically stalled cancellation capacity",async()=>{
 const runner=trial(),a=hanging(),b=hanging(),ca=new AbortController(),cb=new AbortController();
 const first=runner.prepare(request(a.stream,ca.signal),identifiers,current),second=runner.prepare(request(b.stream,cb.signal),identifiers,current);await flush();ca.abort();cb.abort();
 await first;await second;const next=request();assert.deepEqual(await runner.prepare(next,identifiers,current),held);assert.equal(next.bodyUsed,false);
 assert.equal(runner.inspection.body().activeReads,2);assert.equal(runner.inspection.budget().reserved,0);
 a.acknowledge();b.acknowledge();await flush();
});

test("context loss during pending transport prevents fresh attempt without cancellation acknowledgement",async()=>{
 const runner=trial(),a=hanging(),pending=runner.prepare(request(a.stream),identifiers,current);await flush();runner.loseContext();
 assert.deepEqual(await pending,held);assert.deepEqual(await runner.prepare(request(),identifiers,current),held);
 assert.equal(runner.inspection.body().activeReads,1);assert.equal(runner.inspection.body().held,true);
 assert.equal(runner.inspection.budget().kind,"held");a.acknowledge();await flush();
});

test("admission clock loses validity after prepared bytes: payload remains withheld",async()=>{
 let time=now;const runner=trial(fixture(),()=>time);
 assert.deepEqual(await runner.prepare(request(),identifiers,()=>{time=now-1;return current();}),held);
 assert.equal(runner.inspection.budget().kind,"held");
});

test("cleanup failure blocks budget and cannot expose a prepared private request",async()=>{
 const runner=trial(),req=request();Object.defineProperty(req.signal,"removeEventListener",{value(){throw Error("invented private cleanup failure");}});
 assert.deepEqual(await runner.prepare(req,identifiers,current),held);assert.equal(runner.inspection.body().held,true);
 assert.equal(runner.inspection.budget().kind,"held");assert.deepEqual(await runner.prepare(request(),identifiers,current),held);
});

test("unavailable/current-changed issue and cancelled parent do not produce accepted counters",async()=>{
 const runner=trial(),changed=current();changed.issue.revision++;
 assert.deepEqual(await runner.prepare(request(),identifiers,()=>changed),held);
 const controller=new AbortController();controller.abort();assert.deepEqual(await runner.prepare(request(undefined,controller.signal),identifiers,current),held);
 assert.equal(runner.inspection.budget().acceptedInHour,0);assert.equal(runner.inspection.budget().openReports,0);
});

test("invalid initial continuity fixture cannot create a fresh preparation service",()=>{
 for(const selected of [{...fixture(),kind:"restored_service"},{...fixture(),openReports:201},null])assert.deepEqual(trial(selected),held);
});


test("regression: final wrapper native aborted getter invalidates before private return",async()=>{
 const runner=trial(fixture(),()=>now,()=>0),req=request();let finalGets=0;
 Object.defineProperty(req.signal,"aborted",{get(){if(runner.inspection.body().activeReads===0&&++finalGets===3)runner.loseContext();return false;}});
 assert.deepEqual(await runner.prepare(req,identifiers,current),held);assert.equal(finalGets,3);
 assert.equal(runner.inspection.body().held,true);assert.equal(runner.inspection.budget().kind,"held");
});
