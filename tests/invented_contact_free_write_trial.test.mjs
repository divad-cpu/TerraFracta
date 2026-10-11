import assert from "node:assert/strict";
import test from "node:test";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
import { deriveCorrectionTarget } from "../src/correction-target.ts";
import { createInventedContactFreeWriteTrial as create } from "../src/invented-contact-free-write-trial.ts";
import { contactFreeCorrectionPolicy as limits } from "../src/contact-free-correction-policy.ts";
import { createInventedContactFreeClock } from "../src/invented-contact-free-clock.ts";
const id=n=>`c8700000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const NOW=Date.parse("2026-10-08T10:00:00Z"),held={kind:"held"};
const current=()=>({kind:"issue",issue:{...connectedInput().issue,publicationId:id(1)}});
const packet=(n=4)=>({schemaVersion:1,requestId:id(n),draft:{target:deriveCorrectionTarget(current()).target,
 fields:{kind:"missing_context",details:"Invented private CANARY: blåbær 日本語",sourceUrl:"https://example.org/invented"}}});
const request=(value=packet(),signal)=>new Request("https://example.org/invented-write",{method:"POST",headers:{"content-type":"application/json"},
 body:typeof value==="string"?value:JSON.stringify(value),signal});
const keys=time=>{const epoch=Math.floor(time/limits.addressWindowMs);return{currentKey:id(5000000+epoch),previousKey:id(5000000+epoch-1),epoch};};
const fresh=()=>({kind:"fresh_invented_trial",openReports:0,acceptedAtMs:[]});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function confirmed(input,time=NOW,options={}){
 const target=input.request?.draft.target??input.target,requestId=input.request?.requestId??input.requestId;
 return{executionId:id(2),operationId:input.operationId,outcome:"confirmed",result:{schemaVersion:1,status:"recorded_private",requestId,reportId:id(5),
 publicationId:target.publicationId,revision:target.revision,replayed:false,operationId:input.operationId,target,
 lifecycle:{schemaVersion:1,reportId:id(5),receivedAtMs:time,closedAtMs:null,erasedAtMs:null,eraseReason:null},version:1,observedAtMs:time,payloadAvailable:true,...options}};
}
const outcome=(input,kind)=>({executionId:id(2),operationId:input.operationId,outcome:kind,result:null});
function setup(overrides={},fixture=fresh()){
 const env={inputs:[],recoveries:[],identityCalls:0};
 const clock=createInventedContactFreeClock({kind:"fresh_invented_clock",utcAtMs:NOW});assert.equal(clock.kind,"ready");
 let utc=NOW,mono=0;
 Object.defineProperties(env,{utc:{get:()=>utc,set:value=>{clock.advanceForTrial({utcAtMs:value});utc=value;}},
 mono:{get:()=>mono,set:value=>{clock.advanceForTrial({observationDeltaMs:value-mono});mono=value;}}});
 const ports={executionId:id(2),nextOperationId:()=>id(100+env.identityCalls++),
 write:async(input,signal)=>{env.inputs.push(input);return overrides.write?overrides.write(input,signal,env):confirmed(input,env.utc);},
 recover:async(input,signal)=>{env.recoveries.push(input);return overrides.recover?overrides.recover(input,signal,env):confirmed(input,env.utc);}};
 const trial=create(fixture,ports,clock.token);assert.equal(trial.kind,"ready");return{env,trial,ports,clock};
}

test("native body, operation receipt and reservation settle one actual new effect",async()=>{
 const{trial,env}=setup();const value=await trial.submit(request(),keys(NOW),current);
 assert.equal(value.kind,"recorded_invented");assert.equal(env.inputs.length,1);assert.equal(value.receipt.requestId,id(4));
 assert.equal(JSON.stringify(value).includes("CANARY"),false);assert.deepEqual(trial.inspection.budget(),{kind:"counts",acceptedInHour:1,openReports:1,reserved:0,unknown:0,addressBuckets:1});
 assert.deepEqual(trial.inspection.operations(),{held:false,pending:0,physical:0,retainedOperationIds:1});
 assert.equal(Object.isFrozen(env.inputs[0].request.draft.fields),true);assert.equal(trial.endpoint,undefined);
});

test("known nonwrite and confirmed repeat release without incrementing accepted/open",async()=>{
 for(const mode of ["known_nonwrite","repeat"]){const{trial}=setup({write:input=>mode==="repeat"?confirmed(input,NOW,{replayed:true}):outcome(input,mode)});
 const result=await trial.submit(request(),keys(NOW),current);assert.equal(result.kind,mode==="repeat"?"recorded_invented":"held");
 const counts=trial.inspection.budget();assert.equal(counts.acceptedInHour,0);assert.equal(counts.openReports,0);assert.equal(counts.reserved,0);}
});

test("invalid body and changed EOF target never dispatch or allocate operation identity",async()=>{
 for(const body of ["{}",JSON.stringify(packet())+"\n",JSON.stringify({...packet(),email:"invented@example.org"}),"x".repeat(16385)]){
 const{trial,env}=setup();assert.deepEqual(await trial.submit(request(body),keys(NOW),current),held);assert.equal(env.inputs.length,0);assert.equal(env.identityCalls,0);assert.equal(trial.inspection.budget().reserved,0);}
 const{trial,env}=setup();assert.deepEqual(await trial.submit(request(),keys(NOW),()=>{const changed=current();changed.issue.revision++;return changed;}),held);assert.equal(env.inputs.length,0);
});

test("address attempt and full budgets hold before native body access",async()=>{
 for(const fixture of [{...fresh(),openReports:200},{...fresh(),acceptedAtMs:Array(60).fill(NOW)}]){
 const{trial,env}=setup({},fixture),req=request();assert.deepEqual(await trial.submit(req,keys(NOW),current),held);assert.equal(req.bodyUsed,false);assert.equal(env.inputs.length,0);}
 const{trial,env}=setup({write:input=>outcome(input,"known_nonwrite")});for(let n=0;n<5;n++)await trial.submit(request(packet(20+n)),keys(NOW),current);
 const sixth=request();assert.deepEqual(await trial.submit(sixth,keys(NOW),current),held);assert.equal(sixth.bodyUsed,false);assert.equal(env.inputs.length,5);
});

test("two physically pending writes retain reservations and a third never reads",async()=>{
 const wait=deferred(),{trial,env}=setup({write:()=>wait.promise});const first=trial.submit(request(packet(30)),keys(NOW),current),second=trial.submit(request(packet(31)),keys(NOW),current);
 await flush();assert.equal(env.inputs.length,2);assert.equal(trial.inspection.budget().reserved,2);assert.equal(trial.inspection.operations().physical,2);
 const third=request(packet(32));assert.deepEqual(await trial.submit(third,keys(NOW),current),held);assert.equal(third.bodyUsed,false);
 trial.loseContext();assert.deepEqual(await first,held);assert.deepEqual(await second,held);wait.resolve(null);await flush();assert.equal(trial.inspection.operations().physical,0);
});

test("parent cancellation owns unknown quota through late physical success then explicit recovery",async()=>{
 const wait=deferred(),controller=new AbortController(),{trial,env}=setup({write:()=>wait.promise});
 const pending=trial.submit(request(packet(),controller.signal),keys(NOW),current);await flush();controller.abort();assert.deepEqual(await pending,held);
 assert.equal(trial.inspection.budget().unknown,1);assert.equal(trial.inspection.operations().physical,1);assert.deepEqual(trial.recovery.pending(),[]);
 assert.deepEqual(await trial.recovery.recover({}),held);assert.equal(env.recoveries.length,0);
 const next=request(packet(6));assert.deepEqual(await trial.submit(next,keys(NOW),current),held);assert.equal(next.bodyUsed,false);
 wait.resolve(confirmed(env.inputs[0]));await flush();assert.equal(trial.inspection.budget().unknown,1);assert.equal(trial.inspection.operations().physical,0);
 const[ticket]=trial.recovery.pending();assert.ok(ticket);assert.equal((await trial.recovery.recover(ticket)).kind,"resolved_invented");
 assert.equal(env.inputs.length,1);assert.equal(env.recoveries.length,1);assert.equal(JSON.stringify(env.recoveries[0]).includes("CANARY"),false);assert.equal(JSON.stringify(env.recoveries[0]).includes("sourceUrl"),false);
 assert.equal(trial.inspection.budget().acceptedInHour,1);assert.equal(trial.inspection.budget().unknown,0);assert.deepEqual(await trial.recovery.recover(ticket),held);
});

test("real two-second write observation does not release unsettled physical work",async()=>{
 const wait=deferred(),{trial,env}=setup({write:()=>wait.promise}),started=performance.now();
 assert.deepEqual(await trial.submit(request(),keys(NOW),current),held);assert.ok(performance.now()-started>=1900);
 assert.equal(trial.inspection.budget().unknown,1);assert.equal(trial.inspection.operations().physical,1);assert.deepEqual(trial.recovery.pending(),[]);
 wait.reject(Error("INVENTED_PRIVATE_CANARY"));await flush();assert.equal(trial.inspection.operations().physical,0);assert.equal(env.inputs.length,1);assert.equal(trial.recovery.pending().length,1);
});

test("elapsed observation refuses a timely-promise late-clock confirmation",async()=>{
 const{trial,env}=setup({write:(input,signal,env)=>{env.mono=2000;return confirmed(input);}});
 assert.deepEqual(await trial.submit(request(),keys(NOW),current),held);assert.equal(env.inputs.length,1);assert.equal(trial.inspection.budget().unknown,1);
 const[ticket]=trial.recovery.pending();assert.equal((await trial.recovery.recover(ticket)).kind,"resolved_invented");assert.equal(env.inputs.length,1);
});

for(const mode of ["throw","malformed","wrong_execution","wrong_operation","unknown"])
 test(`dispatched ${mode} remains unknown until separate operation observation`,async()=>{
 const{trial,env}=setup({write:input=>{if(mode==="throw")throw Error("INVENTED_PRIVATE_CANARY");if(mode==="malformed")return{private:"INVENTED_PRIVATE_CANARY"};
 const value=mode==="unknown"?outcome(input,"unknown"):confirmed(input);if(mode==="wrong_execution")value.executionId=id(9);if(mode==="wrong_operation")value.operationId=id(9);return value;}});
 assert.deepEqual(await trial.submit(request(),keys(NOW),current),held);assert.equal(trial.inspection.budget().unknown,1);const[ticket]=trial.recovery.pending();
 assert.equal((await trial.recovery.recover(ticket)).kind,"resolved_invented");assert.equal(env.inputs.length,1);assert.equal(env.recoveries.length,1);
});

test("recovery nonwrite and repeat resolve without falsely counting a new effect",async()=>{
 for(const mode of ["known_nonwrite","repeat"]){const{trial}=setup({write:input=>outcome(input,"unknown"),recover:input=>mode==="repeat"?confirmed(input,NOW,{replayed:true}):outcome(input,mode)});
 assert.deepEqual(await trial.submit(request(),keys(NOW),current),held);const[ticket]=trial.recovery.pending();assert.equal((await trial.recovery.recover(ticket)).kind,"resolved_invented");
 assert.equal(trial.inspection.budget().reserved,0);assert.equal(trial.inspection.budget().acceptedInHour,0);assert.equal(trial.inspection.budget().openReports,0);}
});

test("malformed or mismatched recovery never resolves and duplicate pending recovery does not dispatch",async()=>{
 const wait=deferred(),{trial,env}=setup({write:input=>outcome(input,"unknown"),recover:()=>wait.promise});
 await trial.submit(request(),keys(NOW),current);const[ticket]=trial.recovery.pending();const pending=trial.recovery.recover(ticket);await flush();
 assert.deepEqual(await trial.recovery.recover(ticket),held);assert.equal(env.recoveries.length,1);const value=confirmed(env.recoveries[0]);value.operationId=id(9);wait.resolve(value);
 assert.deepEqual(await pending,held);assert.equal(trial.inspection.budget().unknown,1);assert.equal(trial.recovery.pending().length,1);assert.equal(env.inputs.length,1);
});

test("context loss permanently prevents recovery and late physical values cannot renew it",async()=>{
 const wait=deferred(),{trial,env}=setup({write:()=>wait.promise});const pending=trial.submit(request(),keys(NOW),current);await flush();trial.loseContext();assert.deepEqual(await pending,held);
 wait.resolve(confirmed(env.inputs[0]));await flush();assert.deepEqual(trial.recovery.pending(),[]);const next=request(packet(6));assert.deepEqual(await trial.submit(next,keys(NOW),current),held);assert.equal(next.bodyUsed,false);
 assert.equal(trial.inspection.operations().held,true);assert.equal(env.inputs.length,1);
});

test("clock reversal after physical dispatch leaves held continuity without private output",async()=>{
 const{trial}=setup({write:(input,signal,env)=>{env.utc--;return confirmed(input);}});
 assert.deepEqual(await trial.submit(request(),keys(NOW),current),held);assert.equal(trial.inspection.operations().held,true);assert.deepEqual(trial.recovery.pending(),[]);
});

test("result getter context invalidation cannot expose confirmation or clear unknown quota",async()=>{
 let trial;const fixture=setup({write:input=>{const value=confirmed(input);Object.defineProperty(value.result,"lifecycle",{get(){trial.loseContext();return confirmed(input).result.lifecycle;}});return value;}});trial=fixture.trial;
 assert.deepEqual(await trial.submit(request(),keys(NOW),current),held);assert.equal(trial.inspection.operations().held,true);assert.equal(fixture.env.inputs.length,1);
});

test("same in-flight request never dispatches twice even with separate body reservations",async()=>{
 const wait=deferred(),{trial,env}=setup({write:()=>wait.promise});const first=trial.submit(request(),keys(NOW),current);await flush();
 assert.deepEqual(await trial.submit(request(),keys(NOW),current),held);assert.equal(env.inputs.length,1);assert.equal(trial.inspection.budget().reserved,1);
 wait.resolve(confirmed(env.inputs[0]));assert.equal((await first).kind,"recorded_invented");
});

test("operation identity collision holds before port dispatch and retains original binding",async()=>{
 const{trial,env,ports}=setup({write:input=>outcome(input,"known_nonwrite")});ports.nextOperationId=()=>id(100); // Captured original function, not mutable provider state.
 await trial.submit(request(),keys(NOW),current);assert.equal(env.inputs[0].operationId,id(100));
 env.identityCalls=0;assert.deepEqual(await trial.submit(request(packet(6)),keys(NOW),current),held);assert.equal(env.inputs.length,1);assert.equal(trial.inspection.budget().reserved,0);
});

test("operation-reference capacity holds without eviction and expires from original admission",async()=>{
 const{trial,env}=setup({write:input=>outcome(input,"known_nonwrite")});
 for(let n=0;n<400;n++){env.utc=NOW+n*limits.addressWindowMs;await trial.submit(request(packet(1000+n)),keys(env.utc),current);}
 assert.equal(env.inputs.length,400);assert.equal(trial.inspection.operations().retainedOperationIds,400);
 env.utc+=limits.addressWindowMs;assert.deepEqual(await trial.submit(request(packet(2000)),keys(env.utc),current),held);assert.equal(env.inputs.length,400);
 env.utc=NOW+limits.recordLifetimeMs;await trial.submit(request(packet(2001)),keys(env.utc),current);assert.equal(env.inputs.length,401);assert.equal(trial.inspection.operations().retainedOperationIds,400);
});

test("invalid context or absent port cannot create an active invented writer",()=>{
 for(const fixture of [null,{kind:"restart_invented_trial",openReports:0,acceptedAtMs:[]},{...fresh(),openReports:201}])assert.deepEqual(create(fixture,{executionId:id(2),nextOperationId:()=>id(3),write:async()=>null,recover:async()=>null},createInventedContactFreeClock({kind:"fresh_invented_clock",utcAtMs:NOW}).token),held);
 assert.deepEqual(create(fresh(),undefined,()=>NOW),held);
});

test("final native signal getter context loss cannot expose a receipt after cleanup",async()=>{
 const{trial,env}=setup(),req=request();
 Object.defineProperty(req.signal,"aborted",{get(){if(env.inputs.length>0&&trial.inspection.operations().physical===0)trial.loseContext();return false;}});
 assert.deepEqual(await trial.submit(req,keys(NOW),current),held);assert.equal(trial.inspection.operations().held,true);assert.equal(env.inputs.length,1);
});

test("write listener cleanup failure holds the receipt and continuity",async()=>{
 let req;const{trial,env}=setup({write:input=>{Object.defineProperty(req.signal,"removeEventListener",{value(){throw Error("INVENTED_PRIVATE_CLEANUP");}});return confirmed(input);}});req=request();
 assert.deepEqual(await trial.submit(req,keys(NOW),current),held);assert.equal(env.inputs.length,1);assert.equal(trial.inspection.operations().held,true);
 assert.deepEqual(trial.recovery.pending(),[]);
});

test("retired write timer cannot interrupt a later owned operation",async()=>{
 const original=globalThis.setTimeout,callbacks=[];globalThis.setTimeout=fn=>{callbacks.push(fn);return 0;};
 const wait=deferred();let calls=0;const{trial,env}=setup({write:input=>++calls===1?confirmed(input):wait.promise});
 let first;try{first=await trial.submit(request(),keys(NOW),current);}finally{globalThis.setTimeout=original;}
 assert.equal(first.kind,"recorded_invented");const controller=new AbortController(),pending=trial.submit(request(packet(6),controller.signal),keys(NOW),current);await flush();
 callbacks.at(-1)();assert.equal(trial.inspection.operations().physical,1);assert.equal(trial.inspection.budget().unknown,0);
 controller.abort();assert.deepEqual(await pending,held);wait.resolve(confirmed(env.inputs[1]));await flush();assert.equal(trial.inspection.budget().unknown,1);
});

test("unknown recovery itself retains physical ownership after observer timeout",async()=>{
 const wait=deferred(),{trial,env}=setup({write:input=>outcome(input,"unknown"),recover:()=>wait.promise});
 await trial.submit(request(),keys(NOW),current);const[ticket]=trial.recovery.pending();const started=performance.now();
 assert.deepEqual(await trial.recovery.recover(ticket),held);assert.ok(performance.now()-started>=1900);assert.equal(trial.inspection.operations().physical,1);
 assert.deepEqual(await trial.recovery.recover(ticket),held);assert.equal(env.recoveries.length,1);
 wait.resolve(confirmed(env.recoveries[0]));await flush();assert.equal(trial.inspection.budget().unknown,1);assert.equal(trial.recovery.pending().length,1);assert.equal(env.inputs.length,1);
});


test("write port carries the original owned admission instant without renewing at dispatch",async()=>{
 const {trial,env}=setup();
 const result=await trial.submit(request(),keys(NOW),()=>{env.utc=NOW+100;return current();});
 assert.equal(result.kind,"recorded_invented");assert.equal(env.inputs[0].admittedAtMs,NOW);
 assert.equal(Object.isFrozen(env.inputs[0]),true);
});

test("expired unknown operation loses its owned metadata and retains opaque uncertain quota",async()=>{
 const {trial,env}=setup({write:input=>outcome(input,"unknown")});await trial.submit(request(),keys(NOW),current);
 const[ticket]=trial.recovery.pending();env.utc=NOW+limits.recordLifetimeMs;
 assert.deepEqual(await trial.recovery.recover(ticket),held);assert.equal(env.recoveries.length,0);
 assert.deepEqual(trial.recovery.pending(),[]);assert.equal(trial.inspection.operations().retainedOperationIds,0);
 assert.equal(trial.inspection.budget().unknown,1);assert.equal(trial.inspection.budget().reserved,1);
 const req=request(packet(6));assert.deepEqual(await trial.submit(req,keys(env.utc),current),held);assert.equal(req.bodyUsed,false);
});


test("final foreign signal access advances the owned observer beyond its deadline",async()=>{
 const {trial,env,clock}=setup(),req=request();
 Object.defineProperty(req.signal,"aborted",{get(){if(env.inputs.length>0&&trial.inspection.operations().physical===0)clock.advanceForTrial({observationDeltaMs:2100});return false;}});
 assert.deepEqual(await trial.submit(req,keys(NOW),current),held);assert.equal(trial.inspection.budget().unknown,1);
});

test("blocking final foreign signal access cannot suppress the captured native deadline",async()=>{
 const {trial,env}=setup(),req=request();let waited=false;
 Object.defineProperty(req.signal,"aborted",{get(){if(!waited&&env.inputs.length>0&&trial.inspection.operations().physical===0){waited=true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2100);}return false;}});
 assert.deepEqual(await trial.submit(req,keys(NOW),current),held);assert.equal(waited,true);assert.equal(trial.inspection.budget().unknown,1);
});
