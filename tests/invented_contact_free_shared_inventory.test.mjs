import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkInventedContactFreeSharedInventory as check } from "../src/invented-contact-free-shared-inventory.ts";
import { contactFreeCorrectionPolicy as limits } from "../src/contact-free-correction-policy.ts";
const id=n=>`e6500000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const NOW=1791453600000,held={kind:"held"},epoch=Math.floor(NOW/limits.addressWindowMs);
const target=()=>({issueId:id(1),publicationId:id(2),revision:1,jurisdictionSlug:"fictional-country",issueSlug:"fictional-share",claimId:null});
const record=()=>({lifecycle:{schemaVersion:1,reportId:id(10),receivedAtMs:NOW,closedAtMs:null,erasedAtMs:null,eraseReason:null},requestId:id(11),target:target(),closedReason:null,reviewerId:null,version:1});
const op=()=>({operationId:id(20),executionId:id(3),requestId:id(11),target:target(),admittedAtMs:NOW,expiresAtMs:NOW+limits.recordLifetimeMs,state:"recorded",reportId:id(10),inserted:true});
const reservation=()=>({ticket:id(30),operationId:id(20),admittedAtMs:NOW,phase:"reserved",requestId:null,target:null});
const bucket=()=>({key:id(40),epoch,expiresAtMs:(epoch+2)*limits.addressWindowMs,attempts:[NOW]});
const packet=()=>({schemaVersion:1,kind:"invented_shared_recovery_inventory",writeInventory:{schemaVersion:1,kind:"invented_write_latest_inventory",executionId:id(3),known:true,complete:true,observedAtMs:NOW,records:[],operations:[]},admission:{acceptedAtMs:[],addressBuckets:[],reservations:[]}});
function ready(p=packet(),now=p.writeInventory.observedAtMs){return check(p,now);}
test("complete empty snapshot is shape only and grants no restart",()=>{const r=ready();assert.equal(r.kind,"checked_invented_shared_inventory");assert.equal(r.admissionDisposition,"snapshot_only_no_restart_authority");assert.equal(r.restart,undefined);assert.equal(r.restore,undefined);});
test("reserved physical work holds even with empty custody",()=>{const p=packet();p.admission.reservations=[reservation()];assert.equal(ready(p).admissionDisposition,"held_pending_or_unknown");});
test("dispatched effect retains the original owned operation and unknown debt",()=>{const p=packet();p.writeInventory.records=[record()];p.writeInventory.operations=[op()];p.admission.reservations=[{...reservation(),phase:"dispatched",requestId:id(11),target:target()}];const r=ready(p);assert.equal(r.admissionDisposition,"held_pending_or_unknown");assert.equal(r.openReports,1);assert.doesNotMatch(JSON.stringify(r),/details|sourceUrl|resolution|CANARY|digest|email/);});
test("expired opaque debt holds after custody and operation references disappear",()=>{const p=packet();p.admission.reservations=[{ticket:id(30),operationId:null,admittedAtMs:null,phase:"expired",requestId:null,target:null}];const r=ready(p);assert.equal(r.admissionDisposition,"held_pending_or_unknown");assert.equal(r.openReports,0);});
test("original short bucket epochs and leases survive without renewal",()=>{const p=packet();p.admission.addressBuckets=[bucket()];const r=ready(p);assert.equal(r.inventory.admission.addressBuckets[0].expiresAtMs,NOW+2*limits.addressWindowMs);});
for(const [name,change] of [
 ["renewed bucket",p=>{p.admission.addressBuckets=[bucket()];p.admission.addressBuckets[0].expiresAtMs++;}],
 ["wrong bucket epoch",p=>{p.admission.addressBuckets=[{...bucket(),epoch:epoch+1}];}],
 ["future attempt",p=>{p.admission.addressBuckets=[{...bucket(),attempts:[NOW+1]}];}],
 ["duplicate bucket",p=>p.admission.addressBuckets=[bucket(),bucket()]],
 ["six attempts",p=>p.admission.addressBuckets=[{...bucket(),attempts:Array(6).fill(NOW)}]],
 ["duplicate ticket",p=>p.admission.reservations=[reservation(),{...reservation(),operationId:id(21)}]],
 ["duplicate operation",p=>p.admission.reservations=[reservation(),{...reservation(),ticket:id(31)}]],
 ["future reservation",p=>p.admission.reservations=[{...reservation(),admittedAtMs:NOW+1}]],
 ["expired identified reservation",p=>p.admission.reservations=[{...reservation(),admittedAtMs:NOW-limits.recordLifetimeMs}]],
 ["expired debt retaining request",p=>p.admission.reservations=[{ticket:id(30),operationId:null,admittedAtMs:null,phase:"expired",requestId:id(11),target:target()}]],
 ["unarmed request",p=>p.admission.reservations=[{...reservation(),requestId:id(11),target:target()}]],
 ["armed request absent",p=>p.admission.reservations=[{...reservation(),phase:"armed"}]],
 ["private root",p=>p.details="INVENTED_PRIVATE_CANARY"],
 ["private bucket",p=>p.admission.addressBuckets=[{...bucket(),address:"INVENTED_PRIVATE_CANARY"}]],
 ["unknown write context",p=>p.writeInventory.known=false],
 ["incomplete write context",p=>p.writeInventory.complete=false],
 ["future accepted timestamp",p=>p.admission.acceptedAtMs=[NOW+1]],
 ["expired accepted timestamp",p=>p.admission.acceptedAtMs=[NOW-limits.globalWindowMs]],
 ["global pending over limit",p=>{p.admission.acceptedAtMs=Array(60).fill(NOW);p.admission.reservations=[reservation()];}],
])test(`complete inventory holds ${name}`,()=>{const p=packet();change(p);assert.deepEqual(ready(p),held);});
test("same write effect cannot acquire a different reservation request or target",()=>{for(const field of ["requestId","admittedAtMs","target","phase"]){const p=packet();p.writeInventory.records=[record()];p.writeInventory.operations=[op()];const r={...reservation(),phase:"dispatched",requestId:id(11),target:target()};if(field==="target")r.target.revision++;else r[field]=field==="phase"?"armed":field==="admittedAtMs"?NOW-1:id(12);p.admission.reservations=[r];assert.deepEqual(ready(p),held);}});
test("stale capture instant is held instead of called newest",()=>assert.deepEqual(ready(packet(),NOW+1),held));
test("later admission getter cannot mutate already detached custody metadata",()=>{const p=packet();p.writeInventory.records=[record()];const admission=p.admission;Object.defineProperty(p,"admission",{get(){p.writeInventory.records[0].target.revision++;return admission;}});const r=ready(p);assert.equal(r.inventory.writeInventory.records[0].target.revision,1);});
test("400short buckets and60timestamps remain bounded",()=>{const p=packet();p.admission.acceptedAtMs=Array(60).fill(NOW);p.admission.addressBuckets=Array.from({length:400},(_,n)=>({...bucket(),key:id(100+n)}));assert.equal(ready(p).kind,"checked_invented_shared_inventory");p.admission.addressBuckets.push({...bucket(),key:id(600)});assert.deepEqual(ready(p),held);});
const CLI=fileURLToPath(new URL("../scripts/check_contact_free_shared_inventory.mjs",import.meta.url));
function wire(input,args=[]){return spawnSync(process.execPath,["--experimental-strip-types",CLI,...args],{input,encoding:"utf8",env:{PATH:"/usr/bin:/bin"},timeout:2000});}
test("inventory CLI emits only checked counts/disposition without owned identifiers",()=>{const p=packet();p.admission.reservations=[reservation()];const r=wire(JSON.stringify({inventory:p,nowMs:NOW}));assert.equal(r.status,0);assert.deepEqual(JSON.parse(r.stdout),{kind:"checked_invented_shared_inventory",openReports:0,acceptedInHour:0,admissionDisposition:"held_pending_or_unknown"});assert.doesNotMatch(r.stdout,/e650|ticket|target|requestId/);});
for(const [name,input,args] of [["duplicate",'{"inventory":null,"inventory":null,"nowMs":0}',[]],["private extra",JSON.stringify({inventory:packet(),nowMs:NOW,details:"CANARY"}),[]],["invalid UTF8",Buffer.from([255]),[]],["oversize","x".repeat(1024*1024+1),[]],["argument","{}",["CANARY"]]])test(`inventory CLI holds ${name}`,()=>{const r=wire(input,args);assert.equal(r.status,2);assert.deepEqual(JSON.parse(r.stdout),held);assert.doesNotMatch(r.stdout+r.stderr,/CANARY/);});
