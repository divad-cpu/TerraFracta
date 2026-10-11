import assert from 'node:assert/strict';
import test from 'node:test';
import {requestPrivateCustodianStatus} from '../src/private-custodian-request.ts';
for(const method of ['GET','POST'])for(const mode of ['overflow','declared-overflow','zero-progress'])test(`private ${method} response holds ${mode} with one fixed request`,async t=>{
 let calls=0,cancelled=0;const bytes=new TextEncoder().encode('{"state":"idle"}'+(mode==='overflow'?' '.repeat(16385):''));
 const body=new ReadableStream({start(c){if(mode==='zero-progress')c.enqueue(new Uint8Array());c.enqueue(bytes);c.close();},cancel(){cancelled++;}}),response=new Response(body,{headers:mode==='declared-overflow'?{'content-length':'16385'}:{}});
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;assert.equal(url,'/api/dev/private-custodian');assert.equal(options.method,method);return response;});
 await assert.rejects(requestPrivateCustodianStatus(method,new AbortController().signal));assert.equal(calls,1);assert.equal(body.locked,false);if(mode==='declared-overflow')assert.equal(cancelled,1);
});
test('exact private status byte ceiling remains available',async t=>{
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"state":"idle"}'));c.enqueue(new Uint8Array(16384-16).fill(32));c.close();}});
 t.mock.method(globalThis,'fetch',async()=>new Response(body));assert.deepEqual(await requestPrivateCustodianStatus('GET',new AbortController().signal),{state:'idle'});assert.equal(body.locked,false);
});
