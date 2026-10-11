import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCurrentParentSource, requireRecentParentSource } from '../src/current-parent-source.ts';
import { createCurrentParentSourceObserver } from '../src/server/current-parent-source.ts';

const base='2026-10-09T10:00:00';
const instant=(fraction='000000',suffix='Z',prefix=base)=>`${prefix}.${fraction}${suffix}`;
const record=(preparedAt=instant(),recordedAt=instant())=>({state:'observed',observation:{
  schemaVersion:1,evidenceKind:'current_named_parent_source_comparison',recordedAt,preparedAt,
  pointInTimeOnly:true,preparedFilesOnly:true,preparedFiles:85,comparison:'matched',matchedFiles:85,
  changedFiles:0,unavailableFiles:0,deploymentReviewComplete:false,collectionPermissionIssued:false,
  candidateModulesImported:false,workerExecuted:false,configurationChanged:false,sourceRequests:0,
  publicationEnabled:false,scheduleEnabled:false,
}});
const held={state:'held',reason:'parent_source_comparison_unavailable'};
const request=()=>new Request('http://127.0.0.1:3000/api/dev/parent-source',{headers:{'sec-fetch-site':'same-origin'}});

test('one-microsecond preparation reversal refuses throughout the supported calendar',()=>{
  for(const prefix of ['0001-01-01T00:00:00','1969-12-31T23:59:59',base,'9999-12-31T23:59:59']){
    assert.throws(()=>parseCurrentParentSource(record(instant('731928','Z',prefix),instant('731927','+00:00',prefix))));
  }
});

test('equivalent fractional spelling and exact preparation equality remain valid',()=>{
  for(const [prepared,recorded] of [['',''],['.1','.100000'],['.731927','.731927'],['.000000','']]){
    const value=record(base+prepared+'Z',base+recorded+'+00:00');
    assert.deepEqual(parseCurrentParentSource(value),value);
  }
});

test('a recorded microsecond after an integer-millisecond clock is held',()=>{
  for(const prefix of ['0001-01-01T00:00:00','1969-12-31T23:59:59',base,'9999-12-31T23:59:59']){
    const value=record(instant('000000','Z',prefix),instant('000001','Z',prefix));
    assert.throws(()=>requireRecentParentSource(value,Date.parse(instant('000000','Z',prefix))),/Parent comparison time unavailable/);
  }
});

test('exact thirty-second freshness endpoint keeps a fractional clock',()=>{
  const value=record(instant('000000'),instant('000250'));
  const origin=Date.parse(instant());
  assert.deepEqual(requireRecentParentSource(value,origin+30_000.25),value);
  assert.throws(()=>requireRecentParentSource(value,origin+30_000.375),/Parent comparison time unavailable/);
});

test('fractional positive and negative clocks cannot borrow the next microsecond',()=>{
  const epoch='1970-01-01T00:00:00';
  assert.deepEqual(requireRecentParentSource(record(instant('000000','Z',epoch),instant('000031','Z',epoch)),0.03125),
    record(instant('000000','Z',epoch),instant('000031','Z',epoch)));
  assert.throws(()=>requireRecentParentSource(record(instant('000000','Z',epoch),instant('000032','Z',epoch)),0.03125));
  const before='1969-12-31T23:59:59';
  const valid=record(instant('999968','Z',before),instant('999968','Z',before));
  assert.deepEqual(requireRecentParentSource(valid,-0.03125),valid);
  assert.throws(()=>requireRecentParentSource(record(instant('999968','Z',before),instant('999969','Z',before)),-0.03125));
});

test('finite-clock extremes and signed zero remain bounded and deterministic',()=>{
  const epoch='1970-01-01T00:00:00', value=record(instant('000000','Z',epoch),instant('000000','Z',epoch));
  for(const now of [0,-0,Number.MIN_VALUE])assert.deepEqual(requireRecentParentSource(value,now),value);
  for(const now of [-Number.MIN_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE,NaN,Infinity,-Infinity])
    assert.throws(()=>requireRecentParentSource(value,now),/Parent comparison time unavailable/);
});

test('well-formed holds retain their established clock-independent response',()=>{
  for(const now of [NaN,Infinity,-Infinity,0])assert.deepEqual(requireRecentParentSource(held,now),held);
});

test('valid exact comparisons retain raw stamps and all held permission flags',()=>{
  const value=record(instant('000123'),instant('000456','+00:00')), before=JSON.stringify(value);
  const result=requireRecentParentSource(value,Date.parse(instant())+1);
  assert.deepEqual(result,value);assert.equal(JSON.stringify(value),before);
  for(const key of ['collectionPermissionIssued','deploymentReviewComplete','candidateModulesImported','workerExecuted','configurationChanged','publicationEnabled','scheduleEnabled'])
    assert.equal(result.observation[key],false);
  assert.equal(result.observation.sourceRequests,0);
});

test('injected observer holds invalid microsecond chronology or future time without diagnostics',async()=>{
  const now=Date.parse(instant());
  for(const value of [record(instant('000001'),instant()),record(instant(),instant('000001'))]){
    let reads=0;const events=[];
    const handle=createCurrentParentSourceObserver(async()=>{reads++;return value;},()=>now,(...args)=>events.push(args));
    const response=await handle(request(),'development');
    const text=await response.text();
    assert.equal(response.status,200);assert.deepEqual(JSON.parse(text),held);
    assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(reads,1);
    assert.ok(!text.includes('private-canary'));assert.ok(!text.includes('preparedAt'));
  }
});

test('injected observer preserves valid exact microsecond observations',async()=>{
  const value=record(instant('000249'),instant('000250'));let reads=0;
  const handle=createCurrentParentSourceObserver(async()=>{reads++;return value;},()=>Date.parse(instant())+0.25,()=>{});
  const response=await handle(request(),'development');
  assert.equal(response.status,200);assert.deepEqual(await response.json(),value);assert.equal(reads,1);
  assert.equal(response.headers.get('cache-control'),'no-store');
});
