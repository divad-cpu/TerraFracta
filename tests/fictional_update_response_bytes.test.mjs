import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {requestFictionalUpdate,FictionalUpdateRequestError} from '../src/fictional-update-request.ts';
const report=JSON.parse(readFileSync(new URL('../fixtures/fictional_update_report.json',import.meta.url),'utf8'));
const receipt=()=>({execution:{id:'11111111-1111-4111-8111-111111111111',kind:'local_fictional',scenario:'standard',executedAt:'2026-10-02T14:00:00Z',durationMs:1},report:structuredClone(report)});
const raw=value=>new TextEncoder().encode(JSON.stringify(value));
const unavailable=e=>e instanceof FictionalUpdateRequestError&&e.reason==='unconfirmed'&&!e.message.includes('PRIVATE_');
for(const mode of ['overflow','declared-overflow','invalid-utf8','zero-progress'])test(`fictional response holds ${mode} before accepting a result`,async t=>{
 let calls=0,cancellations=0;const value=receipt();
 if(mode==='invalid-utf8'){value.report.items[0].source.title='X';value.report.fictionalCandidate.publication.snapshot.claims[0].evidence[0].title='X';}
 let bytes=raw(value);
 if(mode==='overflow')bytes=new TextEncoder().encode(JSON.stringify(value)+' '.repeat(65537));
 if(mode==='invalid-utf8'){const marker=Buffer.from('"title":"X"');let start=-1,count=0;while((start=Buffer.from(bytes).indexOf(marker,start+1))>=0){bytes[start+9]=255;count++;}assert.equal(count,2);}
 const body=new ReadableStream({start(c){if(mode==='zero-progress')c.enqueue(new Uint8Array());c.enqueue(bytes);c.close();},cancel(){cancellations++;}}),response=new Response(body,{headers:mode==='declared-overflow'?{'content-length':'65537'}:{}});
 t.mock.method(globalThis,'fetch',async()=>{calls++;return response;});
 await assert.rejects(requestFictionalUpdate('scheduled','standard',new AbortController().signal),unavailable);
 assert.equal(calls,1);assert.equal(body.locked,false);if(mode==='declared-overflow')assert.equal(cancellations,1);
});
for(const status of [503,429,500])test(`fictional ${status} refusal does not retain an unread response`,async t=>{
 let cancelled=0,calls=0;const body=new ReadableStream({start(c){if(status===503){c.enqueue(new TextEncoder().encode('{"error":"fictional_archive_full"}'+' '.repeat(1025)));c.close();}},cancel(){cancelled++;}}),response=new Response(body,{status,headers:{'content-length':'1025'}});
 t.mock.method(globalThis,'fetch',async()=>{calls++;return response;});
 await assert.rejects(requestFictionalUpdate('scheduled','standard',new AbortController().signal),e=>e instanceof FictionalUpdateRequestError&&e.reason===(status===429?'busy':'unconfirmed'));
 assert.equal(calls,1);if(status!==503)assert.equal(cancelled,1);assert.equal(body.locked,false);
});
test('exact fictional receipt byte ceiling and split UTF8 preserve its checked output',async t=>{
 const value=receipt();value.report.items[0].source.title='é';value.report.fictionalCandidate.publication.snapshot.claims[0].evidence[0].title='é';const bytes=raw(value),padding=new Uint8Array(65536-bytes.length).fill(32);
 const body=new ReadableStream({start(c){for(const part of [bytes.subarray(0,30),bytes.subarray(30),padding])c.enqueue(part);c.close();}});
 t.mock.method(globalThis,'fetch',async()=>new Response(body));
 assert.deepEqual(await requestFictionalUpdate('scheduled','standard',new AbortController().signal),value);assert.equal(body.locked,false);
});
