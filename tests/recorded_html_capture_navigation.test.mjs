import assert from 'node:assert/strict';import test from 'node:test';
import {parseHtmlRecordedCaptureQuery as parse,htmlRecordedCaptureHref as href} from '../src/html-recorded-capture-navigation.ts';
const preparation='a1000000-0000-4000-8000-000000000001',capture='90000000-0000-4000-8000-000000000004';
test('HTML navigation requires two explicit stages and reuses encoded exact selectors',()=>{
 assert.deepEqual(parse({}),{kind:'none'});assert.deepEqual(parse({preparation}),{kind:'selected',preparationId:preparation,captureId:null});assert.deepEqual(parse({preparation,capture}),{kind:'selected',preparationId:preparation,captureId:capture});
 assert.equal(href(preparation),'/editorial-preview/html-capture-history?preparation='+preparation);assert.equal(href(preparation,capture),'/editorial-preview/html-capture-history?preparation='+preparation+'&capture='+capture);assert.throws(()=>href('invented invalid'));
});
test('hidden symbol inherited array repeated and getter selectors are refused without evaluating accessors',()=>{
 let reads=0;const getter={preparation};Object.defineProperty(getter,'capture',{enumerable:true,get(){reads++;return capture;}});const hidden={};Object.defineProperty(hidden,'preparation',{value:preparation});
 for(const v of [null,[],{capture},{preparation:[preparation]},{preparation,capture:[capture,capture]},{preparation,extra:true},hidden,getter,{[Symbol('extra')]:true},Object.assign(Object.create({extra:true}),{preparation})])assert.deepEqual(parse(v),{kind:'invalid'});assert.equal(reads,0);
});
test('framework control supplied by caller propagates while ordinary proxy errors become invalid',()=>{
 const control=Error('FRAMEWORK'),v=new Proxy({},{getPrototypeOf(){throw control;}});assert.deepEqual(parse(v),{kind:'invalid'});assert.throws(()=>parse(v,e=>{if(e===control)throw e;}),e=>e===control);
});
