import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import { handleConnectedReaderStatus } from '../src/server/connected-reader-status.ts';
import { connectedInput, suppressionInput } from './helpers/connected_reader_fixture.mjs';
import { connectedStatusPayload } from '../src/connected-reader-status.ts';

const turn=()=>new Promise(done=>setImmediate(done));
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const request=(signal,edition='1')=>new Request('http://127.0.0.1:3100/api/dev/connected-reader',{
 headers:{'sec-fetch-site':'same-origin','x-terrafracta-edition':edition},signal});
const current=()=>({kind:'snapshot',snapshot:{...connectedInput(),generation:1}});
async function cancelled(response){assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'request_cancelled'});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');}

test('preabort and cancellation before queued dispatch invoke no connected store read',async()=>{
 for(const before of [true,false]){
  const parent=new AbortController();if(before)parent.abort();const req=request(parent.signal);
  const pending=handleConnectedReaderStatus(req,'development',()=>assert.fail('cancelled store dispatch'));if(!before)parent.abort();
  await cancelled(await pending);assert.equal(getEventListeners(req.signal,'abort').length,0);
 }
});

test('midflight cancellation returns promptly and safely consumes late success/failure',async()=>{
 for(const late of ['success','failure']){
  const wait=deferred(),parent=new AbortController(),req=request(parent.signal);let settled=false,calls=0;
  const pending=handleConnectedReaderStatus(req,'development',async edition=>{calls++;assert.equal(edition,1);return wait.promise;}).then(value=>{settled=true;return value;});
  await turn();parent.abort();await turn();assert.equal(settled,true);assert.equal(calls,1);await cancelled(await pending);assert.equal(getEventListeners(req.signal,'abort').length,0);
  if(late==='success')wait.resolve(current());else wait.reject(Error('PRIVATE_RETIRED_READER_CANARY'));await turn();
 }
});

test('one cancelled request cannot retire a different active edition read or coalesce editions',async()=>{
 const waits=[deferred(),deferred()],calls=[],parent=new AbortController(),req=request(parent.signal);
 const read=async edition=>{calls.push(edition);return waits[calls.length-1].promise;};
 const a=handleConnectedReaderStatus(req,'development',read),b=handleConnectedReaderStatus(request(undefined,'2'),'development',read);
 await turn();assert.deepEqual(calls,[1,2]);parent.abort();await cancelled(await a);
 waits[1].resolve({kind:'changed',currentGeneration:3});const active=await b;assert.equal(active.status,200);assert.deepEqual(await active.json(),{schemaVersion:1,kind:'changed',currentGeneration:3});
 waits[0].reject(Error('PRIVATE_CANCELLED_PEER_CANARY'));await turn();
});

test('abort wins settlement and response-construction races with complete listener cleanup',async()=>{
 for(const failure of [true,false]){
  const parent=new AbortController(),req=request(parent.signal);
  const response=await handleConnectedReaderStatus(req,'development',async()=>{parent.abort();if(failure)throw Error('PRIVATE_SETTLEMENT_CANARY');return current();});
  await cancelled(response);assert.equal(getEventListeners(req.signal,'abort').length,0);
 }
 const parent=new AbortController(),req=request(parent.signal),value=current();
 Object.defineProperty(value.snapshot,'executionId',{get(){parent.abort();return '00000000-0000-4000-8000-000000000001';}});
 await cancelled(await handleConnectedReaderStatus(req,'development',async()=>value));assert.equal(getEventListeners(req.signal,'abort').length,0);
});

test('active current/suppressed/changed/empty/unavailable/error responses and admission guards stay unchanged',async()=>{
 for(const outcome of [current(),{kind:'snapshot',snapshot:{...suppressionInput(),generation:1}},{kind:'changed',currentGeneration:2},{kind:'empty'},{kind:'unavailable'}]){
  const req=request(),response=await handleConnectedReaderStatus(req,'development',async()=>outcome),payload=connectedStatusPayload(outcome);
  assert.equal(response.status,payload.kind==='unavailable'?503:200);assert.deepEqual(await response.json(),payload);assert.equal(getEventListeners(req.signal,'abort').length,0);
 }
 const req=request(),response=await handleConnectedReaderStatus(req,'development',async()=>{throw Error('PRIVATE_ACTIVE_CANARY');});assert.equal(response.status,503);assert.deepEqual(await response.json(),{schemaVersion:1,kind:'unavailable'});assert.equal(getEventListeners(req.signal,'abort').length,0);
 for(const invalid of [null,undefined]){
  const req=request(),response=await handleConnectedReaderStatus(req,'development',async()=>invalid);
  assert.equal(req.signal.aborted,false);assert.equal(response.status,503);assert.deepEqual(await response.json(),{schemaVersion:1,kind:'unavailable'});assert.equal(getEventListeners(req.signal,'abort').length,0);
 }
 const unused=()=>assert.fail('inadmissible read');assert.equal((await handleConnectedReaderStatus(new Proxy({}, {get(){assert.fail('production request accessed');}}),'production',unused)).status,404);
 const parent=new AbortController();parent.abort();assert.equal((await handleConnectedReaderStatus(new Request(request(parent.signal),{method:'POST'}),'development',unused)).status,405);
});
