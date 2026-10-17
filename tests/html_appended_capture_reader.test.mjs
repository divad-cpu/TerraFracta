import assert from 'node:assert/strict';import test from 'node:test';
import {getEventListeners} from 'node:events';
import {createHtmlAppendedCaptureReader,readHtmlAppendedCapture} from '../src/server/html-appended-capture-reader.ts';
import {HTML_APPENDED_CAPTURE_READ_SQL} from '../src/server/html-appended-issue-capture.ts';
import {htmlCaptureFixture as fixture,hash} from './helpers/html_capture_transport_fixture.mjs';
const scope=f=>({retainedIntentJson:f.f.retainedIntentJson,observedAt:f.f.observedAt});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('HTML historical reader stays unconfigured and requires exact own independent scope before dispatch',async()=>{
 const f=fixture();assert.deepEqual(await readHtmlAppendedCapture(scope(f)),{kind:'unconfigured'});
 let calls=0;const read=createHtmlAppendedCaptureReader(()=>{calls++;assert.fail('No dispatch');},()=>{calls++;assert.fail('No clock');});
 for(const input of [null,{},Object.create(scope(f)),{...scope(f),extra:true},{...scope(f),retainedIntentJson:'{}'},{...scope(f),observedAt:'0000-01-01T00:00:00.000000Z'},{...scope(f),[Symbol('extra')]:true}])assert.deepEqual(await read(input),{kind:'invalid_scope'});
 const mutating=scope(f);Object.defineProperty(mutating,'retainedIntentJson',{enumerable:true,get(){mutating.extra=true;return f.f.retainedIntentJson;}});assert.deepEqual(await read(mutating),{kind:'invalid_scope'});assert.equal(calls,0);
});
test('one fixed HTML getter admits all six exact parts under the retained independent observation',async()=>{
 const f=fixture(),calls=[];const result=await createHtmlAppendedCaptureReader(async(command,signal)=>{calls.push(command);assert.ok(signal instanceof AbortSignal);return f.raw;},()=>0,async()=>assert.fail('No diagnostic'))(scope(f));
 assert.equal(result.kind,'ok');assert.deepEqual(calls,[{sql:HTML_APPENDED_CAPTURE_READ_SQL,values:[f.intent.capture_id]}]);assert.equal(result.stored.receiptSha256,hash(f.raw));assert.deepEqual(result.stored.bundle,f.bundle);assert.equal(result.stored.observedAt,f.f.observedAt);assert.match(result.stored.evidenceState,/not_current_qualification_or_publication/);
});
test('HTML reader refuses plain receipts foreign intent corrupt parts and malformed bytes without exposing partial contents',async()=>{
 const f=fixture(),bad=structuredClone(f.native);bad.parts_base64[5]=Buffer.from('{}').toString('base64');
 for(const raw of [null,f.raw.toString(),Buffer.alloc(131073),Buffer.from([255]),Buffer.concat([Buffer.from([239,187,191]),f.raw]),Buffer.from(JSON.stringify(bad)),Buffer.from('{}')]){
  const codes=[];const result=await createHtmlAppendedCaptureReader(async()=>raw,()=>0,async c=>{codes.push(c);return 'saved';})(scope(f));assert.deepEqual(result,{kind:'unavailable'});await tick();assert.deepEqual(codes,['operator_audit_read']);
 }
});
test('parent cancellation retires logical read and consumes late provider failure with no diagnostics',async()=>{
 const f=fixture(),parent=new AbortController(),codes=[];let reject,inner;
 const pending=createHtmlAppendedCaptureReader((_c,s)=>{inner=s;return new Promise((_r,j)=>{reject=j;});},()=>0,async c=>{codes.push(c);return 'saved';})(scope(f),parent.signal);
 await tick();assert.equal(getEventListeners(parent.signal,'abort').length,1);parent.abort();assert.deepEqual(await pending,{kind:'unavailable'});reject(Error('INVENTED_LATE_FAILURE'));await tick();assert.equal(inner.aborted,true);assert.equal(getEventListeners(parent.signal,'abort').length,0);assert.deepEqual(codes,[]);
});
test('HTML read keeps one original monotonic interval including exact deadline and backward time refusal',async()=>{
 const f=fixture();for(const times of [[NaN],[0,3000],[0,-1],[0,0,1,0],[0,0,1,3000]]){let i=0;const now=()=>times[Math.min(i++,times.length-1)];assert.deepEqual(await createHtmlAppendedCaptureReader(async()=>f.raw,now,async()=> 'saved')(scope(f)),{kind:'unavailable'});}
});
test('HTML reader captures selectors once before async provider and retains owned receipt bytes',async()=>{
 const f=fixture(),input=scope(f);let getters=0,release;Object.defineProperty(input,'retainedIntentJson',{enumerable:true,configurable:true,get(){getters++;return f.f.retainedIntentJson;}});
 const pending=createHtmlAppendedCaptureReader(()=>new Promise(r=>{release=r;}),()=>0,async()=> 'saved')(input);await tick();input.observedAt='2099-01-01T00:00:00.000000Z';release(f.raw);const result=await pending;f.raw.fill(0);assert.equal(result.kind,'ok');assert.equal(result.stored.observedAt,f.f.observedAt);assert.equal(getters,1);assert.equal(result.stored.bundle.compositionJson,f.bundle.compositionJson);
});
