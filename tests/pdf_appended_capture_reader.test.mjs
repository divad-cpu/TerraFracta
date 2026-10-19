import assert from 'node:assert/strict';
import test from 'node:test';
import {getEventListeners} from 'node:events';
import {createPdfAppendedCaptureReader,readPdfAppendedCapture} from '../src/server/pdf-appended-capture-reader.ts';
import {preparePdfAppendedCaptureReadScope,PDF_APPENDED_CAPTURE_READ_SQL} from '../src/server/pdf-appended-issue-capture.ts';
import {recoverPdfAppendedCaptureForWork,preparePdfAppendedCaptureForWork} from '../src/server/pdf-appended-capture-work.ts';
import {pdfOwnerFixture as fixture,hash} from './helpers/pdf_owner_fixture.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const refused=fn=>assert.throws(fn,/^Error: pdf_appended_issue_capture_unavailable$/);

test('closed complete read scope is independently bound before any provider clock or diagnostic callback',async()=>{
 const f=fixture();assert.deepEqual(await readPdfAppendedCapture(f.scope),{kind:'unconfigured'});
 let callbacks=0;const unexpected=()=>{callbacks++;assert.fail('No callback');};
 const read=createPdfAppendedCaptureReader(unexpected,unexpected,unexpected);
 const bad=[null,[],{},Object.create(f.scope),{...f.scope,extra:true},{...f.scope,[Symbol('extra')]:true},{...f.scope,retainedIntentJson:'{}'},{...f.scope,observedAt:f.expected.observedAt.replace('2026-','0000-')},{...f.scope,observedAt:'2000-01-01T00:00:00.000000Z'}];
 for(const key of Object.keys(f.expected)){
  const missing={...f.expected};delete missing[key];bad.push({...f.scope,expected:missing});
  const changed={...f.expected,[key]:key.endsWith('Sha256')?'f'.repeat(64):key==='preparationIntentJson'?'{}':key==='preparationArtifactId'?'00000000-0000-4000-8000-000000000999':'2026-10-17T23:59:59.000000Z'};
  bad.push({...f.scope,expected:changed});
  const accessor={...f.expected};Object.defineProperty(accessor,key,{enumerable:true,get:unexpected});bad.push({...f.scope,expected:accessor});
 }
 for(const key of Object.keys(f.scope)){const accessor={...f.scope};Object.defineProperty(accessor,key,{enumerable:true,get:unexpected});bad.push(accessor);}
 bad.push(Object.defineProperty({...f.scope},'hidden',{value:true}));
 for(const input of bad)assert.deepEqual(await read(input),{kind:'invalid_scope'});
 assert.equal(callbacks,0);
});
test('read scope freezes all eight selectors and retains original historical observation without inferring content',()=>{
 const f=fixture(),checked=preparePdfAppendedCaptureReadScope(f.f.intentJson,f.expected,f.f.observedAt);
 assert.equal(checked.retainedIntentJson,f.f.intentJson);assert.deepEqual(checked.expected,f.expected);assert.equal(checked.observedAt,f.f.observedAt);
 assert.deepEqual(checked.command,{sql:PDF_APPENDED_CAPTURE_READ_SQL,values:[f.intent.capture_id]});
 assert.ok(Object.isFrozen(checked)&&Object.isFrozen(checked.expected)&&Object.isFrozen(checked.command.values));
 const copy=structuredClone(checked.expected);f.expected.preparationIntentJson='PRIVATE_MUTATION';assert.deepEqual(checked.expected,copy);
 refused(()=>preparePdfAppendedCaptureReadScope(f.f.intentJson,checked.expected,'2026-02-30T00:00:00.000000Z'));
});
test('fixed complete getter admits the original retained native six-part receipt under external selectors',async()=>{
 const f=fixture(),calls=[];const result=await createPdfAppendedCaptureReader(async(command,signal)=>{calls.push(command);assert.equal(signal.aborted,false);return f.raw;},()=>0,async()=>assert.fail('No diagnostic'))(f.scope);
 assert.equal(result.kind,'ok');assert.deepEqual(calls,[{sql:PDF_APPENDED_CAPTURE_READ_SQL,values:[f.intent.capture_id]}]);assert.equal(result.stored.receiptSha256,hash(f.raw));assert.deepEqual(result.stored.bundle,f.bundle);assert.deepEqual(result.stored.expected,f.expected);assert.equal(result.stored.observedAt,f.f.observedAt);
 assert.match(result.stored.evidenceState,/not_authenticated_current_qualification_or_publication/);
});
test('every corrupt part foreign receipt malformed encoding and byte overflow withholds the whole result',async()=>{
 const f=fixture(),bad=[null,f.raw.toString(),Buffer.alloc(131073),Buffer.from([255]),Buffer.concat([Buffer.from([239,187,191]),f.raw]),Buffer.from('{}')];
 for(let index=0;index<6;index++){const value=structuredClone(f.native);value.parts_base64[index]=Buffer.from('{}').toString('base64');bad.push(Buffer.from(JSON.stringify(value)));}
 const foreign=structuredClone(f.native);foreign.capture.captureId='00000000-0000-4000-8000-000000000999';bad.push(Buffer.from(JSON.stringify(foreign)));
 for(const raw of bad){const codes=[];assert.deepEqual(await createPdfAppendedCaptureReader(async()=>raw,()=>0,async c=>{codes.push(c);return 'saved';})(f.scope),{kind:'unavailable'});await tick();assert.deepEqual(codes,['operator_audit_read']);}
});
test('parent cancellation retires the read consumes late rejection and releases listener without diagnostics',async()=>{
 const f=fixture(),parent=new AbortController(),codes=[];let reject,inner;
 const pending=createPdfAppendedCaptureReader((_c,s)=>{inner=s;return new Promise((_r,j)=>{reject=j;});},()=>0,async c=>{codes.push(c);return 'saved';})(f.scope,parent.signal);
 await tick();assert.equal(getEventListeners(parent.signal,'abort').length,1);parent.abort();assert.deepEqual(await pending,{kind:'unavailable'});reject(Error('PRIVATE_LATE_FAILURE'));await tick();assert.equal(inner.aborted,true);assert.equal(getEventListeners(parent.signal,'abort').length,0);assert.deepEqual(codes,[]);
});
test('original interval rejects exact deadline backward nonfinite and throwing clock observations',async()=>{
 const f=fixture();for(const times of [[NaN],[0,3000],[0,-1],[0,0,1,0],[0,0,1,3000],[Infinity]]){let i=0;assert.deepEqual(await createPdfAppendedCaptureReader(async()=>f.raw,()=>times[Math.min(i++,times.length-1)],async()=> 'saved')(f.scope),{kind:'unavailable'});}
 assert.deepEqual(await createPdfAppendedCaptureReader(async()=>f.raw,()=>{throw Error('PRIVATE_CLOCK');},async()=> 'saved')(f.scope),{kind:'unavailable'});
});
test('all independent selectors are captured before asynchronous provider and injected clock mutations',async()=>{
 const f=fixture(),scope=structuredClone(f.scope),before=structuredClone(scope);let release;
 const pending=createPdfAppendedCaptureReader(()=>new Promise(r=>{release=r;}),()=>{scope.expected.preparationArtifactId='PRIVATE_CHANGED';return 0;},async()=> 'saved')(scope);await tick();scope.retainedIntentJson='PRIVATE_CHANGED';scope.observedAt='2099-01-01T00:00:00.000000Z';release(f.raw);
 const result=await pending;f.raw.fill(0);assert.equal(result.kind,'ok');assert.equal(result.stored.intentJson,before.retainedIntentJson);assert.deepEqual(result.stored.expected,before.expected);assert.equal(result.stored.observedAt,before.observedAt);assert.deepEqual(result.stored.bundle,f.bundle);
});
test('preabort never invokes provider clock or recorder and recorder failure cannot replace refusal',async()=>{
 const f=fixture(),parent=new AbortController();parent.abort();const no=()=>assert.fail('No callbacks');assert.deepEqual(await createPdfAppendedCaptureReader(no,no,no)(f.scope,parent.signal),{kind:'unavailable'});
 let codes=0;assert.deepEqual(await createPdfAppendedCaptureReader(async()=>{throw Error('PRIVATE_BACKEND');},()=>0,async()=>{codes++;throw Error('PRIVATE_LOG');})(f.scope),{kind:'unavailable'});await tick();assert.equal(codes,1);
});
test('explicit pure recovery retains complete historical bytes under new current work with externally retained e8',()=>{
 const f=fixture(),work={...f.work,workClaimId:'00000000-0000-4000-8000-000000000996'},prepared=recoverPdfAppendedCaptureForWork(work,f.raw,f.f.intentJson,f.expected,f.f.observedAt),direct=preparePdfAppendedCaptureForWork(work,f.bundle,f.expected);
 assert.deepEqual(prepared,direct);assert.equal(prepared.intentJson,f.f.intentJson);assert.equal(prepared.values.length,10);assert.equal(prepared.work.workClaimId,work.workClaimId);
 for(const key of Object.keys(f.expected)){const e={...f.expected};delete e[key];assert.throws(()=>recoverPdfAppendedCaptureForWork(work,f.raw,f.f.intentJson,e,f.f.observedAt),/^Error: pdf_appended_capture_work_unavailable$/);}
 const before={...work};let calls=0;const expected=new Proxy(f.expected,{getOwnPropertyDescriptor(target,key){calls++;work.workClaimId='PRIVATE_CHANGED';return Reflect.getOwnPropertyDescriptor(target,key);}});
 assert.deepEqual(recoverPdfAppendedCaptureForWork(before,f.raw,f.f.intentJson,expected,f.f.observedAt).work,before);assert.ok(calls>0);
 const input={...f.work};const mutated=new Proxy(f.expected,{getOwnPropertyDescriptor(target,key){input.workClaimId='PRIVATE_CHANGED';return Reflect.getOwnPropertyDescriptor(target,key);}});assert.deepEqual(recoverPdfAppendedCaptureForWork(input,f.raw,f.f.intentJson,mutated,f.f.observedAt).work,f.work);
});

test('parent cancellation from inner retirement cannot deliver an already parsed candidate',async()=>{
 const f=fixture(),parent=new AbortController(),codes=[];
 const read=createPdfAppendedCaptureReader(async(_command,inner)=>{inner.addEventListener('abort',()=>parent.abort(),{once:true});return f.raw;},()=>0,async code=>{codes.push(code);return 'saved';});
 assert.deepEqual(await read(f.scope,parent.signal),{kind:'unavailable'});assert.equal(parent.signal.aborted,true);await tick();assert.deepEqual(codes,[]);
});
test('retirement clock expiry or cleanup failure withholds candidate and attempts remaining cleanup',async t=>{
 const f=fixture();let now=0,aborts=0;
 const read=createPdfAppendedCaptureReader(async(_command,inner)=>{inner.addEventListener('abort',()=>{now=3000;aborts++;},{once:true});return f.raw;},()=>now,async()=> 'saved');
 assert.deepEqual(await read(f.scope),{kind:'unavailable'});assert.equal(aborts,1);
 for(const method of ['clearTimeout','removeEventListener']){
  let retired=false;const codes=[],parent=new AbortController();
  const factory=createPdfAppendedCaptureReader(async(_command,inner)=>{inner.addEventListener('abort',()=>{retired=true;},{once:true});return f.raw;},()=>0,async code=>{codes.push(code);return 'saved';});
  const original=method==='clearTimeout'?globalThis.clearTimeout:parent.signal.removeEventListener;
  const target=method==='clearTimeout'?globalThis:parent.signal;
  const mock=t.mock.method(target,method,function(...args){Reflect.apply(original,this,args);throw Error('PRIVATE_RETIREMENT');});
  try{assert.deepEqual(await factory(f.scope,parent.signal),{kind:'unavailable'});assert.equal(retired,true);await tick();assert.deepEqual(codes,['operator_audit_read']);}finally{mock.mock.restore();}
 }
});
