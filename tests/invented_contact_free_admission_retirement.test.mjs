import assert from 'node:assert/strict';
import test from 'node:test';
import {createInventedContactFreeAdmission} from '../src/invented-contact-free-admission.ts';
import {contactFreeCorrectionPolicy as limits} from '../src/contact-free-correction-policy.ts';

const NOW=Date.parse('2026-10-08T10:00:00Z');
const id=n=>`fe080000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function setup() {
  let now=NOW; const maps=[],NativeMap=globalThis.Map;
  globalThis.Map=new Proxy(NativeMap,{construct(target,args){
    const map=Reflect.construct(target,args); maps.push(map); return map;
  }});
  let model;
  try { model=createInventedContactFreeAdmission({kind:'fresh_invented_trial',openReports:0,acceptedAtMs:[]},()=>now); }
  finally { globalThis.Map=NativeMap; }
  assert.equal(model.kind,'ready');
  const [buckets,reservations,reports]=maps;
  assert.ok(buckets&&reservations&&reports);
  const input=n=>({currentKey:id(n),previousKey:id(n+1000),epoch:Math.floor(now/limits.addressWindowMs),bodyBytes:100});
  return {...model,buckets,reservations,reports,at(value){now=value;},begin(n=1){return model.writer.begin(input(n));},
    beginOriginal(at,n=1){return model.writer.beginWithOriginalAdmissionForTrial(input(n),at);}};
}

test('original180d boundary retires admission scalar while opaque debt blocks new work',()=>{
  const state=setup(),token=state.begin().token,reservation=state.reservations.get(token);
  state.at(NOW+limits.recordLifetimeMs-1);state.inspection.counts();
  assert.equal(reservation.admittedAtMs,NOW);
  state.at(NOW+limits.recordLifetimeMs);
  assert.equal(state.inspection.counts().reserved,1);
  assert.equal(reservation.admittedAtMs,null);
  assert.deepEqual(state.begin(2),{kind:'held',reason:'uncertain'});
  assert.deepEqual(state.writer.settle({},'not_written'),{kind:'held',reason:'invalid_context'});
  assert.deepEqual(state.recovery.resolve(token,'accepted'),{kind:'held',reason:'invalid_context'});
  assert.equal(state.reservations.size,1);
});

for(const recovering of [false,true])for(const outcome of ['accepted','not_written'])
test(`retired ${recovering?'unknown':'pending'} debt accepts one explicit known ${outcome} without renewing metadata`,()=>{
  const state=setup(),token=state.begin().token,reservation=state.reservations.get(token);
  if(recovering)assert.deepEqual(state.writer.settle(token,'unknown'),{kind:'uncertain'});
  state.at(NOW+limits.recordLifetimeMs);state.inspection.counts();
  assert.equal(reservation.admittedAtMs,null);
  const finish=recovering?state.recovery.resolve:state.writer.settle;
  const result=finish(token,outcome);
  assert.equal(result.kind,outcome==='accepted'?'counted_accepted':'released');
  const counts=state.inspection.counts();
  assert.equal(counts.reserved,0);assert.equal(counts.openReports,0);
  assert.equal(counts.acceptedInHour,outcome==='accepted'?1:0);
  assert.equal(state.reports.size,0);assert.equal(reservation.admittedAtMs,null);
  assert.deepEqual(finish(token,outcome),{kind:'held',reason:'invalid_context'});
  if(outcome==='accepted')assert.deepEqual(state.reviewer.closeCountedReport(result.report),{kind:'held',reason:'invalid_context'});
  assert.equal(state.begin(2).kind,'reserved');
});

test('permanent context loss immediately retires owned keys and timelines while keeping opaque capacity debt',()=>{
  const state=setup(),accepted=state.writer.settle(state.begin(1).token,'accepted');
  const token=state.begin(2).token,reservation=state.reservations.get(token);
  assert.equal(state.buckets.size,2);assert.equal(state.reports.size,1);
  assert.equal(state.inspection.counts().acceptedInHour,1);
  state.recovery.invalidateForTrial();
  assert.equal(state.buckets.size,0);assert.equal(state.reports.size,0);
  assert.equal(state.reservations.size,1);assert.equal(reservation.admittedAtMs,null);
  assert.equal(reservation.state,'unknown');
  state.at(NOW+2*limits.recordLifetimeMs);
  for(const result of [state.begin(3),state.writer.settle(token,'not_written'),
    state.recovery.resolve(token,'accepted'),state.reviewer.closeCountedReport(accepted.report),state.inspection.counts()])
    assert.deepEqual(result,{kind:'held',reason:'invalid_context'});
});

test('original reference binding uses current attempt/hour clocks without extending the reference lifetime',()=>{
  const state=setup(),day=86400000;state.at(NOW+day);
  const token=state.beginOriginal(NOW).token;
  assert.equal(state.reservations.get(token).admittedAtMs,NOW);
  assert.deepEqual([...state.buckets.values()][0].attempts,[NOW+day]);
  const accepted=state.writer.settle(token,'accepted');assert.equal(accepted.kind,'counted_accepted');
  assert.equal(state.inspection.counts().acceptedInHour,1);
  assert.equal(state.reports.get(accepted.report).expiresAtMs,NOW+limits.recordLifetimeMs);
  state.at(NOW+limits.recordLifetimeMs-1);assert.equal(state.inspection.counts().openReports,1);
  state.at(NOW+limits.recordLifetimeMs);assert.equal(state.inspection.counts().openReports,0);
  assert.equal(state.reports.size,0);
  assert.deepEqual(state.reviewer.closeCountedReport(accepted.report),{kind:'held',reason:'invalid_context'});
});

test('original reference binding refuses future expired or malformed scalars without issuing capacity',()=>{
  const state=setup();
  for(const time of [NOW+1,null,true,NaN,-1,'now',{},undefined])
    assert.deepEqual(state.beginOriginal(time),{kind:'held',reason:'invalid_context'});
  state.at(NOW+limits.recordLifetimeMs);
  assert.deepEqual(state.beginOriginal(NOW),{kind:'held',reason:'invalid_context'});
  assert.equal(state.reservations.size,0);assert.equal(state.buckets.size,0);
  assert.equal(state.beginOriginal(NOW+1).kind,'reserved');
});
