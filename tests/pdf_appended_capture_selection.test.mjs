import assert from 'node:assert/strict';
import test from 'node:test';
import {createSelectedPdfAppendedCaptureReader as create,readSelectedPdfAppendedCapture} from '../src/server/pdf-appended-capture-selection.ts';
import {PDF_APPENDED_CAPTURE_READ_SQL} from '../src/server/pdf-appended-issue-capture.ts';
import {pdfLookupFixture as fixture,hash} from './helpers/pdf_owner_fixture.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const native=(f,value=f.lookup)=>({...f.selection,lookupRaw:Buffer.from(JSON.stringify(value))});
const plus=at=>at.slice(0,20)+String(BigInt(at.slice(20,26))+1n).padStart(6,'0')+'Z';
test('explicit PDF selection is unconfigured by default and never selects a capture from metadata alone',async()=>{
 const f=fixture();assert.deepEqual(await readSelectedPdfAppendedCapture(f.selection),{kind:'unconfigured'});
 let calls=0;const no=()=>{calls++;assert.fail('No callback');};const read=create(no,()=>0,no);
 for(const key of Object.keys(f.selection)){const input={...f.selection};delete input[key];assert.deepEqual(await read(input),{kind:'invalid_scope'});}
 for(const key of Object.keys(f.expected)){const e={...f.expected};delete e[key];assert.deepEqual(await read({...f.selection,captureExpected:e}),{kind:'invalid_scope'});}
 for(const input of [null,[],{},Object.create(f.selection),{...f.selection,extra:true},{...f.selection,[Symbol('extra')]:true},Object.defineProperty({...f.selection},'hidden',{value:true})])assert.deepEqual(await read(input),{kind:'invalid_scope'});
 for(const key of Object.keys(f.selection)){const input={...f.selection};Object.defineProperty(input,key,{enumerable:true,get:no});assert.deepEqual(await read(input),{kind:'invalid_scope'});}
 assert.equal(calls,0);
});
test('complete chosen receipt preserves every historical part and independent expectation',async()=>{
 const f=fixture(),commands=[];const result=await create(async command=>{commands.push(command);return f.raw;},()=>0,async()=>assert.fail('No diagnostic'))(f.selection);
 assert.equal(result.kind,'ok');assert.equal(result.stored.receiptSha256,hash(f.raw));assert.equal(result.stored.intentJson,f.f.intentJson);assert.deepEqual(result.stored.bundle,f.bundle);assert.deepEqual(result.stored.expected,f.expected);assert.equal(result.stored.storedAt,f.native.stored_at);assert.equal(result.selected.captureId,f.intent.capture_id);assert.match(result.evidenceState,/not_current_work_or_publication/);
 assert.deepEqual(commands,[{sql:PDF_APPENDED_CAPTURE_READ_SQL,values:[f.intent.capture_id]}]);
});
test('empty admitted lookup is not_found before provider or recorder',async()=>{
 const f=fixture();f.lookup.matches=[];const no=()=>assert.fail('No callback');assert.deepEqual(await create(no,()=>0,no)(native(f)),{kind:'not_found'});
});
test('foreign capture intent preparation expectation and lookup digest refuse without full read',async()=>{
 const f=fixture();let calls=0;const no=()=>{calls++;assert.fail('No callback');};const read=create(no,()=>0,no);
 for(const input of [{...f.selection,captureId:'00000000-0000-4000-8000-000000000999'},{...f.selection,captureIntentJson:'{}'},{...f.selection,preparationExpected:{...f.reportExpected,preparationArtifactId:'00000000-0000-4000-8000-000000000999'}},{...f.selection,captureExpected:{...f.expected,preparationIntentJson:'{}'}},{...f.selection,lookupRaw:Buffer.from('{}')}])assert.deepEqual(await read(input),{kind:'invalid_scope'});
 f.lookup.matches[0].intent_sha256='0'.repeat(64);assert.deepEqual(await read(native(f)),{kind:'invalid_scope'});assert.equal(calls,0);
});
test('full read must match the independently selected immutable stored timestamp',async()=>{
 const f=fixture();f.lookup.matches[0].stored_at=plus(f.native.stored_at);let reads=0;
 assert.deepEqual(await create(async()=>{reads++;return f.raw;},()=>0,async()=>assert.fail('No diagnostic'))(native(f)),{kind:'changed'});assert.equal(reads,1);
});
test('each corrupt carrier withholds complete candidate after a single fixed read',async()=>{
 const f=fixture();for(let index=0;index<6;index++){
  const raw=structuredClone(f.native);raw.parts_base64[index]=Buffer.from('{}').toString('base64');let reads=0,codes=[];
  assert.deepEqual(await create(async()=>{reads++;return Buffer.from(JSON.stringify(raw));},()=>0,async c=>{codes.push(c);return 'saved';})(f.selection),{kind:'unavailable'});await tick();assert.equal(reads,1);assert.deepEqual(codes,['operator_audit_read']);
 }
});
test('selector snapshots survive caller and clock mutation before asynchronous full read',async()=>{
 const f=fixture(),before=structuredClone(f.selection);let release,clockCalls=0;
 const pending=create(()=>new Promise(r=>release=r),()=>{if(clockCalls++>0){f.selection.captureExpected.preparationIntentJson='PRIVATE_CHANGED';f.selection.preparationExpected.reportSha256='PRIVATE_CHANGED';f.selection.captureIntentJson='PRIVATE_CHANGED';}return 0;},async()=> 'saved')(f.selection);
 await tick();f.selection.lookupRaw.fill(0);f.selection.preparationReportJson='PRIVATE_CHANGED';f.selection.observedAt='2099-01-01T00:00:00.000000Z';release(f.raw);const out=await pending;assert.equal(out.kind,'ok');assert.equal(out.stored.intentJson,before.captureIntentJson);assert.deepEqual(out.stored.expected,before.captureExpected);assert.equal(out.stored.observedAt,before.observedAt);
});
test('one original monotonic interval spans nested read and final selection without renewal',async()=>{
 const f=fixture();for(const times of [[NaN],[0,3000],[0,-1],[0,0,1,0],[0,0,1,2,3,4,3000]]){
  let index=0;const now=()=>times[Math.min(index++,times.length-1)];assert.deepEqual(await create(async()=>f.raw,now,async()=> 'saved')(f.selection),{kind:'unavailable'});
 }
 let reads=0;const parent=new AbortController();parent.abort();const no=()=>assert.fail('No callback');assert.deepEqual(await create(async()=>{reads++;return f.raw;},no,no)(f.selection,parent.signal),{kind:'unavailable'});assert.equal(reads,0);
});
test('cancellation suppresses diagnostics and retires late full read without a retry',async()=>{
 const f=fixture(),parent=new AbortController(),codes=[];let release,reads=0,inner;
 const pending=create((_c,signal)=>{reads++;inner=signal;return new Promise(r=>release=r);},()=>0,async c=>{codes.push(c);return 'saved';})(f.selection,parent.signal);await tick();parent.abort();assert.deepEqual(await pending,{kind:'unavailable'});release(f.raw);await tick();assert.equal(inner.aborted,true);assert.equal(reads,1);assert.deepEqual(codes,[]);
});
