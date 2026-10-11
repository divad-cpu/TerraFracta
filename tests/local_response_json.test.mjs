import assert from 'node:assert/strict';
import test from 'node:test';
import {readLocalResponseJson,discardLocalResponse,localResponseBytes} from '../src/local-response-json.ts';
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
const signal=()=>new AbortController().signal;
const unavailable=e=>e.message==='Local response unavailable';

test('all fixed local byte ceilings admit exact bytes and refuse observed overflow',async()=>{
 for(const limit of [1024,16384,65536,8*65536+1024]) {
  const value={label:'é'},raw=encode(value);
  for(const extra of [0,1]) {
   const body=new ReadableStream({start(c){c.enqueue(raw.subarray(0,raw.length-3));c.enqueue(raw.subarray(raw.length-3));c.enqueue(new Uint8Array(limit-raw.length+extra).fill(32));c.close();}});
   const result=readLocalResponseJson(new Response(body),signal(),limit);
   if(extra)await assert.rejects(result,unavailable);else assert.deepEqual(await result,value);
   assert.equal(body.locked,false);
  }
 }
});
test('declared refusal cancels before a reader is acquired, independently of cancellation acknowledgement',async()=>{
 for(const declared of ['invalid','-1','1.5','1025'])for(const acknowledgement of ['pending','rejected']) {
  let cancelled=0,readers=0;const body=new ReadableStream({start(){},cancel(){cancelled++;return acknowledgement==='pending'?new Promise(()=>{}):Promise.reject(Error('PRIVATE_CANCEL'));}}),native=body.getReader.bind(body);
  body.getReader=(...args)=>{readers++;return native(...args);};
  await assert.rejects(readLocalResponseJson(new Response(body,{headers:{'content-length':declared}}),signal(),1024),unavailable);
  assert.equal(cancelled,1);assert.equal(readers,0);assert.equal(body.locked,false);
 }
});
for(const acknowledgement of ['pending','rejected'])test(`owned cancellation releases a pending native reader with ${acknowledgement} producer acknowledgement`,async()=>{
 let cancelled=0;const outer=new AbortController(),body=new ReadableStream({start(){},cancel(){cancelled++;return acknowledgement==='pending'?new Promise(()=>{}):Promise.reject(Error('PRIVATE_CANCEL'));}});
 const pending=readLocalResponseJson(new Response(body),outer.signal,1024);await Promise.resolve();assert.equal(body.locked,true);outer.abort();await assert.rejects(pending,unavailable);assert.equal(cancelled,1);assert.equal(body.locked,false);
});
test('native chunks are copied before the producer changes an earlier buffer at a later pull',async()=>{
 const raw=encode({value:'before'});let pulls=0;
 const body=new ReadableStream({pull(c){if(pulls++===0)c.enqueue(raw);else{raw.fill(32);c.close();}}},{highWaterMark:0});
 assert.deepEqual(await readLocalResponseJson(new Response(body),signal(),1024),{value:'before'});assert.equal(pulls,2);assert.equal(body.locked,false);
});
test('split multibyte JSON remains literal and malformed UTF8 is never repaired',async()=>{
 const raw=encode({value:'é🙂'}),body=new ReadableStream({start(c){for(const byte of raw)c.enqueue(new Uint8Array([byte]));c.close();}});
 assert.deepEqual(await readLocalResponseJson(new Response(body),signal(),1024),{value:'é🙂'});assert.equal(body.locked,false);
 for(const bytes of [new Uint8Array([123,34,120,34,58,34,255,34,125]),new Uint8Array([0xc3,0x28])]) {
  const response=new Response(bytes);await assert.rejects(readLocalResponseJson(response,signal(),1024),unavailable);assert.equal(response.body.locked,false);
 }
});
test('locked caller-owned native body is neither cancelled nor released',async()=>{
 let cancelled=0;const body=new ReadableStream({start(){},cancel(){cancelled++;}}),response=new Response(body),reader=body.getReader();
 await assert.rejects(readLocalResponseJson(response,signal(),1024),unavailable);assert.equal(body.locked,true);assert.equal(cancelled,0);discardLocalResponse(response);assert.equal(cancelled,0);
 await reader.cancel();reader.releaseLock();assert.equal(cancelled,1);assert.equal(body.locked,false);
});
test('listener setup refusal still cancels and releases the acquired native body',async()=>{
 let cancelled=0;const outer=new AbortController(),add=outer.signal.addEventListener.bind(outer.signal),body=new ReadableStream({start(){},cancel(){cancelled++;}});
 outer.signal.addEventListener=(...args)=>{add(...args);throw Error('PRIVATE_SUBSCRIBE');};
 await assert.rejects(readLocalResponseJson(new Response(body),outer.signal,1024),unavailable);assert.equal(cancelled,1);assert.equal(body.locked,false);
});
test('checked output survives independent listener, cancellation and release retirement errors',async()=>{
 for(const phase of ['remove','cancel','release']) {
  const outer=new AbortController(),body=new ReadableStream({start(c){c.enqueue(encode({checked:true}));c.close();}}),native=body.getReader.bind(body);let released=0;
  if(phase==='remove'){const remove=outer.signal.removeEventListener.bind(outer.signal);outer.signal.removeEventListener=(...args)=>{remove(...args);throw Error('PRIVATE_REMOVE');};}
  body.getReader=(...args)=>{const reader=native(...args),release=reader.releaseLock.bind(reader);reader.releaseLock=()=>{released++;release();if(phase==='release')throw Error('PRIVATE_RELEASE');};if(phase==='cancel')reader.cancel=()=>{throw Error('PRIVATE_CANCEL');};return reader;};
  assert.deepEqual(await readLocalResponseJson(new Response(body),outer.signal,1024),{checked:true});assert.equal(released,1);assert.equal(body.locked,false);
 }
});
test('malformed JSON and unproductive or non-byte chunks stay generic and retire the native lock',async()=>{
 for(const value of [new TextEncoder().encode('{PRIVATE_CANARY'),new Uint8Array(),'{"checked":true}']) {
  let cancelled=0;const body=new ReadableStream({start(c){c.enqueue(value);},cancel(){cancelled++;}});
  if(value instanceof Uint8Array&&value.length>0){const response=new Response(value);await assert.rejects(readLocalResponseJson(response,signal(),1024),unavailable);assert.equal(response.body.locked,false);}
  else {await assert.rejects(readLocalResponseJson(new Response(body),signal(),1024),unavailable);assert.equal(cancelled,1);assert.equal(body.locked,false);}
 }
});
test('aborted or invalid-budget refusals cancel unread native bodies without dispatching a reader',async()=>{
 for(const limit of [0,-1,0.5,NaN,Infinity,localResponseBytes.history+1]) {
  let cancelled=0;const body=new ReadableStream({start(){},cancel(){cancelled++;}});await assert.rejects(readLocalResponseJson(new Response(body),signal(),limit),unavailable);assert.equal(cancelled,1);assert.equal(body.locked,false);
 }
 let cancelled=0;const outer=new AbortController();outer.abort();const body=new ReadableStream({start(){},cancel(){cancelled++;}});await assert.rejects(readLocalResponseJson(new Response(body),outer.signal,1024),unavailable);assert.equal(cancelled,1);assert.equal(body.locked,false);
});
test('an in-bound declared length does not replace the delivered-byte ceiling',async()=>{
 const response=new Response(' '.repeat(1025),{headers:{'content-length':'2'}});await assert.rejects(readLocalResponseJson(response,signal(),1024),unavailable);assert.equal(response.body.locked,false);
});
