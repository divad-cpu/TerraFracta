import assert from 'node:assert/strict';
import test from 'node:test';
import {createSelectedPdfInitialCandidateCaptureReader as initial} from '../src/server/pdf-initial-candidate-capture-selection.ts';
import {createSelectedPdfAppendedCaptureReader as appended} from '../src/server/pdf-appended-capture-selection.ts';
import {initialPdfLookupFixture} from './helpers/pdf_initial_selection_fixture.mjs';
import {pdfLookupFixture} from './helpers/pdf_owner_fixture.mjs';
for(const [name,create,fixture]of[['initial',initial,initialPdfLookupFixture],['appended',appended,pdfLookupFixture]]){
 test(name+' PDF physical timeout uses the original remaining interval after selector callbacks',async t=>{
  const f=fixture();let clock=0,reads=0;const delays=[],original=setTimeout;
  t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>{delays.push(delay);return original(fn,delay,...args);});
  const input=new Proxy(f.selection,{getOwnPropertyDescriptor(target,key){clock=750;return Reflect.getOwnPropertyDescriptor(target,key);}});
  const result=await create(async()=>{reads++;return f.raw;},()=>clock,async()=>assert.fail('No diagnostic'))(input);
  assert.equal(result.kind,'ok');assert.equal(reads,1);assert.deepEqual(delays,[2250]);
 });
}
