import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {getEventListeners} from 'node:events';
import {createAppendedCaptureReader} from '../src/server/appended-capture-reader.ts';
import {createHtmlAppendedCaptureReader} from '../src/server/html-appended-capture-reader.ts';
import {htmlCaptureFixture} from './helpers/html_capture_transport_fixture.mjs';
const plain=()=>{const f=JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-capture.json',import.meta.url),'utf8'));return {scope:{retainedIntentJson:f.retainedIntentJson,observedAt:f.observedAt},raw:Buffer.from(f.rawReceiptJson)};};
const html=()=>{const f=htmlCaptureFixture();return {scope:{retainedIntentJson:f.f.retainedIntentJson,observedAt:f.f.observedAt},raw:f.raw};};
for(const [format,create,fixture] of [['plain',createAppendedCaptureReader,plain],['HTML',createHtmlAppendedCaptureReader,html]]){
 test(`${format} candidate is withheld when physical retirement cancels its parent`,async()=>{
  const f=fixture(),parent=new AbortController(),codes=[];let calls=0,inner;
  const read=create(async(_c,s)=>{calls++;inner=s;s.addEventListener('abort',()=>parent.abort(),{once:true});return f.raw;},()=>0,async c=>{codes.push(c);return 'saved';});
  assert.deepEqual(await read(f.scope,parent.signal),{kind:'unavailable'});assert.equal(calls,1);assert.equal(parent.signal.aborted,true);assert.equal(inner.aborted,true);assert.equal(getEventListeners(parent.signal,'abort').length,0);assert.deepEqual(codes,[]);
 });
 for(const mode of ['deadline','rollback','nonfinite','throw'])test(`${format} retirement keeps the original ${mode} clock boundary`,async()=>{
  const f=fixture(),parent=new AbortController(),codes=[];let retired=false;
  const clock=()=>{if(!retired)return 0;if(mode==='throw')throw Error('PRIVATE_RETIREMENT_CLOCK');return mode==='deadline'?3000:mode==='rollback'?-1:NaN;};
  const read=create(async(_c,s)=>{s.addEventListener('abort',()=>{retired=true;},{once:true});return f.raw;},clock,async c=>{codes.push(c);return 'saved';});
  assert.deepEqual(await read(f.scope,parent.signal),{kind:'unavailable'});assert.equal(retired,true);assert.equal(getEventListeners(parent.signal,'abort').length,0);assert.deepEqual(codes,['operator_audit_read']);
 });
 test(`${format} successful owned retirement does not cancel the checked caller observation`,async()=>{
  const f=fixture(),parent=new AbortController();let inner;
  const result=await create(async(_c,s)=>{inner=s;return f.raw;},()=>0,async()=>assert.fail('No diagnostic'))(f.scope,parent.signal);
  assert.equal(result.kind,'ok');assert.equal(inner.aborted,true);assert.equal(parent.signal.aborted,false);assert.equal(getEventListeners(parent.signal,'abort').length,0);
 });
}
