import assert from 'node:assert/strict';
import test from 'node:test';
import {heldDecisionsReportSchema} from '../src/operator-held-decisions.ts';
import {canonicalHeldDecisionScope,createHeldDecisionsReader,readHeldDecisions} from '../src/server/operator-held-decisions-reader.ts';
import {heldId,heldScope,heldReport,decisionRow,bytes} from './helpers/operator_held_fixture.mjs';
const quiet=()=>Promise.resolve();

test('held reader returns checked recorded metadata and exact ordinary empty/missing/changed outcomes silently',async()=>{
 const events=[],reader=x=>createHeldDecisionsReader(async()=>bytes(x),undefined,c=>events.push(c));
 assert.equal((await reader(heldReport())(heldScope())).kind,'ok');
 const empty=heldReport();empty.decisions=[];assert.equal((await reader(empty)(heldScope())).kind,'ok');
 assert.deepEqual(await reader({schemaVersion:1,status:'not_found',requested:heldScope()})(heldScope()),{kind:'not_found'});
 const scope=heldScope({decidedAt:'2026-10-05T09:01:00.000001Z',decisionId:heldId(9)});
 assert.deepEqual(await reader({schemaVersion:1,status:'changed',requested:scope})(scope),{kind:'changed'});
 assert.deepEqual(await readHeldDecisions(heldScope()),{kind:'unconfigured'});assert.deepEqual(events,[]);
});

test('invalid held selectors including throwing getters never read or log',async()=>{
 let calls=0;const events=[],read=createHeldDecisionsReader(async()=>{calls++;return bytes(heldReport());},undefined,c=>events.push(c));
 const throwing={get runId(){throw new Error('PRIVATE_CANARY');},cursor:null};
 for(const x of [null,[],{},throwing,{...heldScope(),sql:'PRIVATE_CANARY'},heldScope({decidedAt:'2026-10-05T09:01:00Z',decisionId:heldId(9)}),
  heldScope({decidedAt:'2026-02-30T09:01:00.000001Z',decisionId:heldId(9)}),heldScope({decidedAt:'2026-10-05T09:01:00.000001Z',decisionId:heldId(9),extra:1})]){
  assert.deepEqual(await read(x),{kind:'invalid_scope'});assert.equal(canonicalHeldDecisionScope(x),null);
 }assert.equal(calls,0);assert.deepEqual(events,[]);
});

test('held report tuple bounds, complete checks and unknown private fields fail closed',()=>{
 const cases=[x=>x.decisions.reverse(),x=>x.decisions[1]=structuredClone(x.decisions[0]),x=>x.decisions[0].decidedAt='2026-10-05T08:00:00.000000Z',
  x=>x.decisions[0].decidedAt='2026-10-05T11:00:00.000000Z',x=>x.decisions[0].checks.no_sensitive_data='PRIVATE_CANARY',
  x=>delete x.decisions[0].checks.no_sensitive_data,x=>x.decisions[0].checks.other='PRIVATE_CANARY',x=>x.decisions[0].reasonCodes=['PRIVATE_CANARY'],
  x=>x.decisions[0].reasonCodes=[],x=>x.decisions[0].undisclosedReasonCount=24,x=>x.decisions[0].contentSha256='PRIVATE_CANARY',
  x=>x.more=true,x=>x.nextCursor={decidedAt:x.decisions[1].decidedAt,decisionId:x.decisions[1].decisionId}];
 for(const mutate of cases){const x=heldReport();mutate(x);assert.equal(heldDecisionsReportSchema.safeParse(x).success,false);}
 const x=heldReport();x.decisions[0].reasonCodes=['material_conflict','material_conflict'];x.decisions[0].undisclosedReasonCount=2;x.decisions[0].undisclosedCheckCount=1;
 assert.equal(heldDecisionsReportSchema.safeParse(x).success,true);
});

test('actual held reader traverses 20 plus5 equal-time tuples and refuses mismatched next or window',async()=>{
 const all=Array.from({length:25},(_,i)=>decisionRow(39-i)),next={decidedAt:all[19].decidedAt,decisionId:all[19].decisionId},seen=[];
 const read=createHeldDecisionsReader(async s=>{seen.push(s);const x=heldReport(s);x.decisions=s.cursor===null?all.slice(0,20):all.slice(20);x.more=s.cursor===null;x.nextCursor=x.more?next:null;return bytes(x);},undefined,quiet);
 const first=await read(heldScope());assert.equal(first.kind,'ok');const second=await read(heldScope(first.report.nextCursor));assert.equal(second.kind,'ok');
 assert.deepEqual([...first.report.decisions,...second.report.decisions].map(x=>x.decisionId),all.map(x=>x.decisionId));assert.equal(seen.length,2);
 const bad=heldReport(heldScope(next));bad.decisions=[all[19]];assert.equal(heldDecisionsReportSchema.safeParse(bad).success,false);
 const wrong=structuredClone(first.report);wrong.nextCursor.decisionId=heldId(99);assert.equal(heldDecisionsReportSchema.safeParse(wrong).success,false);
});

test('held wire faults bind the request and emit only the existing diagnostic code',async()=>{
 const events=[],record=c=>events.push(c),wrong=heldReport();wrong.requested.runId=heldId(99);
 for(const payload of [bytes(wrong),new Uint8Array([255,255]),new Uint8Array(65537),bytes({...heldReport(),private:'PRIVATE_CANARY'}),
  bytes({schemaVersion:1,status:'changed',requested:heldScope()})]){
  assert.deepEqual(await createHeldDecisionsReader(async()=>payload,undefined,record)(heldScope()),{kind:'unavailable'});
 }assert.deepEqual(events,Array(5).fill('operator_audit_read'));
});

test('held cancellation and late rejection stay silent while monotonic deadline/clock faults are held',async()=>{
 const events=[],parent=new AbortController();parent.abort();let calls=0;
 const pre=createHeldDecisionsReader(async()=>{calls++;return bytes(heldReport());},undefined,c=>events.push(c));
 assert.deepEqual(await pre(heldScope(),parent.signal),{kind:'unavailable'});assert.equal(calls,0);
 const p=new AbortController();let reject;const read=createHeldDecisionsReader(()=>new Promise((_a,b)=>reject=b),undefined,c=>events.push(c));
 const pending=read(heldScope(),p.signal);await new Promise(r=>setImmediate(r));p.abort();assert.deepEqual(await pending,{kind:'unavailable'});reject(new Error('PRIVATE_CANARY'));await new Promise(r=>setImmediate(r));assert.deepEqual(events,[]);
 let tick=0;assert.deepEqual(await createHeldDecisionsReader(async()=>bytes(heldReport()),()=>tick++===0?0:3000,c=>events.push(c))(heldScope()),{kind:'unavailable'});
 assert.deepEqual(await createHeldDecisionsReader(async()=>bytes(heldReport()),()=>{throw new Error('PRIVATE_CANARY');},c=>events.push(c))(heldScope()),{kind:'unavailable'});
 assert.deepEqual(events,['operator_audit_read','operator_audit_read']);
});

test('failing or unfinished held diagnostic recorders cannot mask the held outcome',async()=>{
 for(const record of [()=>{throw new Error('PRIVATE_CANARY');},()=>Promise.reject(new Error('PRIVATE_CANARY')),()=>new Promise(()=>{})]){
  assert.deepEqual(await createHeldDecisionsReader(async()=>{throw new Error('PRIVATE_CANARY');},undefined,record)(heldScope()),{kind:'unavailable'});
 }
});


test('empty held continuation cannot precede its run while an exact boundary and ordinary absence remain valid',async()=>{
 const before=heldScope({decidedAt:'2026-10-05T08:59:59.999999Z',decisionId:heldId(9)});
 const empty=heldReport(before);empty.decisions=[];
 const events=[],read=x=>createHeldDecisionsReader(async()=>bytes(x),undefined,c=>events.push(c));
 assert.equal(heldDecisionsReportSchema.safeParse(empty).success,false);
 assert.deepEqual(await read(empty)(before),{kind:'unavailable'});
 assert.deepEqual(events,['operator_audit_read']);
 const atStart=heldScope({decidedAt:empty.run.createdAt,decisionId:heldId(9)});
 const valid=heldReport(atStart);valid.decisions=[];
 assert.equal(heldDecisionsReportSchema.safeParse(valid).success,true);
 assert.equal((await read(valid)(atStart)).kind,'ok');
 for(const status of ['changed','not_found']){
  assert.deepEqual(await read({schemaVersion:1,status,requested:before})(before),{kind:status});
 }
 assert.deepEqual(events,['operator_audit_read']);
});
