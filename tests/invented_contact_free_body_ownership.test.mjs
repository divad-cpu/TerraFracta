import assert from "node:assert/strict";
import test from "node:test";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { createInventedContactFreeBodyOwnership as create } from "../src/invented-contact-free-body-ownership.ts";
import { createInventedContactFreeClock } from "../src/invented-contact-free-clock.ts";
import { contactFreeCorrectionPolicy as limits } from "../src/contact-free-correction-policy.ts";
const id=n=>`c8700000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const NOW=Date.parse("2026-10-08T10:00:00Z"),held={kind:"held"};
const current=()=>({kind:"issue",issue:{...connectedInput().issue,publicationId:id(1)}});
const packet=(n=2)=>({schemaVersion:1,requestId:id(n),draft:{target:deriveCorrectionTarget(current()).target,
 fields:{kind:"missing_context",details:"INVENTED_PRIVATE_CANARY blåbær 日本語",sourceUrl:"https://example.org/invented"}}});
const request=(body=JSON.stringify(packet()),signal)=>new Request("https://example.org/invented-body",{method:"POST",headers:{"content-type":"application/json"},body,signal,...(body instanceof ReadableStream?{duplex:"half"}:{})});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
function setup(){const clock=createInventedContactFreeClock({kind:"fresh_invented_clock",utcAtMs:NOW});assert.equal(clock.kind,"ready");const owner=create(clock.token);assert.equal(owner.kind,"ready");return{clock,owner};}
function pending(signal){const cancel=deferred();let cancels=0;const body=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancels++;return cancel.promise;}});return{req:request(body,signal),cancel,get cancels(){return cancels;}};}

test("unissued, cloned and proxy clocks hold before any native preparation",()=>{
 const{clock}=setup();for(const token of [{},()=>0,new Proxy(clock.token,{})])assert.deepEqual(create(token),held);
});
test("prepared body retains its own lease until explicit one-shot retirement",async()=>{
 const{owner}=setup(),lease=owner.begin(request(),current);assert.equal(lease.kind,"owned_invented_body");assert.equal(Object.isFrozen(lease.token),true);
 assert.deepEqual(owner.retire(lease.token),held);const outcome=await lease.observation;assert.equal(outcome.kind,"prepared");
 assert.deepEqual(owner.inspection(),{held:false,ownedLeases:1,physicalReads:0});
 assert.deepEqual(owner.retire(lease.token),{kind:"physically_retired_invented_body",preparation:"prepared",contextKnown:true});
 assert.deepEqual(owner.retire(lease.token),held);assert.deepEqual(owner.inspection(),{held:false,ownedLeases:0,physicalReads:0});
 assert.equal(JSON.stringify(lease.token).includes("CANARY"),false);assert.equal(owner.endpoint,undefined);
});
test("two completed unretired leases prevent a third native body read",async()=>{
 const{owner}=setup(),a=owner.begin(request(),current),b=owner.begin(request(JSON.stringify(packet(3))),current);
 await Promise.all([a.observation,b.observation]);const third=request();assert.deepEqual(owner.begin(third,current),held);assert.equal(third.bodyUsed,false);
 owner.retire(a.token);const c=owner.begin(third,current);assert.equal((await c.observation).kind,"prepared");owner.retire(b.token);owner.retire(c.token);
});
test("per-lease abort cannot borrow another body's physical retirement",async()=>{
 const{owner}=setup(),ac=new AbortController(),bc=new AbortController(),a=pending(ac.signal),b=pending(bc.signal),la=owner.begin(a.req,current),lb=owner.begin(b.req,current);
 ac.abort();bc.abort();assert.deepEqual(await la.observation,held);assert.deepEqual(await lb.observation,held);
 assert.equal(owner.inspection().physicalReads,2);assert.deepEqual(owner.retire(la.token),held);
 a.cancel.resolve();await flush();assert.equal(owner.retire(la.token).kind,"physically_retired_invented_body");
 assert.deepEqual(owner.retire(lb.token),held);assert.equal(owner.inspection().physicalReads,1);b.cancel.resolve();await flush();owner.retire(lb.token);
});
test("real two-second observer timeout owns pending native cancellation",async()=>{
 const{owner}=setup(),body=pending(),start=performance.now(),lease=owner.begin(body.req,current);
 assert.deepEqual(await lease.observation,held);assert.ok(performance.now()-start>=1900);assert.equal(body.cancels,1);
 assert.deepEqual(owner.retire(lease.token),held);assert.equal(owner.inspection().ownedLeases,1);
 body.cancel.resolve();await flush();assert.equal(owner.retire(lease.token).kind,"physically_retired_invented_body");
});
test("manual fixture cancellation loses factory context while preserving pending physical ownership",async()=>{
 const{owner}=setup(),a=pending(),la=owner.begin(a.req,current),b=owner.begin(request(),current);owner.cancel(la.token);
 assert.deepEqual(await la.observation,held);assert.deepEqual(await b.observation,held);owner.retire(b.token);
 assert.deepEqual(owner.retire(la.token),held);a.cancel.resolve();await flush();assert.equal(owner.retire(la.token).contextKnown,false);
 const next=request();assert.deepEqual(owner.begin(next,current),held);assert.equal(next.bodyUsed,false);
});
test("forged, cross-owner and proxy leases cannot cancel or retire native work",async()=>{
 const{owner}=setup(),other=setup().owner,a=pending(),lease=owner.begin(a.req,current);
 for(const fake of [{},new Proxy(lease.token,{}),null,()=>0]){assert.deepEqual(owner.cancel(fake),held);assert.deepEqual(owner.retire(fake),held);}
 assert.deepEqual(other.cancel(lease.token),held);assert.equal(a.cancels,0);owner.cancel(lease.token);await lease.observation;a.cancel.resolve();await flush();owner.retire(lease.token);
});
test("global context loss retires observers but never pending physical reads",async()=>{
 const{owner}=setup(),a=pending(),lease=owner.begin(a.req,current);owner.loseContext();assert.deepEqual(await lease.observation,held);
 const next=request();assert.deepEqual(owner.begin(next,current),held);assert.equal(next.bodyUsed,false);assert.deepEqual(owner.retire(lease.token),held);
 a.cancel.resolve();await flush();assert.equal(owner.retire(lease.token).contextKnown,false);assert.equal(owner.inspection().held,true);
});
test("current projection reentry cannot retire the active own lease or bypass two owners",async()=>{
 const{owner}=setup();let lease,second;lease=owner.begin(request(),()=>{assert.deepEqual(owner.retire(lease.token),held);second=owner.begin(request(JSON.stringify(packet(4))),current);const third=request();assert.deepEqual(owner.begin(third,current),held);assert.equal(third.bodyUsed,false);return current();});
 assert.equal((await lease.observation).kind,"prepared");assert.equal((await second.observation).kind,"prepared");owner.retire(lease.token);owner.retire(second.token);
});
for(const body of ["{}",JSON.stringify(packet())+"\n",JSON.stringify({...packet(),email:"invented@example.org"}),"x".repeat(16385)])
 test("invalid canonical body stays held and physically retires without write authority "+body.length,async()=>{const{owner}=setup(),lease=owner.begin(request(body),current);assert.deepEqual(await lease.observation,held);await flush();assert.deepEqual(owner.retire(lease.token),{kind:"physically_retired_invented_body",preparation:"held",contextKnown:true});});
test("original UTC body identity expiry holds and permanently loses owner context",async()=>{
 const{owner,clock}=setup(),lease=owner.begin(request(),()=>{clock.advanceForTrial({utcAtMs:NOW+limits.payloadLifetimeMs});return current();});
 assert.deepEqual(await lease.observation,held);await flush();assert.equal(owner.retire(lease.token).contextKnown,false);const next=request();assert.deepEqual(owner.begin(next,current),held);assert.equal(next.bodyUsed,false);
});
test("cleanup failure cannot leave another body owner apparently known",async()=>{
 const{owner}=setup(),req=request();req.signal.removeEventListener=()=>{throw Error("INVENTED_PRIVATE_CANARY");};const lease=owner.begin(req,current);
 assert.deepEqual(await lease.observation,held);await flush();assert.equal(owner.inspection().held,true);assert.equal(owner.retire(lease.token).contextKnown,false);
});
test("owned clock invalidation after issue prevents later body dispatch",()=>{
 const{owner,clock}=setup();clock.loseContextForTrial();const req=request();assert.deepEqual(owner.begin(req,current),held);assert.equal(req.bodyUsed,false);assert.equal(owner.inspection().ownedLeases,0);
});
test("clock loss after prepared EOF cannot expose a stale known retirement",async()=>{
 const{owner,clock}=setup(),lease=owner.begin(request(),current);assert.equal((await lease.observation).kind,"prepared");clock.loseContextForTrial();
 assert.equal(owner.retire(lease.token).contextKnown,false);assert.equal(owner.inspection().held,true);
});
test("UTC original lease expiry after prepared EOF cannot expose known retirement",async()=>{
 const{owner,clock}=setup(),lease=owner.begin(request(),current);assert.equal((await lease.observation).kind,"prepared");clock.advanceForTrial({utcAtMs:NOW+limits.payloadLifetimeMs});
 assert.equal(owner.retire(lease.token).contextKnown,false);assert.equal(owner.inspection().held,true);
});
test("late native cancel rejection holds new body before retiring the old lease",async()=>{
 const{owner}=setup();let rejectCancel;const ac=new AbortController();const body=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){return new Promise((_,reject)=>{rejectCancel=reject;});}});
 const lease=owner.begin(request(body,ac.signal),current);ac.abort();assert.deepEqual(await lease.observation,held);assert.deepEqual(owner.retire(lease.token),held);
 rejectCancel(Error("INVENTED_PRIVATE_CANARY"));await flush();await flush();const next=request();assert.deepEqual(owner.begin(next,current),held);assert.equal(next.bodyUsed,false);assert.equal(owner.inspection().held,true);assert.equal(owner.retire(lease.token).contextKnown,false);
});
test("unretired original UTC expiry holds next body even before explicit retirement",async()=>{
 const{owner,clock}=setup(),lease=owner.begin(request(),current);await lease.observation;clock.advanceForTrial({utcAtMs:NOW+limits.payloadLifetimeMs});const next=request();assert.deepEqual(owner.begin(next,current),held);assert.equal(next.bodyUsed,false);assert.equal(owner.retire(lease.token).contextKnown,false);
});
for(const kind of ["virtual","native"])
 test("pre-cleanup signal deadline holds while keeping ordinary reader context known "+kind,async()=>{
 const{owner,clock}=setup(),req=request();const original=Object.getOwnPropertyDescriptor(AbortSignal.prototype,"aborted").get;
 let reads=0;Object.defineProperty(req.signal,"aborted",{get(){reads++;if(reads===2){/* setup accesses only; the EOF projection arms the final access below */}return Reflect.apply(original,this,[]);},configurable:true});
 let armed=false;const lease=owner.begin(req,()=>{armed=true;let calls=0;Object.defineProperty(req.signal,"aborted",{get(){calls++;if(calls===2){if(kind==="virtual")clock.advanceForTrial({observationDeltaMs:2100});else{const until=performance.now()+2050;while(performance.now()<until){}}}return Reflect.apply(original,this,[]);},configurable:true});return current();});
 assert.deepEqual(await lease.observation,held);assert.equal(armed,true);assert.equal(owner.retire(lease.token).contextKnown,true);
});
for(const kind of ["virtual","native"])
 test("post-cleanup final native signal cannot expose overdue prepared output "+kind,async()=>{
 const{owner,clock}=setup(),req=request();let calls=0,triggered=false;
 Object.defineProperty(req.signal,"aborted",{get(){if(req.bodyUsed&&owner.inspection().physicalReads===0){calls++;if(calls===2){triggered=true;if(kind==="virtual")clock.advanceForTrial({observationDeltaMs:2100});else{const until=performance.now()+2050;while(performance.now()<until){}}}}return false;}});
 const lease=owner.begin(req,current);assert.deepEqual(await lease.observation,held);assert.equal(triggered,true);assert.equal(owner.retire(lease.token).contextKnown,false);
});
