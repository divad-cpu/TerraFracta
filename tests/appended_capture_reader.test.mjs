import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {getEventListeners} from "node:events";
import {createAppendedCaptureReader,readAppendedCapture} from "../src/server/appended-capture-reader.ts";
import {APPENDED_CAPTURE_READ_SQL} from "../src/server/appended-issue-capture.ts";
const fixture=()=>JSON.parse(readFileSync(new URL("../fixtures/fictional-appended-capture.json",import.meta.url),"utf8"));
const scope=f=>({retainedIntentJson:f.retainedIntentJson,observedAt:f.observedAt});
const raw=f=>Buffer.from(f.rawReceiptJson,"utf8"),tick=()=>new Promise(resolve=>setImmediate(resolve));
const unavailable={kind:"unavailable"};
test("inactive default and invalid independent own input never observe provider clock or diagnostics",async()=>{
 const f=fixture();assert.deepEqual(await readAppendedCapture(scope(f)),{kind:"unconfigured"});
 let calls=0;const no=()=>{calls++;throw Error("PRIVATE_CANARY");},read=createAppendedCaptureReader(no,no,no);
 const inherited=Object.create(scope(f)),hidden=scope(f);Object.defineProperty(hidden,"retainedIntentJson",{enumerable:false});
 const throwing=Object.defineProperty({},"retainedIntentJson",{enumerable:true,get:no});throwing.observedAt=f.observedAt;
 for(const s of [null,[],{},inherited,hidden,{...scope(f),sql:"PRIVATE_CANARY"},{...scope(f),retainedIntentJson:"{}"},{...scope(f),retainedIntentJson:f.retainedIntentJson+" "},{...scope(f),observedAt:"2026-10-15T00:00:00Z"}])assert.deepEqual(await read(s),{kind:"invalid_scope"});
 assert.equal(calls,0);assert.deepEqual(await read(throwing),{kind:"invalid_scope"});assert.equal(calls,1);
});
test("actual retained complete native fixture enters one fixed immutable historical read without a renewed observation",async()=>{
 const f=fixture(),faults=[];let calls=0,seen;
 const read=createAppendedCaptureReader(async(command,signal)=>{calls++;seen=command;assert.ok(signal instanceof AbortSignal);return raw(f);},()=>0,async code=>{faults.push(code);return "saved";});
 const r=await read(scope(f));assert.equal(r.kind,"ok");assert.equal(calls,1);assert.deepEqual(seen,{sql:APPENDED_CAPTURE_READ_SQL,values:[JSON.parse(f.retainedIntentJson).capture_id]});
 assert.ok(Object.isFrozen(seen)&&Object.isFrozen(seen.values));assert.equal(r.stored.observedAt,f.observedAt);assert.equal(r.stored.receiptSha256,f.receiptSha256);
 assert.equal(r.stored.bundle.proposalJson,Buffer.from(JSON.parse(f.rawReceiptJson).parts_base64[4],"base64").toString("utf8"));assert.match(r.stored.evidenceState,/historical.*not_current/);assert.deepEqual(faults,[]);
});
test("caller getters are captured once before await and later caller edits cannot redirect the read",async()=>{
 const f=fixture(),input=scope(f);let reads=0,release,command;
 Object.defineProperty(input,"retainedIntentJson",{enumerable:true,configurable:true,get(){reads++;return f.retainedIntentJson;}});
 const pending=new Promise(resolve=>{release=resolve;});const waiting=createAppendedCaptureReader((c)=>{command=c;return pending;},()=>0,async()=>"saved")(input);
 Object.defineProperty(input,"retainedIntentJson",{value:"PRIVATE_CANARY",enumerable:true});input.observedAt="2099-01-01T00:00:00.000000Z";
 await tick();release(raw(f));const r=await waiting;assert.equal(r.kind,"ok");assert.equal(reads,1);assert.equal(r.stored.observedAt,f.observedAt);assert.equal(command.values[0],JSON.parse(f.retainedIntentJson).capture_id);
});
test("whole receipt corruption foreign selection byte brands UTF8 and chronology withhold every private part",async()=>{
 const f=fixture(),changed=JSON.parse(f.rawReceiptJson);changed.capture.runId="00000000-0000-4000-8000-000000000999";
 const duplicate=f.rawReceiptJson.replace(/"schema_version"\s*:\s*1/,'"schema_version": false, "schema_version": 1');assert.notEqual(duplicate,f.rawReceiptJson);
 const bad=[undefined,null,raw(f).toString(),{},Buffer.alloc(131073),Buffer.from([255]),Buffer.concat([Buffer.from([239,187,191]),raw(f)]),Buffer.from(JSON.stringify(changed)),Buffer.from("{}")];
 bad.push(Buffer.from(duplicate));
 for(const bytes of bad){const faults=[];assert.deepEqual(await createAppendedCaptureReader(async()=>bytes,()=>0,async(...args)=>{faults.push(args);return "saved";})(scope(f)),unavailable);await tick();assert.deepEqual(faults,[["operator_audit_read"]]);}
 const faults=[];assert.deepEqual(await createAppendedCaptureReader(async()=>raw(f),()=>0,async(...args)=>{faults.push(args);return "saved";})({...scope(f),observedAt:"2026-10-15T00:00:00.000000Z"}),unavailable);await tick();assert.deepEqual(faults,[["operator_audit_read"]]);
 const shadow=raw(f);Object.defineProperty(shadow,"byteLength",{get(){throw Error("PRIVATE_CANARY");}});assert.equal((await createAppendedCaptureReader(async()=>shadow,()=>0,async()=>"saved")(scope(f))).kind,"ok");
});
test("preabort avoids dispatch and midflight cancellation is prompt silent consumes late failure and releases listener",async()=>{
 const f=fixture(),faults=[];let calls=0,reject;
 const pre=new AbortController();pre.abort();const read=createAppendedCaptureReader(async()=>{calls++;return raw(f);},()=>0,async code=>{faults.push(code);return "saved";});assert.deepEqual(await read(scope(f),pre.signal),unavailable);assert.equal(calls,0);
 const parent=new AbortController(),pending=new Promise((_resolve,r)=>{reject=r;});let inner;
 const waiting=createAppendedCaptureReader((_c,s)=>{inner=s;return pending;},()=>0,async code=>{faults.push(code);return "saved";})(scope(f),parent.signal);
 await tick();assert.equal(getEventListeners(parent.signal,"abort").length,1);parent.abort();assert.deepEqual(await waiting,unavailable);assert.equal(inner.aborted,true);assert.equal(getEventListeners(parent.signal,"abort").length,0);
 reject(Error("PRIVATE_LATE_CANARY"));await tick();assert.deepEqual(faults,[]);
});
test("finite monotonic whole read budget refuses deadline equality rollback and clock exceptions without dispatching expired work",async()=>{
 const f=fixture();let calls=0;
 for(const values of [[NaN],[Infinity],[0,3000],[0,-1],[0,0,3000],[0,0,1,0],[0,0,1,3000]]){
  let i=0;const clock=()=>values[Math.min(i++,values.length-1)];assert.deepEqual(await createAppendedCaptureReader(async()=>{calls++;return raw(f);},clock,async()=>"saved")(scope(f)),unavailable);
 }
 assert.deepEqual(await createAppendedCaptureReader(async()=>raw(f),()=>{throw Error("PRIVATE_CLOCK");},async()=>{throw Error("PRIVATE_LOG");})(scope(f)),unavailable);
});
test("timer expiration retires a hanging read and late success cannot become a confirmed result",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});const f=fixture();let release,inner;
 const parent=new AbortController(),pending=new Promise(resolve=>{release=resolve;});
 const waiting=createAppendedCaptureReader((_c,s)=>{inner=s;return pending;},()=>0,async()=>"saved")(scope(f),parent.signal);
 await Promise.resolve();await Promise.resolve();t.mock.timers.tick(3000);assert.deepEqual(await waiting,unavailable);assert.equal(inner.aborted,true);assert.equal(getEventListeners(parent.signal,"abort").length,0);release(raw(f));await Promise.resolve();
});
test("success aborts owned child and isolated cleanup failures cannot replace checked receipt or leak exception text",async t=>{
 const f=fixture(),parent=new AbortController(),faults=[];let inner;
 const remove=parent.signal.removeEventListener.bind(parent.signal);t.mock.method(parent.signal,"removeEventListener",(...args)=>{remove(...args);throw Error("PRIVATE_REMOVE");});
 const r=await createAppendedCaptureReader((_c,s)=>{inner=s;return Promise.resolve(raw(f));},()=>0,async(...args)=>{faults.push(args);throw Error("PRIVATE_LOG");})(scope(f),parent.signal);
 assert.equal(r.kind,"ok");assert.equal(inner.aborted,true);assert.equal(getEventListeners(parent.signal,"abort").length,0);await tick();assert.deepEqual(faults,[["operator_audit_read"]]);
});

test("an earlier input getter cannot hide the second required own descriptor or borrow its prototype value",async()=>{
 const f=fixture();let effects=0;const input=Object.create({observedAt:f.observedAt});
 Object.defineProperty(input,"retainedIntentJson",{enumerable:true,get(){delete input.observedAt;return f.retainedIntentJson;}});input.observedAt=f.observedAt;
 const no=()=>{effects++;throw Error("PRIVATE_CANARY");};assert.deepEqual(await createAppendedCaptureReader(no,no,no)(input),{kind:"invalid_scope"});assert.equal(effects,0);
});
test("timer setup fault does not dispatch and all later cleanup branches still retire independently",async t=>{
 const f=fixture(),parent=new AbortController();let calls=0;const faults=[];
 t.mock.method(globalThis,"setTimeout",()=>{throw Error("PRIVATE_TIMER");});
 assert.deepEqual(await createAppendedCaptureReader(async()=>{calls++;return raw(f);},()=>0,async(...args)=>{faults.push(args);return "saved";})(scope(f),parent.signal),unavailable);
 assert.equal(calls,0);assert.equal(getEventListeners(parent.signal,"abort").length,0);await tick();assert.deepEqual(faults,[["operator_audit_read"]]);
});
test("multiple cleanup faults keep checked data remove listeners and emit one generic diagnostic",async t=>{
 const f=fixture(),parent=new AbortController(),faults=[];let inner;
 const clear=globalThis.clearTimeout,set=globalThis.setTimeout,ours=new Set();
 t.mock.method(globalThis,"setTimeout",function(fn,delay,...args){const timer=Reflect.apply(set,this,[fn,delay,...args]);if(delay===3000)ours.add(timer);return timer;});
 t.mock.method(globalThis,"clearTimeout",(timer)=>{clear(timer);if(ours.has(timer))throw Error("PRIVATE_CLEAR");});
 const remove=parent.signal.removeEventListener.bind(parent.signal);t.mock.method(parent.signal,"removeEventListener",(...args)=>{remove(...args);throw Error("PRIVATE_REMOVE");});
 const r=await createAppendedCaptureReader(async(_c,s)=>{inner=s;return raw(f);},()=>0,async(...args)=>{faults.push(args);return "saved";})(scope(f),parent.signal);
 assert.equal(r.kind,"ok");assert.equal(inner.aborted,true);assert.equal(getEventListeners(parent.signal,"abort").length,0);await tick();assert.deepEqual(faults,[["operator_audit_read"]]);
});
