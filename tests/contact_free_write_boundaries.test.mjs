import assert from 'node:assert/strict';
import test from 'node:test';
import { connectedInput } from './helpers/connected_reader_fixture.mjs';
import { deriveCorrectionTarget } from '../src/correction-target.ts';
import { createInventedContactFreeWriteTrial as create } from '../src/invented-contact-free-write-trial.ts';
import { checkInventedContactFreeWriteObservation as check } from '../src/contact-free-write-observation.ts';
import { createInventedContactFreeClock } from '../src/invented-contact-free-clock.ts';
import { contactFreeCorrectionPolicy as limits } from '../src/contact-free-correction-policy.ts';

const id=n=>`c6800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NOW=Date.parse('2026-10-08T10:00:00Z'), held={kind:'held'};
const current=()=>({kind:'issue',issue:{...connectedInput().issue,publicationId:id(1)}});
const target=()=>deriveCorrectionTarget(current()).target;
const packet=(n=4)=>({schemaVersion:1,requestId:id(n),draft:{target:target(),fields:{kind:'missing_context',details:'Independent invented CANARY 日本語 context.',sourceUrl:'https://example.org/invented'}}});
const request=(n=4,signal)=>new Request('https://example.org/invented',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(packet(n)),signal});
const keys=now=>{const epoch=Math.floor(now/limits.addressWindowMs);return {currentKey:id(5000000+epoch),previousKey:id(5000000+epoch-1),epoch};};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const flush=()=>new Promise(r=>setImmediate(r));
function envelope(input,kind='confirmed',options={}) {
  if(kind!=='confirmed')return {executionId:id(2),operationId:input.operationId,outcome:kind,result:null};
  const t=input.request?.draft.target??input.target;
  return {executionId:id(2),operationId:input.operationId,outcome:'confirmed',result:{schemaVersion:1,status:'recorded_private',requestId:input.request?.requestId??input.requestId,reportId:id(5),publicationId:t.publicationId,revision:t.revision,replayed:false,operationId:input.operationId,target:t,lifecycle:{schemaVersion:1,reportId:id(5),receivedAtMs:NOW,closedAtMs:null,erasedAtMs:null,eraseReason:null},version:1,observedAtMs:NOW,payloadAvailable:true,...options}};
}
function setup(handlers={}) {
 const clock=createInventedContactFreeClock({kind:'fresh_invented_clock',utcAtMs:NOW});assert.equal(clock.kind,'ready');
 const e={inputs:[],recoveries:[],op:0,trial:null,clock};
 const ports={executionId:id(2),nextOperationId:()=>{handlers.next?.(e);return id(100+e.op++);},
 write:async(input,signal)=>{e.inputs.push(input);return handlers.write?handlers.write(input,e,signal):envelope(input);},
 recover:async(input,signal)=>{e.recoveries.push(input);return handlers.recover?handlers.recover(input,e,signal):envelope(input);}};
 const trial=create({kind:'fresh_invented_trial',openReports:0,acceptedAtMs:[]},ports,clock.token);
 assert.equal(trial.kind,'ready');e.trial=trial;return{trial,e};
}

// The unsafe separate-callback API and its exact witnesses remain in versions
// and source-bound FAIL receipts. These regressions exercise the replacement.
test('owned clock loss between body EOF and write dispatch cannot write',async()=>{
 const{trial,e}=setup({next:e=>e.clock.advanceForTrial({observationDeltaMs:-1})});
 assert.deepEqual(await trial.submit(request(),keys(NOW),current),held);assert.equal(e.inputs.length,0);assert.equal(trial.inspection.operations().held,true);
});
test('final foreign signal access cannot expose an expired minimal receipt',async()=>{
 const{trial,e}=setup(),req=request();
 Object.defineProperty(req.signal,'aborted',{get(){if(e.inputs.length>0&&trial.inspection.operations().physical===0)e.clock.advanceForTrial({utcAtMs:NOW+limits.recordLifetimeMs});return false;}});
 assert.deepEqual(await trial.submit(req,keys(NOW),current),held);assert.equal(trial.inspection.budget().unknown,1);
});
test('reentrant result getter cannot dispatch another owned recovery',async()=>{
 let ticket,nested;const{trial,e}=setup({write:input=>envelope(input,'unknown'),recover:input=>{
 const result=envelope(input),lifecycle=result.result.lifecycle;
 Object.defineProperty(result.result,'lifecycle',{get(){nested=trial.recovery.recover(ticket);return lifecycle;}});return result;
 }});await trial.submit(request(),keys(NOW),current);[ticket]=trial.recovery.pending();
 assert.equal((await trial.recovery.recover(ticket)).kind,'resolved_invented');assert.deepEqual(await nested,held);assert.equal(e.recoveries.length,1);
});
test('original metadata expiry holds recovery and keeps uncertain quota',async()=>{
 const{trial,e}=setup({write:input=>envelope(input,'unknown')});await trial.submit(request(),keys(NOW),current);const[ticket]=trial.recovery.pending();
 e.clock.advanceForTrial({utcAtMs:NOW+limits.recordLifetimeMs});assert.deepEqual(await trial.recovery.recover(ticket),held);
 assert.equal(e.recoveries.length,0);assert.equal(trial.inspection.budget().unknown,1);assert.deepEqual(trial.recovery.pending(),[]);
});
test('superseded separate raw clock callbacks fail closed without being invoked',()=>{
 let clocks=0,ports=0;const supplied={get executionId(){ports++;return id(2);}};
 assert.deepEqual(create({kind:'fresh_invented_trial',openReports:0,acceptedAtMs:[]},supplied,()=>{clocks++;return NOW;},()=>{clocks++;return 100;}),held);
 assert.equal(clocks,0);assert.equal(ports,0);
});

test('original180-day identity expiry in operation-id callback never reaches writer',async()=>{
 const{trial,e}=setup({next:e=>e.clock.advanceForTrial({utcAtMs:NOW+limits.recordLifetimeMs})});
 assert.deepEqual(await trial.submit(request(),keys(NOW),current),held);assert.equal(e.inputs.length,0);assert.equal(trial.inspection.budget().reserved,0);
});
test('original180-day expiry after last pre-dispatch native signal access never reaches writer',async()=>{
 const{trial,e}=setup(),req=request();let advanced=false;
 Object.defineProperty(req.signal,'aborted',{get(){if(!advanced&&trial.inspection.operations().physical===1&&e.inputs.length===0){advanced=true;e.clock.advanceForTrial({utcAtMs:NOW+limits.recordLifetimeMs});}return false;}});
 assert.deepEqual(await trial.submit(req,keys(NOW),current),held);assert.equal(advanced,true);assert.equal(e.inputs.length,0);assert.equal(trial.inspection.budget().reserved,0);
});
