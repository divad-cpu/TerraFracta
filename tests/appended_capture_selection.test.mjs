import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSelectedAppendedCaptureReader as create,readSelectedAppendedCapture} from '../src/server/appended-capture-selection.ts';
import {prepareAppendedCaptureLookup} from '../src/server/appended-capture-lookup.ts';
import {canonicalProposalJson} from '../src/operator-proposal-capture.ts';
import {APPENDED_CAPTURE_READ_SQL} from '../src/server/appended-issue-capture.ts';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
function fixture(){
 const f=JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-capture.json',import.meta.url),'utf8'));
 const native=JSON.parse(f.rawReceiptJson),report=Buffer.from(native.parts_base64[0],'base64').toString('utf8'),r=JSON.parse(report);
 const expected={reportSha256:sha(report),preparationIntentJson:r.intent_json},c=prepareAppendedCaptureLookup(report,expected,f.observedAt);
 const meta={schema_version:1,kind:'invented_appended_capture_lookup',scope:{...c.scope},principal:'postgres',session_principal:'postgres',transaction_isolation:'repeatable read',transaction_read_only:true,preparation_matched:true,observed_at:f.observedAt,matches:[{capture_id:native.capture_id,preparation_operation_id:native.preparation_operation_id,stored_at:native.stored_at,intent_sha256:sha(f.retainedIntentJson)}]};
 const input={preparationReportJson:report,preparationReportSha256:sha(report),preparationIntentJson:r.intent_json,lookupRaw:Buffer.from(JSON.stringify(meta)),captureId:native.capture_id,captureIntentJson:f.retainedIntentJson,observedAt:f.observedAt};
 return {input,meta,f,native,raw:Buffer.from(f.rawReceiptJson)};
}
const revise=(x,fn)=>{fn(x.meta);x.input.lookupRaw=Buffer.from(JSON.stringify(x.meta));return x;};
test('explicit independent capture selection issues one frozen fixed read and matches complete preparation and stored metadata',async()=>{
 const x=fixture();let calls=0,signal;
 const read=create(async(c,s)=>{calls++;signal=s;assert.equal(c.sql,APPENDED_CAPTURE_READ_SQL);assert.deepEqual(c.values,[x.input.captureId]);assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.values));return x.raw;},()=>0,()=>{});
 const out=await read(x.input);assert.equal(out.kind,'ok');assert.equal(calls,1);assert.ok(signal.aborted);assert.equal(out.stored.receiptSha256,x.f.receiptSha256);assert.equal(out.selected.storedAt,x.native.stored_at);assert.match(out.evidenceState,/historical.*not_current/);
});
test('valid selection remains unconfigured without a default connection',async()=>{
 assert.deepEqual(await readSelectedAppendedCapture(fixture().input),{kind:'unconfigured'});
});
test('closed mandatory own inputs, full preparation and native lookup are required before provider dispatch',async()=>{
 let calls=0,ticks=0;const read=create(async()=>{calls++;throw Error('PRIVATE');},()=>{ticks++;return 0;},()=>{});
 for(const mutate of [x=>delete x.input.captureIntentJson,x=>x.input.extra='PRIVATE',x=>x.input.preparationReportJson='{}',x=>x.input.lookupRaw=Buffer.from('{}'),x=>Object.defineProperty(x.input,'captureId',{value:x.input.captureId,enumerable:false}),x=>Object.defineProperty(x.input,'preparationReportJson',{enumerable:true,get(){throw Error('PRIVATE');}})]){
  const x=fixture();mutate(x);assert.deepEqual(await read(x.input),{kind:'invalid_scope'});
 }
 assert.deepEqual(await read(Object.create(fixture().input)),{kind:'invalid_scope'});assert.equal(calls,0);assert.equal(ticks,7);
});
test('explicit wrong ID, foreign preparation and wrong independent capture intent are held before full read',async()=>{
 let calls=0;const read=create(async()=>{calls++;return fixture().raw;},()=>0,()=>{});
 for(const mutate of [x=>x.input.captureId='00000000-0000-4000-8000-000000000999',x=>x.input.captureIntentJson=canonicalProposalJson({...JSON.parse(x.input.captureIntentJson),part_sha256:Array(6).fill('f'.repeat(64))}),x=>x.input.captureIntentJson=canonicalProposalJson({...JSON.parse(x.input.captureIntentJson),preparation_artifact_id:'00000000-0000-4000-8000-000000000999'})]){
  const x=fixture();mutate(x);assert.deepEqual(await read(x.input),{kind:'invalid_scope'});
 }
 assert.equal(calls,0);
});
test('legitimate no-match metadata is not_found and cannot manufacture missing independent intent',async()=>{
 const x=revise(fixture(),m=>m.matches=[]);let calls=0;const read=create(async()=>{calls++;return x.raw;},()=>0,()=>{});
 assert.deepEqual(await read(x.input),{kind:'not_found'});delete x.input.captureIntentJson;assert.deepEqual(await read(x.input),{kind:'invalid_scope'});assert.equal(calls,0);
});
test('captured own inputs and native lookup bytes survive mutation while provider is pending',async()=>{
 const x=fixture();let resolve;const pending=new Promise(r=>resolve=r);let entered;const gate=new Promise(r=>entered=r);
 const read=create(async()=>{entered();return pending;},()=>0,()=>{}),result=read(x.input);await gate;
 x.input.lookupRaw.fill(0);x.input.captureIntentJson='{}';x.input.preparationReportJson='{}';x.input.observedAt='invalid';resolve(x.raw);
 assert.equal((await result).kind,'ok');
});
test('metadata store-time change is withheld after the complete independent read',async()=>{
 const x=revise(fixture(),m=>m.matches[0].stored_at=m.matches[0].stored_at.replace(/\.(\d{6})Z$/,(_,n)=>'.'+String(Number(n)+1).padStart(6,'0')+'Z'));let calls=0;
 const out=await create(async()=>{calls++;return x.raw;},()=>0,()=>{})(x.input);assert.deepEqual(out,{kind:'changed'});assert.equal(calls,1);assert.deepEqual(Object.keys(out),['kind']);
});
test('independent full preparation receipt hash mismatch is withheld even with matching operation and artifact',async()=>{
 const x=fixture(),report=JSON.parse(x.input.preparationReportJson);report.preparation.full_receipt_sha256='f'.repeat(64);x.input.preparationReportJson=canonicalProposalJson(report);x.input.preparationReportSha256=sha(x.input.preparationReportJson);
 const out=await create(async()=>x.raw,()=>0,()=>{})(x.input);assert.deepEqual(out,{kind:'changed'});
});
test('parent cancellation and unavailable provider retain bounded opaque outcomes without installing partial selection',async()=>{
 const x=fixture();let calls=0;const controller=new AbortController();controller.abort();const read=create(async()=>{calls++;return x.raw;},()=>0,()=>{});
 assert.deepEqual(await read(x.input,controller.signal),{kind:'unavailable'});assert.equal(calls,0);
 assert.deepEqual(await create(async()=>{throw Error('PRIVATE_SOURCE_TEXT');},()=>0,()=>{})(x.input),{kind:'unavailable'});
});

test('parent abort during completed inner reader cleanup retires the whole explicit selection',async()=>{
 const x=fixture(),parent=new AbortController();
 const read=create(async(_command,child)=>{child.addEventListener('abort',()=>parent.abort(),{once:true});return x.raw;},()=>0,()=>{});
 assert.deepEqual(await read(x.input,parent.signal),{kind:'unavailable'});
});
test('original selection interval rejects late invalid or backward clock after inner read cleanup',async()=>{
 for(const end of [3000,NaN,-1]){
  const x=fixture();let tick=0;
  const read=create(async(_command,child)=>{child.addEventListener('abort',()=>{tick=end;},{once:true});return x.raw;},()=>tick,()=>{});
  assert.deepEqual(await read(x.input),{kind:'unavailable'});
 }
});
