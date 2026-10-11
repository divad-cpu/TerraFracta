import assert from 'node:assert/strict';
import test from 'node:test';
import {connectedInput} from './helpers/connected_reader_fixture.mjs';
import {deriveCorrectionTarget} from '../src/correction-target.ts';
import {createInventedContactFreeClock} from '../src/invented-contact-free-clock.ts';
import {createInventedContactFreeBodyHandoff} from '../src/invented-contact-free-body-handoff.ts';
import {createInventedContactFreeWriteTrial} from '../src/invented-contact-free-write-trial.ts';
import {contactFreeCorrectionPolicy as limits} from '../src/contact-free-correction-policy.ts';

const NOW=Date.parse('2026-10-08T10:00:00Z'),DAY=86400000;
const id=n=>`fd080000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const current=()=>({kind:'issue',issue:{...connectedInput().issue,publicationId:id(1)}});
for(const outcome of ['unknown','confirmed'])test(`day-delayed original handoff ${outcome} keeps the budget at original180d`,async()=>{
  const NativeMap=globalThis.Map,reservations=[],reportReferences=[];
  globalThis.Map=new Proxy(NativeMap,{construct(target,args){const map=Reflect.construct(target,args),set=map.set;
    Object.defineProperty(map,'set',{value:function(key,value){
      if(value&&value.state==='pending'&&Object.keys(value).length===2&&'admittedAtMs'in value)reservations.push(value);
      if(value&&Object.keys(value).length===1&&'expiresAtMs'in value)reportReferences.push({key,map,value});
      return Reflect.apply(set,this,[key,value]);}});return map;}});
  let trial,owner,clock,writes=0,recovers=0;
  try {
    clock=createInventedContactFreeClock({kind:'fresh_invented_clock',utcAtMs:NOW});
    owner=createInventedContactFreeBodyHandoff(clock.token);
    trial=createInventedContactFreeWriteTrial({kind:'fresh_invented_trial',openReports:0,acceptedAtMs:[]},{
      executionId:id(2),nextOperationId:()=>{throw Error('Original operation required');},
      write:async input=>{
        writes++;assert.equal(input.admittedAtMs,NOW);
        if(outcome==='unknown')return{executionId:id(2),operationId:id(3),outcome,result:null};
        const target=input.request.draft.target;
        return{executionId:id(2),operationId:id(3),outcome,result:{schemaVersion:1,status:'recorded_private',
          requestId:input.request.requestId,reportId:id(4),publicationId:target.publicationId,revision:target.revision,
          replayed:false,operationId:id(3),target,lifecycle:{schemaVersion:1,reportId:id(4),receivedAtMs:NOW,
            closedAtMs:null,erasedAtMs:null,eraseReason:null},version:1,observedAtMs:NOW+DAY,payloadAvailable:true}};
      },recover:async()=>{recovers++;throw Error('No expired recovery');}},clock.token);
    assert.equal(trial.kind,'ready');
    const req=new Request('https://example.org/original-admission',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({schemaVersion:1,requestId:id(5),draft:{target:deriveCorrectionTarget(current()).target,
        fields:{kind:'missing_context',details:'INVENTED_ORIGINAL_REFERENCE_CANARY',sourceUrl:'https://example.org/invented'}}})});
    const lease=owner.begin(req,current,{kind:'invented_shared_admission',executionId:id(2),operationId:id(3),admittedAtMs:NOW});
    const prepared=await lease.observation;assert.equal(prepared.kind,'prepared_invented_handoff');
    clock.advanceForTrial({utcAtMs:NOW+DAY});
    const result=await trial.submitPreparedForTrial(prepared.token,{currentKey:id(6),previousKey:id(7),
      epoch:Math.floor((NOW+DAY)/limits.addressWindowMs)});
    assert.equal(result.kind,outcome==='unknown'?'held':'recorded_invented');
  } finally { globalThis.Map=NativeMap; }
  assert.equal(writes,1);assert.equal(reservations.length,1);assert.equal(reservations[0].admittedAtMs,NOW);
  const [ticket]=trial.recovery.pending();
  if(outcome==='confirmed'){
    assert.equal(trial.inspection.budget().acceptedInHour,1);assert.equal(trial.inspection.budget().openReports,1);
    assert.equal(reportReferences.length,1);assert.equal(reportReferences[0].value.expiresAtMs,NOW+limits.recordLifetimeMs);
  }
  clock.advanceForTrial({utcAtMs:NOW+limits.recordLifetimeMs-1});
  assert.equal(trial.inspection.budget().openReports,outcome==='confirmed'?1:0);
  clock.advanceForTrial({utcAtMs:NOW+limits.recordLifetimeMs});
  const counts=trial.inspection.budget();assert.equal(counts.openReports,0);
  assert.equal(counts.reserved,outcome==='unknown'?1:0);assert.equal(counts.unknown,outcome==='unknown'?1:0);
  assert.equal(trial.inspection.operations().retainedOperationIds,0);assert.equal(trial.inspection.operations().physical,0);
  assert.deepEqual(trial.recovery.pending(),[]);
  if(outcome==='unknown'){
    assert.equal(reservations[0].admittedAtMs,null);assert.deepEqual(await trial.recovery.recover(ticket),{kind:'held'});
  } else assert.equal(reportReferences[0].map.has(reportReferences[0].key),false);
  assert.equal(recovers,0);
});
