import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {createRecordedInitialCaptureHistoryResolver as create} from '../src/server/recorded-initial-capture-history.ts';
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-initial-capture-history.json',import.meta.url),'utf8'));
const saved=()=>fixture().record;
function input(){const f=fixture();return {preparationId:f.preparationId,captureId:f.captureId,preparationReportJson:f.preparationReportJson,preparationExpected:f.preparationExpected,lookupRaw:Buffer.from(f.lookupJson),lookupObservedAt:f.lookupObservedAt,captureObservedAt:f.captureObservedAt,record:f.record};}
const run=(now=()=>0)=>create(now,async()=> 'unavailable');
const opaque=result=>assert.deepEqual(Object.keys(result),['kind']);
test('explicit matching preparation and capture opens the initial four-part preparation with its separately supplied comparison',async()=>{
 const r=await run()(input());assert.equal(r.kind,'ok');assert.equal(r.joined.stored.receiptSha256,createHash('sha256').update(saved().rawReceiptJson).digest('hex'));assert.equal(r.joined.report.observedAt,JSON.parse(saved().actualComparisonJson).observedAt);assert.equal(r.preparationId,fixture().preparationId);assert.equal(r.captureId,fixture().captureId);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.display));assert.match(r.evidenceState,/not_current_or_publication/);
});
test('one metadata match never selects itself or reads a full-record getter',async()=>{
 const x=input();x.captureId=null;let gets=0;Object.defineProperty(x,'record',{enumerable:true,get(){gets++;throw Error('PRIVATE');}});const r=await run()(x);assert.equal(r.kind,'choice_required');assert.equal(r.choices.matches.length,1);assert.equal(gets,0);assert.ok(!Object.hasOwn(r,'joined'));
});
test('empty metadata is a checked observation rather than unavailable or permission to recreate',async()=>{
 const x=input(),lookup=JSON.parse(x.lookupRaw);lookup.matches=[];x.lookupRaw=Buffer.from(JSON.stringify(lookup));x.captureId=null;const none=await run()(x);assert.equal(none.kind,'choice_required');assert.equal(none.choices.matches.length,0);x.captureId=fixture().captureId;assert.deepEqual(await run()(x),{kind:'not_found'});
});
test('an explicit foreign capture or preparation never falls back to a known record',async()=>{
 const x=input();x.captureId='00000000-0000-4000-8000-000000000999';Object.defineProperty(x,'record',{enumerable:true,get(){assert.fail('foreign read');}});assert.deepEqual(await run()(x),{kind:'not_found'});const y=input();y.preparationId=x.captureId;assert.deepEqual(await run()(y),{kind:'invalid_scope'});
});
test('closed own scope and expected identity remain mandatory before record access',async()=>{
 let ticks=0;const resolve=run(()=>{ticks++;return 0;});for(const edit of [x=>delete x.captureId,x=>x.extra='PRIVATE',x=>x.captureId=undefined,x=>x.preparationExpected.extra='PRIVATE',x=>Object.defineProperty(x,'lookupRaw',{enumerable:true,get(){throw Error('PRIVATE');}}),x=>x.lookupRaw=new Proxy(x.lookupRaw,{})]){const x=input();edit(x);const r=await resolve(x);assert.equal(r.kind,'invalid_scope');opaque(r);}assert.ok(ticks>0);assert.deepEqual(await resolve(Object.create(input())),{kind:'invalid_scope'});
});
test('wrong independently supplied full preparation expectation and malformed lookup withhold payloads',async()=>{
 for(const edit of [x=>x.preparationExpected.reportSha256='f'.repeat(64),x=>x.preparationExpected.preparationIntentJson='{}',x=>x.preparationReportJson='{}',x=>x.lookupRaw=Buffer.from('{}'),x=>x.lookupRaw=Buffer.from([0xff]),x=>x.lookupRaw=new Uint8Array(4097)]){const x=input();edit(x);const r=await run()(x);assert.ok(['invalid_scope','unavailable'].includes(r.kind));opaque(r);}
});
test('independent capture intent full receipt and comparison must all match with no partial disclosure',async()=>{
 for(const edit of [x=>x.record.retainedIntentJson='{}',x=>x.record.rawReceiptJson='{}',x=>x.record.actualComparisonJson='{}',x=>{const v=JSON.parse(x.record.actualComparisonJson);v.capture.captureId='00000000-0000-4000-8000-000000000999';x.record.actualComparisonJson=JSON.stringify(v);},x=>x.record.extra='PRIVATE',x=>x.record=null]){const x=input();edit(x);assert.deepEqual(await run()(x),{kind:'unavailable'});}
});
test('changed metadata storage time cannot reopen another generation of the same capture',async()=>{
 const x=input(),lookup=JSON.parse(x.lookupRaw);lookup.matches[0].stored_at=lookup.matches[0].stored_at.replace(/\.(\d{6})Z$/,(_,n)=>'.'+String(Number(n)+1).padStart(6,'0')+'Z');x.lookupRaw=Buffer.from(JSON.stringify(lookup));assert.deepEqual(await run()(x),{kind:'unavailable'});
});
test('selected strings and lookup bytes are owned before asynchronous selection yields',async()=>{
 const x=input(),resolve=run(),pending=resolve(x);x.lookupRaw.fill(0);x.record.rawReceiptJson='PRIVATE_CHANGED';x.record.actualComparisonJson='PRIVATE_CHANGED';x.preparationReportJson='PRIVATE_CHANGED';x.preparationExpected.reportSha256='f'.repeat(64);const r=await pending;assert.equal(r.kind,'ok');assert.doesNotMatch(JSON.stringify(r.display),/PRIVATE_CHANGED/);
});
test('parent cancellation before or during selection never reveals an earlier complete match',async()=>{
 const a=new AbortController();a.abort();assert.deepEqual(await run()(input(),a.signal),{kind:'unavailable'});const b=new AbortController(),pending=run()(input(),b.signal);b.abort();assert.deepEqual(await pending,{kind:'unavailable'});
});
test('one original monotonic interval spans inner selection and final comparison',async()=>{
 for(const late of [3000,NaN,-1]){const x=input();let n=0;const r=await run(()=>++n>=5?late:0)(x);assert.deepEqual(r,{kind:'unavailable'});}
 let n=0;assert.deepEqual(await run(()=>++n===1?NaN:0)(input()),{kind:'unavailable'});
});
test('receipt and comparison byte quotas reject malformed Unicode without echoing private input',async()=>{
 for(const key of ['rawReceiptJson','actualComparisonJson','retainedIntentJson']){const x=input();x.record[key]='PRIVATE\ud800';assert.deepEqual(await run()(x),{kind:'unavailable'});}const x=input();x.record.actualComparisonJson=' '.repeat(65537);assert.deepEqual(await run()(x),{kind:'unavailable'});
});

test('parent cancellation during the final separate comparison retires the joined historical result',async t=>{
 const x=input(),a=new AbortController(),original=JSON.parse;
 t.mock.method(JSON,'parse',(raw,...args)=>{const v=original(raw,...args);if(raw===x.record.actualComparisonJson)a.abort();return v;});
 assert.deepEqual(await run()(x,a.signal),{kind:'unavailable'});
});
test('a regressing or expired clock during the final separate comparison cannot renew selection',async t=>{
 const original=JSON.parse;let comparison=null,tick=0;
 t.mock.method(JSON,'parse',(raw,...args)=>{const v=original(raw,...args);if(raw===comparison)tick=3000;return v;});
 const x=input();comparison=x.record.actualComparisonJson;assert.deepEqual(await run(()=>tick)(x),{kind:'unavailable'});
});


test('metadata and full receipt retain distinct original after-read times through the complete continuation',async()=>{
 const x=input(),r=await run()(x);assert.equal(r.kind,'ok');assert.equal(r.lookupObservedAt,x.lookupObservedAt);assert.equal(r.captureObservedAt,x.captureObservedAt);assert.equal(r.joined.stored.observedAt,x.captureObservedAt);assert.notEqual(x.lookupObservedAt,x.captureObservedAt);
});
test('a full record cannot silently substitute the earlier metadata observation or independent report expectation',async()=>{
 for(const change of [x=>x.record.captureObservedAt=x.lookupObservedAt,x=>x.record.preparationExpected.reportSha256='0'.repeat(64)]){const x=input();change(x);assert.deepEqual(await run()(x),{kind:'unavailable'});}
});
test('the full record selector is touched once only after explicit matched choice and before asynchronous work',async()=>{
 const x=input(),saved=x.record;let reads=0;Object.defineProperty(x,'record',{enumerable:true,get(){reads++;return saved;}});const pending=run()(x);assert.equal(reads,1);x.lookupRaw.fill(0);saved.rawReceiptJson='PRIVATE_CHANGED';const r=await pending;assert.equal(r.kind,'ok');assert.equal(reads,1);assert.doesNotMatch(JSON.stringify(r.display),/PRIVATE_CHANGED/);
});
test('a later private comparison mismatch suppresses earlier complete native metadata and receipt results',async()=>{
 const x=input(),r=JSON.parse(x.record.actualComparisonJson);r.target.issueId='00000000-0000-4000-8000-000000000999';x.record.actualComparisonJson=JSON.stringify(r);const out=await run()(x);assert.deepEqual(out,{kind:'unavailable'});assert.ok(!Object.hasOwn(out,'choices')&&!Object.hasOwn(out,'joined'));
});

test('metadata-only choice does not require or touch a future full-record observation',async()=>{
 const x=input();x.captureId=null;let reads=0;for(const key of ['record','captureObservedAt'])Object.defineProperty(x,key,{enumerable:true,get(){reads++;throw Error('PRIVATE_FUTURE');}});const r=await run()(x);assert.equal(r.kind,'choice_required');assert.equal(reads,0);
});

test('closed outer and nested scope rejects getter-added keys and enumerable symbols before full details',async()=>{
 const edits=[x=>x[Symbol('EXTRA_PRIVATE')]='PRIVATE',x=>{const v=x.preparationId;Object.defineProperty(x,'preparationId',{enumerable:true,get(){x.extra='PRIVATE';return v;}});},x=>{const e=x.preparationExpected,h=e.reportSha256;Object.defineProperty(e,'reportSha256',{enumerable:true,get(){e.extra='PRIVATE';return h;}});},x=>x.preparationExpected[Symbol('EXTRA_PRIVATE')]='PRIVATE',x=>{const e=x.preparationExpected;Object.defineProperty(x,'preparationExpected',{enumerable:true,get(){delete x.preparationId;return e;}});}];
 for(const edit of edits){const x=input(),saved=x.record;let reads=0,ticks=0;Object.defineProperty(x,'record',{enumerable:true,get(){reads++;return saved;}});edit(x);assert.deepEqual(await run(()=>{ticks++;return 0;})(x),{kind:'invalid_scope'});assert.equal(reads,0);assert.ok(ticks>0);}
});
test('lazy selected clock record and nested getter mutations withhold the entire joined history',async()=>{
 const edits=[
 (x,r)=>{const a=x.captureObservedAt;Object.defineProperty(x,'captureObservedAt',{enumerable:true,get(){x.extra='PRIVATE';return a;}});},
 (x,r)=>{const a=x.captureObservedAt;Object.defineProperty(x,'captureObservedAt',{enumerable:true,get(){delete x.captureId;return a;}});},
 (x,r)=>Object.defineProperty(x,'record',{enumerable:true,get(){x.extra='PRIVATE';return r;}}),
 (x,r)=>Object.defineProperty(x,'record',{enumerable:true,get(){Object.defineProperty(x,'captureId',{value:x.captureId,enumerable:false});return r;}}),
 (_x,r)=>r[Symbol('EXTRA_PRIVATE')]='PRIVATE',
 (_x,r)=>{const i=r.retainedIntentJson;Object.defineProperty(r,'retainedIntentJson',{enumerable:true,get(){r.extra='PRIVATE';return i;}});},
 (_x,r)=>{const v=r.actualComparisonJson;Object.defineProperty(r,'actualComparisonJson',{enumerable:true,get(){delete r.retainedIntentJson;return v;}});},
 (_x,r)=>{const e=r.preparationExpected,h=e.reportSha256;Object.defineProperty(e,'reportSha256',{enumerable:true,get(){e.extra='PRIVATE';return h;}});},
 (_x,r)=>{const e=r.preparationExpected,h=e.reportSha256;Object.defineProperty(e,'reportSha256',{enumerable:true,get(){r.extra='PRIVATE';return h;}});},
 (x,r)=>{const e=r.preparationExpected,h=e.reportSha256;Object.defineProperty(e,'reportSha256',{enumerable:true,get(){x.extra='PRIVATE';return h;}});}
 ];
 for(const edit of edits){const x=input();edit(x,x.record);const r=await run()(x);assert.deepEqual(r,{kind:'unavailable'});assert.ok(!Object.hasOwn(r,'joined')&&!Object.hasOwn(r,'choices'));}
});
