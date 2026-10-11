import assert from 'node:assert/strict';
import test from 'node:test';
import { operatorAuditChoicesSchema } from '../src/operator-audit-choices.ts';
import { canonicalOperatorAuditChoice, canonicalOperatorAuditRunCursor, createOperatorAuditChoicesReader, readOperatorAuditChoices } from '../src/server/operator-audit-choices-reader.ts';
import { OPERATOR_AUDIT_BYTES, OPERATOR_AUDIT_TIMEOUT_MS } from '../src/server/operator-audit-reader.ts';
import { choices, choiceId, bytes } from './helpers/operator_audit_choices_fixture.mjs';
const held={kind:'unavailable'}, turn=()=>new Promise(resolve=>setImmediate(resolve));
const quiet=()=>Promise.resolve();

const tuple = run => ({createdAt:run.createdAt,runId:run.runId});
function historyPage(selected=choiceId(29),cursor=null) {
  const report=choices(selected),all=Array.from({length:26},(_,i)=>({runId:choiceId(29-i),jurisdictionId:'invented-jurisdiction',createdAt:'2026-10-05T09:00:00.000001Z',runState:'completed'}));
  report.runs=cursor===null?all.slice(0,20):all.slice(20);report.moreRuns=cursor===null;
  report.nextCursor=report.moreRuns?tuple(report.runs.at(-1)):null;report.requestedCursor=cursor;
  report.selectedRun=all.find(run=>run.runId===selected)??null;report.issues=report.selectedRun?[{issueId:choiceId(30),issueKey:'housing-costs'}]:[];
  return report;
}

test('run continuation binds complete tuples, preserves microseconds and independently resolves a newer selected run',async()=>{
  const first=historyPage(),cursor=first.nextCursor,second=historyPage(choiceId(29),cursor);
  assert.equal(operatorAuditChoicesSchema.safeParse(first).success,true);assert.equal(operatorAuditChoicesSchema.safeParse(second).success,true);
  assert.equal(new Set([...first.runs,...second.runs].map(run=>run.runId)).size,26);assert.equal(second.selectedRun.runId,choiceId(29));
  for(const mutate of [r=>r.runs[0].runId=cursor.runId,r=>r.runs[0].createdAt='2026-10-05T09:00:00.000002Z',r=>r.nextCursor=cursor,
    r=>r.requestedCursor.createdAt='2026-10-05T11:00:00.000001Z']){const value=structuredClone(second);mutate(value);assert.equal(operatorAuditChoicesSchema.safeParse(value).success,false);}
  const bad=structuredClone(first);bad.nextCursor.runId=choiceId(11);assert.equal(operatorAuditChoicesSchema.safeParse(bad).success,false);
  const original={...cursor};let captured;
  const read=createOperatorAuditChoicesReader(async(id,_signal,c)=>{captured=c;assert.equal(id,choiceId(29));assert.ok(Object.isFrozen(c));return bytes(second);},undefined,quiet);
  const pending=read(choiceId(29),undefined,original);original.runId=choiceId(99);assert.equal((await pending).kind,'ok');assert.deepEqual(captured,cursor);
});

test('invalid cursor calendars, partial fields, precision, extensions and throwing getters refuse provider',async()=>{
  let calls=0;const read=createOperatorAuditChoicesReader(async()=>{calls++;return bytes(choices());},undefined,quiet);
  const invalid=[{},[],{runId:choiceId(1)}, {createdAt:'2026-10-05T09:00:00Z',runId:choiceId(1)},
    {createdAt:'2026-10-05T09:00:00.00001Z',runId:choiceId(1)}, {createdAt:'2026-02-30T09:00:00.000001Z',runId:choiceId(1)},
    {createdAt:'2026-10-05T09:00:00.000001+00:00',runId:choiceId(1)}, {createdAt:'0000-01-01T00:00:00.000000Z',runId:choiceId(1)},
    {createdAt:'2026-10-05T09:00:00.000001Z',runId:choiceId(1),sql:'PRIVATE_CANARY'}, {get createdAt(){throw new Error('PRIVATE_CANARY');},runId:choiceId(1)}];
  for(const value of invalid){assert.equal(canonicalOperatorAuditRunCursor(value),undefined);assert.deepEqual(await read(null,undefined,value),{kind:'invalid_scope'});}
  assert.equal(calls,0);
});

test('missing or changed continuation is ordinary and detail-free; stale wire version and wrong request are withheld',async()=>{
  const cursor={createdAt:'2026-10-05T09:00:00.000001Z',runId:choiceId(10)},intents=[];
  let envelope={schemaVersion:2,status:'changed',requestedRunId:null,requestedCursor:cursor};
  const read=createOperatorAuditChoicesReader(async()=>bytes(envelope),undefined,code=>intents.push(code));
  assert.deepEqual(await read(null,undefined,cursor),{kind:'changed'});assert.deepEqual(intents,[]);
  envelope={...envelope,requestedCursor:{...cursor,runId:choiceId(11)}};assert.deepEqual(await read(null,undefined,cursor),held);
  envelope={schemaVersion:1,...choices()};envelope.schemaVersion=1;assert.deepEqual(await read(),held);
  assert.deepEqual(intents,['operator_audit_read','operator_audit_read']);
});

test('choices refuse noncanonical selectors before provider; no selection and unconfigured are distinct',async()=>{
  let calls=0;const read=createOperatorAuditChoicesReader(async()=>{calls++;return bytes(choices());},undefined,quiet);
  for(const value of [undefined,{},[],1,'',choiceId(1).toUpperCase().replace('9000','9ABC'),'../private',choiceId(1).replace('-4000-','-1000-')]){
    assert.equal(canonicalOperatorAuditChoice(value),undefined);
    if(value!==undefined)assert.deepEqual(await read(value),{kind:'invalid_scope'});
  }
  assert.equal(calls,0);assert.deepEqual(await readOperatorAuditChoices(),{kind:'unconfigured'});
  assert.equal((await read()).kind,'ok');assert.equal(calls,1);
});

test('curated choices preserve exact requested run and microsecond order; repeated reads do not cache',async()=>{
  let calls=0,signal;const id=choiceId(1),value=choices(id),intents=[];
  const read=createOperatorAuditChoicesReader(async(run,child)=>{calls++;signal=child;assert.equal(run,id);return bytes(value);},undefined,code=>intents.push(code));
  for(let i=0;i<2;i++){const got=await read(id);assert.equal(got.kind,'ok');assert.deepEqual(got.report,value);assert.equal(signal.aborted,true);}
  assert.equal(calls,2);assert.deepEqual(intents,[]);
  value.requestedRunId=choiceId(2);assert.deepEqual(await read(id),held);assert.deepEqual(intents,['operator_audit_read']);
});

test('empty and absent selected runs are valid checked data, not technical faults',async()=>{
  const absent=choices(choiceId(99)),empty={...choices(),runs:[]},intents=[];
  for(const value of [absent,empty])assert.equal((await createOperatorAuditChoicesReader(async()=>bytes(value),undefined,code=>intents.push(code))(value.requestedRunId)).kind,'ok');
  assert.deepEqual(intents,[]);
});

test('strict report refuses private fields, duplicate identity, inconsistent selection and hidden truncation',async()=>{
  const mutations=[v=>v.raw='PRIVATE_CANARY',v=>v.runs[0].requestedBy='PRIVATE_CANARY',v=>v.issues[0].title='PRIVATE_CANARY',
    v=>v.runs.push({...v.runs[0]}),v=>v.issues.push({...v.issues[0]}),v=>v.moreRuns=true,v=>v.moreIssues=true,
    v=>v.selectedRun={...v.selectedRun,runState:'failed'},v=>v.selectedRun=null,
    v=>v.requestedRunId=null,v=>v.issues[0].issueKey='<script>private</script>',v=>v.runs[0].jurisdictionId='private/value'];
  for(const mutate of mutations){const value=choices(choiceId(1));mutate(value);
    assert.equal(operatorAuditChoicesSchema.safeParse(value).success,false);
    assert.deepEqual(await createOperatorAuditChoicesReader(async()=>bytes(value),undefined,quiet)(choiceId(1)),held);
  }
});

test('bounded order and exact timestamps reject future or reordered records, including same millisecond',()=>{
  const mutations=[v=>v.runs.reverse(),v=>v.runs[1].createdAt='2026-10-05T09:00:00.000002Z',
    v=>v.runs[0].createdAt='2026-10-05T10:00:00.000001Z',v=>v.observedAt='0000-01-01T00:00:00Z',
    v=>v.runs[0].createdAt='2026-02-30T09:00:00Z',v=>v.issues=[{issueId:choiceId(31),issueKey:'z-key'},...v.issues]];
  for(const mutate of mutations){const value=choices(choiceId(1));mutate(value);assert.equal(operatorAuditChoicesSchema.safeParse(value).success,false);}
});

test('selected run outside the newest page requires real truncation and an older sort position',()=>{
  const outside=choices(choiceId(90));outside.selectedRun={...outside.runs[0],runId:choiceId(90),createdAt:'2026-10-05T08:00:00Z'};
  assert.equal(operatorAuditChoicesSchema.safeParse(outside).success,false);
  outside.runs=Array.from({length:20},(_,i)=>({...outside.runs[0],runId:choiceId(20-i)}));outside.moreRuns=true;outside.nextCursor={createdAt:outside.runs.at(-1).createdAt,runId:outside.runs.at(-1).runId};
  assert.equal(operatorAuditChoicesSchema.safeParse(outside).success,true);
  outside.selectedRun.createdAt='2026-10-05T09:00:00.000002Z';assert.equal(operatorAuditChoicesSchema.safeParse(outside).success,false);
  outside.selectedRun.createdAt=outside.runs[0].createdAt;assert.equal(operatorAuditChoicesSchema.safeParse(outside).success,false);
});

test('malformed, extended and oversized transport data withholds all choices without error bodies',async()=>{
  const intents=[];for(const raw of [new Uint8Array([255,255]),bytes(null),bytes('PRIVATE_CANARY'),bytes({}),
    new Uint8Array(OPERATOR_AUDIT_BYTES+1),new Uint8Array(1),'PRIVATE_CANARY',new ArrayBuffer(5)])
    assert.deepEqual(await createOperatorAuditChoicesReader(async()=>raw,undefined,code=>intents.push(code))(),held);
  assert.deepEqual(intents,Array(8).fill('operator_audit_read'));
  const raw=bytes(choices()),padded=new Uint8Array(OPERATOR_AUDIT_BYTES);padded.fill(32);padded.set(raw);
  assert.equal((await createOperatorAuditChoicesReader(async()=>padded,undefined,quiet)()).kind,'ok');
});

test('parent cancellation before and during reads signals provider, excludes diagnostics and refuses late data',async()=>{
  let calls=0,finish,child;const intents=[],parent=new AbortController();
  const read=createOperatorAuditChoicesReader(async(_id,signal)=>{calls++;child=signal;return new Promise(resolve=>finish=resolve);},undefined,code=>intents.push(code));
  const pre=new AbortController();pre.abort();assert.deepEqual(await read(null,pre.signal),held);assert.equal(calls,0);
  const pending=read(null,parent.signal);await turn();parent.abort();assert.deepEqual(await pending,held);
  assert.equal(child.aborted,true);finish(bytes(choices()));await turn();assert.deepEqual(intents,[]);
});

test('real timeout boundary and nonmonotonic clocks hold results; failed recorder cannot mask outcome',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let child;const intents=[];
  const pending=createOperatorAuditChoicesReader(async(_id,s)=>{child=s;return new Promise(()=>{});},undefined,code=>intents.push(code))();
  await Promise.resolve();t.mock.timers.tick(OPERATOR_AUDIT_TIMEOUT_MS);assert.deepEqual(await pending,held);assert.equal(child.aborted,true);
  assert.deepEqual(intents,['operator_audit_read']);t.mock.timers.reset();
  for(const times of [[NaN],[0,0,3000],[0,0,-1],[0,0,NaN]]){let index=0;
    assert.deepEqual(await createOperatorAuditChoicesReader(async()=>bytes(choices()),()=>times[Math.min(index++,times.length-1)],quiet)(),held);}
  for(const record of [()=>{throw new Error('PRIVATE_CANARY');},async()=>{throw new Error('PRIVATE_CANARY');},()=>new Promise(()=>{})])
    assert.deepEqual(await createOperatorAuditChoicesReader(async()=>{throw new Error('PRIVATE_CANARY');},undefined,record)(),held);
});
