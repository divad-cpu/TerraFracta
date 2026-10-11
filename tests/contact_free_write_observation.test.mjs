import assert from "node:assert/strict";
import test from "node:test";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { checkInventedContactFreeWriteObservation as check } from "../src/contact-free-write-observation.ts";
import { contactFreeCorrectionPolicy as limits } from "../src/contact-free-correction-policy.ts";
const id=n=>`c8700000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const now=Date.parse("2026-10-08T10:00:00Z"),held={kind:"held"};
const target=()=>deriveCorrectionTarget({kind:"issue",issue:{...connectedInput().issue,publicationId:id(1)}}).target;
const identity=()=>({executionId:id(2),operationId:id(3),requestId:id(4),target:target(),admittedAtMs:now});
const receipt=()=>({schemaVersion:1,status:"recorded_private",requestId:id(4),reportId:id(5),publicationId:id(1),revision:1,replayed:false,
 operationId:id(3),target:target(),lifecycle:{schemaVersion:1,reportId:id(5),receivedAtMs:now,closedAtMs:null,erasedAtMs:null,eraseReason:null},
 version:1,observedAtMs:now,payloadAvailable:true});
const packet=()=>({executionId:id(2),operationId:id(3),outcome:"confirmed",result:receipt()});

test("closed private operation observation reuses core receipt and detaches metadata",()=>{
 const input=packet(),result=check(input,identity(),now);assert.equal(result.kind,"confirmed");
 assert.deepEqual(Object.keys(result.receipt).sort(),["schemaVersion","status","requestId","reportId","publicationId","revision","replayed"].sort());
 input.result.target.issueSlug="changed";input.result.lifecycle.receivedAtMs++;
 assert.deepEqual(result.target,target());assert.equal(result.lifecycle.receivedAtMs,now);
 assert.equal(JSON.stringify(result).includes("sourceUrl"),false);
});

for(const [name,mutate] of [
 ["execution",p=>{p.executionId=id(9);}], ["operation envelope",p=>{p.operationId=id(9);}],
 ["operation receipt",p=>{p.result.operationId=id(9);}], ["request",p=>{p.result.requestId=id(9);}],
 ["full target",p=>{p.result.target.issueSlug="changed";}], ["report lifecycle",p=>{p.result.lifecycle.reportId=id(9);}],
 ["publication",p=>{p.result.publicationId=id(9);}], ["revision",p=>{p.result.revision=2;}],
 ["future observation",p=>{p.result.observedAtMs=now+1;}], ["stale observation",p=>{p.result.observedAtMs=now-1;}],
 ["new effect with old receipt",p=>{p.result.lifecycle.receivedAtMs=now-1;}],
 ["extra private field",p=>{p.result.details="INVENTED_PRIVATE_CANARY";}],
 ["extra envelope",p=>{p.extra=true;}], ["payload contradiction",p=>{p.result.payloadAvailable=false;}],
 ["future lifecycle",p=>{p.result.lifecycle.closedAtMs=now+1;}], ["invalid version",p=>{p.result.version=0;}],
 ["invalid temporal order",p=>{p.result.lifecycle.closedAtMs=now;p.result.lifecycle.erasedAtMs=now-1;p.result.lifecycle.eraseReason="reporter_request";}]
])test(`observation holds ${name} without returning private adapter fields`,()=>{
 const value=packet();mutate(value);assert.deepEqual(check(value,identity(),now),held);
});

test("known nonwrite and unknown must be operation bound and carry no result",()=>{
 for(const outcome of ["known_nonwrite","unknown"]){const value={executionId:id(2),operationId:id(3),outcome,result:null};
 assert.deepEqual(check(value,identity(),now),{kind:outcome});value.result={private:"INVENTED_PRIVATE_CANARY"};assert.deepEqual(check(value,identity(),now),held);
 value.result=null;value.operationId=id(8);assert.deepEqual(check(value,identity(),now),held);}
});

test("repeat and erased historical receipt preserve original retention without restoring text",()=>{
 const value=packet();value.result.replayed=true;value.result.lifecycle.receivedAtMs=now-95*86400000;
 value.result.lifecycle.erasedAtMs=now;value.result.lifecycle.eraseReason="expired";value.result.payloadAvailable=false;value.result.version=2;
 const result=check(value,identity(),now);assert.equal(result.kind,"confirmed");assert.equal(result.replayed,true);
 assert.equal(result.lifecycle.receivedAtMs,now-95*86400000);assert.equal(JSON.stringify(result).includes("payload"),false);
 value.result.payloadAvailable=true;assert.deepEqual(check(value,identity(),now),held);
});

test("record-expired and invalid caller clock cannot create a renewed reference",()=>{
 const value=packet();value.result.replayed=true;value.result.lifecycle.receivedAtMs=now-limits.recordLifetimeMs;value.result.payloadAvailable=false;
 assert.deepEqual(check(value,identity(),now),held);
 for(const invalid of [now-1,NaN,Infinity,-1,"now"])assert.deepEqual(check(packet(),identity(),invalid),held);
});

test("throwing adapter getters are opaque and do not expose canary errors",()=>{
 const value=packet();Object.defineProperty(value.result,"lifecycle",{get(){throw Error("INVENTED_PRIVATE_CANARY");}});
 assert.deepEqual(check(value,identity(),now),held);
});


test("a delayed caller observation cannot reuse an earlier unexpired payload/record assessment",()=>{
 const value=packet();
 for(const elapsed of [limits.payloadLifetimeMs,limits.recordLifetimeMs])assert.deepEqual(check(value,identity(),now+elapsed),held);
});
