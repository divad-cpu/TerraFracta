import assert from 'node:assert/strict';import test from 'node:test';
import {parseRecordedCaptureQuery as parse,recordedCaptureHref as href} from '../src/recorded-capture-navigation.ts';
const preparation='2838c9f5-1ad9-483a-8fde-fa770157e0e6',capture='8e5d2d6a-802e-41f6-b8b3-524b756dba86';
test('no query never supplies an implicit preparation or capture',()=>{assert.deepEqual(parse({}),{kind:'none'});assert.deepEqual(parse({preparation}),{kind:'selected',preparationId:preparation,captureId:null});});
test('exact two selectors roundtrip through native query strings and preserve preparation return',()=>{
 const path=href(preparation,capture);assert.equal(path,`/editorial-preview/capture-history?preparation=${preparation}&capture=${capture}`);assert.deepEqual(parse(Object.fromEntries(new URL(path,'http://local.invalid').searchParams)),{kind:'selected',preparationId:preparation,captureId:capture});assert.equal(href(preparation),`/editorial-preview/capture-history?preparation=${preparation}`);
});
test('duplicate arrays, orphan capture, malformed UUID and unknown keys cannot broaden or replace scope',()=>{
 for(const q of [null,[],{capture},{preparation:[preparation,preparation]},{preparation,capture:[capture]},{preparation:'PRIVATE_CANARY'},{preparation,extra:'PRIVATE_CANARY'},{preparation:undefined},{preparation,capture:undefined},{preparation:preparation.toUpperCase()}])assert.deepEqual(parse(q),{kind:'invalid'});
});
test('own selectors are captured once; inherited hidden or throwing values never select a record',()=>{
 assert.deepEqual(parse(Object.create({preparation})),{kind:'none'});assert.deepEqual(parse(Object.defineProperty({},'preparation',{value:preparation})),{kind:'none'});
 let calls=0;const q=Object.defineProperty({},'preparation',{enumerable:true,get(){calls++;return preparation;}});assert.equal(parse(q).kind,'selected');assert.equal(calls,1);
 assert.deepEqual(parse(Object.defineProperty({},'preparation',{enumerable:true,get(){throw Error('PRIVATE');}})),{kind:'invalid'});
});
test('framework control errors remain control flow and invalid links never echo input',()=>{
 const marker=Error('FRAMEWORK');const q=Object.defineProperty({},'preparation',{enumerable:true,get(){throw marker;}});assert.throws(()=>parse(q,e=>{throw e;}),e=>e===marker);assert.throws(()=>href('PRIVATE_CANARY'),/^Error: recorded_capture_selection_unavailable$/);assert.throws(()=>href(preparation,'PRIVATE_CANARY'),/^Error: recorded_capture_selection_unavailable$/);
});
