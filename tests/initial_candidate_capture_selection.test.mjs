import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createSelectedInitialCandidateCaptureReader as create, readSelectedInitialCandidateCapture} from "../src/server/initial-candidate-capture-selection.ts";
import {prepareInitialCandidateLookup} from "../src/server/initial-candidate-lookup.ts";
import {INITIAL_CANDIDATE_CAPTURE_READ_SQL} from "../src/server/initial-candidate-capture.ts";
import {canonicalProposalJson as canonical} from "../src/operator-proposal-capture.ts";
const LOOKUP="2026-10-16T11:16:21.000000Z",CAPTURE="2026-10-16T11:16:21.000001Z",sha=s=>createHash("sha256").update(s).digest("hex");
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const f=JSON.parse(readFileSync(new URL("../fixtures/fictional-initial-candidate-capture.json",import.meta.url),"utf8")),native=JSON.parse(f.rawReceiptJson),raw=Buffer.from(native.report_base64,"base64").toString("utf8"),expected={...f.preparationExpected},command=prepareInitialCandidateLookup(raw,expected,LOOKUP);
 const metadata={schema_version:1,kind:"invented_initial_candidate_lookup",scope:{...command.scope},principal:"postgres",session_principal:"postgres",transaction_isolation:"repeatable read",transaction_read_only:true,preparation_matched:true,observed_at:LOOKUP,matches:[{capture_id:f.id,preparation_operation_id:native.preparation_operation_id,stored_at:native.stored_at,intent_sha256:sha(f.retainedIntentJson)}]};
 const input={preparationReportJson:raw,preparationExpected:expected,lookupRaw:Buffer.from(JSON.stringify(metadata)),lookupObservedAt:LOOKUP,captureId:f.id,captureIntentJson:f.retainedIntentJson,captureObservedAt:CAPTURE};
 return {f,native,raw,expected,metadata,input,wire:()=>Buffer.from(f.rawReceiptJson),refresh(){input.lookupRaw=Buffer.from(JSON.stringify(metadata));}};
}
function harness(f=fixture(),provider){let calls=0,ticks=0,child,command;const codes=[];const read=create(async(c,s)=>{calls++;child=s;command=c;return provider?provider(c,s):f.wire();},()=>{ticks++;return 0;},async code=>{codes.push(code);return "saved";});return {f,codes,read,calls:()=>calls,ticks:()=>ticks,child:()=>child,command:()=>command};}
const withheld=(r,kind)=>assert.deepEqual(r,{kind});
test("explicit initial selection binds fixed getter and complete independently expected original report through retirement",async()=>{
 const h=harness(),r=await h.read(h.f.input);assert.equal(r.kind,"ok");assert.equal(r.selected.captureId,h.f.f.id);assert.equal(r.stored.reportJson,h.f.raw);assert.equal(r.stored.intentJson,h.f.f.retainedIntentJson);assert.equal(r.stored.observedAt,CAPTURE);assert.equal(h.command().sql,INITIAL_CANDIDATE_CAPTURE_READ_SQL);assert.deepEqual(h.command().values,[h.f.f.id]);assert.ok(Object.isFrozen(h.command())&&Object.isFrozen(h.command().values)&&Object.isFrozen(r)&&Object.isFrozen(r.stored.preparation));assert.equal(h.calls(),1);assert.equal(h.child().aborted,true);assert.deepEqual(h.codes,[]);assert.match(r.evidenceState,/historical_association_not_current_work_or_publication/);
});
test("default backend remains unconfigured and confirmed zero metadata never chooses an intent or invokes a provider",async()=>{
 const f=fixture();withheld(await readSelectedInitialCandidateCapture(f.input),"unconfigured");
 f.metadata.matches=[];f.refresh();const h=harness(f);withheld(await h.read(f.input),"not_found");assert.equal(h.calls(),0);assert.equal(h.ticks(),0);assert.deepEqual(h.codes,[]);
});
test("exact own seven selectors and exact own two expectations reject aliases hidden fields symbols and getter failures before dispatch",async()=>{
 const changes=[i=>({...i,foreign:"PRIVATE"}),i=>{delete i.captureId;return i;},i=>Object.create(i),i=>{Object.defineProperty(i,"captureId",{enumerable:false});return i;},i=>{Object.defineProperty(i,"lookupRaw",{get(){throw Error("PRIVATE");},enumerable:true});return i;},i=>{i[Symbol("private")]=1;return i;},i=>{i.preparationExpected={...i.preparationExpected,extra:"PRIVATE"};return i;},i=>{i.preparationExpected=Object.create(i.preparationExpected);return i;},i=>{i.preparationExpected[Symbol("private")]=1;return i;},i=>{const old=i.captureId;Object.defineProperty(i,"captureId",{enumerable:true,get(){i.foreign="PRIVATE";return old;}});return i;},i=>{const old=i.preparationReportJson;Object.defineProperty(i,"preparationReportJson",{enumerable:true,get(){delete i.captureId;return old;}});return i;}];
 for(const change of changes){const h=harness();withheld(await h.read(change(h.f.input)),"invalid_scope");assert.equal(h.calls(),0);assert.equal(h.ticks(),0);assert.deepEqual(h.codes,[]);}
});
test("retained intent must bind complete original preparation identity report bytes all four parts and explicit capture before provider",async()=>{
 const fields=["capture_id","run_id","decision_id","issue_id","preparation_operation_id","preparation_artifact_id","preparation_intent_sha256","preparation_full_receipt_sha256","report_sha256","preparation_observed_at",0,1,2,3];
 for(const key of fields){const h=harness(),i=JSON.parse(h.f.input.captureIntentJson);if(typeof key==="number")i.part_sha256[key]="0".repeat(64);else i[key]=key.endsWith("sha256")?"0".repeat(64):key.endsWith("observed_at")?"2026-10-16T11:16:00.076872Z":"00000000-0000-4000-8000-000000000997";h.f.input.captureIntentJson=canonical(i);h.f.metadata.matches[0].intent_sha256=sha(h.f.input.captureIntentJson);if(key==="capture_id"){h.f.input.captureId=i.capture_id;h.f.metadata.matches[0].capture_id=i.capture_id;}h.f.refresh();withheld(await h.read(h.f.input),"invalid_scope");assert.equal(h.calls(),0);assert.equal(h.ticks(),0);}
 for(const change of [i=>i.captureId="00000000-0000-4000-8000-000000000997",i=>i.preparationExpected.reportSha256="0".repeat(64),i=>i.preparationExpected.preparationIntentJson="{}",i=>i.preparationReportJson+=" "]){const h=harness();change(h.f.input);withheld(await h.read(h.f.input),"invalid_scope");assert.equal(h.calls(),0);}
});
test("metadata duplicate foreign denied and malformed native envelopes are withheld as a whole before provider",async()=>{
 for(const change of [m=>m.matches.push({...m.matches[0]}),m=>m.matches[0].preparation_operation_id="00000000-0000-4000-8000-000000000997",m=>m.scope.context_raw_sha256="0".repeat(64),m=>m.matches[0].intent_sha256="0".repeat(64),m=>m.preparation_matched=false,m=>m.matches[0].privateBody="PRIVATE"]){const h=harness();change(h.f.metadata);h.f.refresh();withheld(await h.read(h.f.input),"invalid_scope");assert.equal(h.calls(),0);assert.deepEqual(h.codes,[]);}
 for(const bytes of ["PRIVATE",Buffer.from([255]),Buffer.alloc(4097),Buffer.from('{}'),new Proxy(Buffer.from('{}'),{})]){const h=harness();h.f.input.lookupRaw=bytes;withheld(await h.read(h.f.input),"invalid_scope");assert.equal(h.calls(),0);}
 const h=harness();h.f.input.lookupRaw=Buffer.from(h.f.input.lookupRaw.toString().replace('"capture_id":','"capture_id":"00000000-0000-4000-8000-000000000997","capture_id":'));withheld(await h.read(h.f.input),"invalid_scope");assert.equal(h.calls(),0);
});
test("all own getters are observed once and mutable caller expectations and metadata cannot change the selected request across await",async()=>{
 const f=fixture(),counts={},expectedCounts={},values={...f.input},e={...f.expected};let release,called;const gate=new Promise(r=>release=r),started=new Promise(r=>called=r);const input={};
 for(const [key,value] of Object.entries(values))Object.defineProperty(input,key,{enumerable:true,get(){counts[key]=(counts[key]??0)+1;return value;}});
 for(const [key,value] of Object.entries(e))Object.defineProperty(f.expected,key,{configurable:true,enumerable:true,get(){expectedCounts[key]=(expectedCounts[key]??0)+1;return value;}});
 let got;const read=create(async command=>{got=command;called();await gate;return f.wire();},()=>0,async()=>"saved"),pending=read(input);await started;
 values.preparationReportJson="PRIVATE";values.captureIntentJson="PRIVATE";values.lookupRaw.fill(0);Object.defineProperty(f.expected,"reportSha256",{enumerable:true,value:"0".repeat(64)});release();const r=await pending;assert.equal(r.kind,"ok");assert.deepEqual(Object.values(counts),Array(7).fill(1));assert.deepEqual(Object.values(expectedCounts),[1,1]);assert.equal(got.values[0],f.f.id);assert.equal(r.stored.reportJson,f.raw);
});
test("native buffers are copied intrinsically and cleanup mutation cannot replace the admitted full report",async()=>{
 const f=fixture(),raw=f.wire();let child;Object.defineProperty(f.input.lookupRaw,"byteLength",{get(){throw Error("PRIVATE_LENGTH");}});Object.defineProperty(raw,"byteLength",{get(){throw Error("PRIVATE_LENGTH");}});
 const read=create(async(_command,s)=>{child=s;s.addEventListener("abort",()=>raw.fill(0),{once:true});return raw;},()=>0,async()=>"saved"),r=await read(f.input);assert.equal(r.kind,"ok");assert.equal(r.stored.reportJson,f.raw);assert.equal(child.aborted,true);assert.ok(raw.every(b=>b===0));
});
test("final metadata comparison withholds full body and selected metadata on an exact microsecond change",async()=>{
 const h=harness();h.f.metadata.matches[0].stored_at="2026-10-16T11:16:12.497655Z";h.f.refresh();withheld(await h.read(h.f.input),"changed");assert.equal(h.calls(),1);assert.deepEqual(h.codes,[]);
});
test("invalid full capture and foreign original report cannot return partial provenance or an error body",async()=>{
 const mutations=[n=>n.capture_id="00000000-0000-4000-8000-000000000997",n=>n.capture.sourceReceipts[0].contentSha256="0".repeat(64),n=>n.intent_base64=Buffer.from('{}').toString('base64'),n=>n.report_base64=Buffer.from('{}').toString('base64'),n=>n.privateBody="PRIVATE"];
 for(const mutate of mutations){const f=fixture();mutate(f.native);const h=harness(f,async()=>Buffer.from(JSON.stringify(f.native)));withheld(await h.read(f.input),"unavailable");await turn();assert.deepEqual(h.codes,["operator_audit_read"]);}
 for(const raw of [Buffer.alloc(131073),Buffer.from([255]),Buffer.from('{}'),new Proxy(Buffer.from('{}'),{})]){const h=harness(undefined,async()=>raw);withheld(await h.read(h.f.input),"unavailable");assert.equal(h.calls(),1);}
});
test("two retained UTC clocks keep exact microseconds without a new observation or implicit renewal",async()=>{
 for(const at of ["2026-10-16T11:16:20.999999Z","2026-10-16T11:16:21Z","2026-10-16T11:16:21.0000000Z","2026-10-16T13:16:21.000000+02:00"]){const h=harness();h.f.input.captureObservedAt=at;withheld(await h.read(h.f.input),"invalid_scope");assert.equal(h.calls(),0);assert.equal(h.ticks(),0);}
 const h=harness();h.f.input.captureObservedAt=LOOKUP;const r=await h.read(h.f.input);assert.equal(r.kind,"ok");assert.equal(r.stored.observedAt,LOOKUP);
 const g=harness();g.f.metadata.observed_at="2026-10-16T11:16:21.000001Z";g.f.refresh();withheld(await g.read(g.f.input),"invalid_scope");assert.equal(g.calls(),0);
});
test("preaborted and subsequently aborted readers stay quiet and consume a late provider rejection",async()=>{
 const parent=new AbortController();parent.abort();const h=harness();withheld(await h.read(h.f.input,parent.signal),"unavailable");assert.equal(h.calls(),0);assert.equal(h.ticks(),0);assert.deepEqual(h.codes,[]);
 let reject,started;const ready=new Promise(r=>started=r),f=fixture(),codes=[],later=new Promise((_r,j)=>reject=j),active=new AbortController();const read=create(async()=>{started();return later;},()=>0,async code=>{codes.push(code);return "saved";}),pending=read(f.input,active.signal);await ready;active.abort();withheld(await pending,"unavailable");reject(Error("PRIVATE_LATE_REJECTION"));await turn();assert.deepEqual(codes,[]);
});
test("one nonrenewing elapsed clock refuses backward invalid thrown and deadline observations before dispatch or final matching",async()=>{
 for(const ticks of [[10,9],[0,NaN],[0,3000],[0,0,3000],[0,0,1,3000],[0,0,1,2,3000],[0,0,1,2,3,3000],[0,0,1,2,3,2]]){let n=0,calls=0;const f=fixture(),read=create(async()=>{calls++;return f.wire();},()=>ticks[Math.min(n++,ticks.length-1)],async()=>"saved");withheld(await read(f.input),"unavailable");if(ticks.length===2)assert.equal(calls,0);}
 for(const phase of [0,1,2,3,4,5]){let n=0;const f=fixture(),read=create(async()=>f.wire(),()=>{if(n++===phase)throw Error("PRIVATE_CLOCK");return 0;},async()=>"saved");withheld(await read(f.input),"unavailable");}
});
test("cleanup remains part of the original interval and parent cancellation suppresses an otherwise complete result",async()=>{
 for(const effect of ["abort","deadline","regression","invalid"]){const f=fixture(),parent=new AbortController();let tick=10;const codes=[];const read=create(async(_c,s)=>{s.addEventListener("abort",()=>{if(effect==="abort")parent.abort();else tick=effect==="deadline"?3010:effect==="regression"?9:NaN;},{once:true});return f.wire();},()=>tick,async code=>{codes.push(code);return "saved";});withheld(await read(f.input,parent.signal),"unavailable");await turn();assert.deepEqual(codes,effect==="abort"?[]:["operator_audit_read"]);}
});
test("fixed cancellation timer retires pending provider and consumes late rejection without leaking private error data",async t=>{
 let fire,reject,started,delay,child;const ready=new Promise(r=>started=r),f=fixture(),codes=[];t.mock.method(globalThis,"setTimeout",(callback,ms)=>{fire=callback;delay=ms;return 123;});t.mock.method(globalThis,"clearTimeout",()=>{});const read=create(async(_c,s)=>{child=s;started();return new Promise((_r,j)=>reject=j);},()=>0,async code=>{codes.push(code);return "saved";}),pending=read(f.input);await ready;assert.equal(delay,3000);fire();withheld(await pending,"unavailable");assert.equal(child.aborted,true);reject(Error("PRIVATE_PROVIDER_BODY"));await turn();assert.deepEqual(codes,["operator_audit_read"]);
});
test("curated diagnostic is once-only and recorder failure never replaces the closed unavailable outcome",async()=>{
 const f=fixture(),codes=[],read=create(async()=>{throw Error("PRIVATE_SOURCE_CREDENTIAL_BODY");},()=>0,async(...args)=>{codes.push(args);throw Error("PRIVATE_LOGGER");});withheld(await read(f.input),"unavailable");await turn();assert.deepEqual(codes,[["operator_audit_read"]]);
});
test("cleanup failure still attempts signal retirement and withholds the otherwise complete body",async t=>{
 const clear=globalThis.clearTimeout;let child;const f=fixture(),codes=[];t.mock.method(globalThis,"clearTimeout",timer=>{clear(timer);throw Error("PRIVATE_CLEANUP");});const read=create(async(_c,s)=>{child=s;return f.wire();},()=>0,async code=>{codes.push(code);return "saved";});withheld(await read(f.input),"unavailable");assert.equal(child.aborted,true);await turn();assert.deepEqual(codes,["operator_audit_read"]);
});
