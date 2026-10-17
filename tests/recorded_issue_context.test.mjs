import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';
import {recordedIssuePreparationContext as parse} from '../src/server/recorded-issue-preparation-context.ts';
const records=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-issue-preparation-context.json',import.meta.url),'utf8')).cases;
test('two recorded modes retain exact native observations and their distinct baseline contracts',()=>{
 const [known,empty]=records(),a=parse(known),b=parse(empty);assert.equal(a.kind,'known_base');assert.equal(a.result.kind,'ok');assert.equal(b.kind,'empty_current_head');assert.equal(b.result.kind,'ok');assert.equal(a.result.context.trustedObservedAt,known.trustedObservedAt);assert.equal(b.result.context.trustedObservedAt,empty.trustedObservedAt);assert.equal(b.result.context.baselineJson,null);assert.ok(a.result.context.baselineJson);assert.equal(b.result.context.headComparison,'matched_absent_current_head');
});
test('explicit absent expectation and unpaired known baseline never become the same state',()=>{
 const [known,empty]=records();known.expected.head=null;const a=parse(known);assert.equal(a.result.context.headComparison,'not_supplied');empty.expected.head=null;assert.equal(parse(empty),null);known.mode='empty_current_head';assert.equal(parse(known),null);
});
test('crosswired modes bodies scopes and independent source expectations refuse complete admission',()=>{
 const [known,empty]=records();for(const edit of [r=>r.id='empty-head',r=>r.mode='empty_current_head',r=>r.rawEnvelopeJson=empty.rawEnvelopeJson,r=>r.expected.source.contentSha256='f'.repeat(64),r=>r.scope.issueId='00000000-0000-4000-8000-000000000999',r=>r.trustedObservedAt='2020-01-01T00:00:00.000000Z']){const r=structuredClone(known);edit(r);assert.equal(parse(r),null);}
});
test('no-match is preserved without treating missing or populated head as observed empty',()=>{
 for(const r of records()){const native=JSON.parse(r.rawEnvelopeJson);native.matches=[];r.rawEnvelopeJson=JSON.stringify(native);const out=parse(r);assert.equal(out.result.kind,'no_match');assert.ok(!Object.hasOwn(out.result,'context'));}
});
test('closed own record and scalar original byte quota refuse substitutes without new I/O or time',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));t.mock.method(Date,'now',()=>assert.fail('No fresh UTC'));
 for(const edit of [r=>r.extra='PRIVATE',r=>r.rawEnvelopeJson='PRIVATE\ud800',r=>r.rawEnvelopeJson=' '.repeat(65537),r=>r.rawEnvelopeJson=new Uint8Array(2),r=>r.rawEnvelopeJson='\ufeff'+r.rawEnvelopeJson,r=>Object.defineProperty(r,'rawEnvelopeJson',{enumerable:true,get(){throw Error('PRIVATE');}})]){const r=records()[0];edit(r);assert.equal(parse(r),null);}assert.equal(parse(Object.create(records()[0])),null);assert.equal(parse(records()[0]).result.kind,'ok');
});

test('recorded stage closed grammar refuses symbols and getter changes to earlier own fields',()=>{
 for(const mode of ['symbol','add','delete','hide']){const r=records()[0],key='trustedObservedAt',original=r[key];if(mode==='symbol')r[Symbol('PRIVATE_CANARY')]=true;else Object.defineProperty(r,key,{enumerable:true,configurable:true,get(){if(mode==='add')r.unexpected='PRIVATE_CANARY';if(mode==='delete')delete r['id'];if(mode==='hide')Object.defineProperty(r,'id',{enumerable:false});return original;}});assert.equal(parse(r),null,mode);}
});
test('recorded stage refuses late nested getters that mutate the already captured outer record',()=>{
 for(const mode of ['add','delete','hide']){const r=records()[0],nested=r.expected.source,key='locator',original=nested[key];Object.defineProperty(nested,key,{enumerable:true,configurable:true,get(){if(mode==='add')r.unexpected='PRIVATE_CANARY';if(mode==='delete')delete r['id'];if(mode==='hide')Object.defineProperty(r,'id',{enumerable:false});return original;}});assert.equal(parse(r),null,mode);}
});

test('nested context scope source expected and head keep a closed captured grammar',()=>{
 for(const path of ['scope','expected','source','head'])for(const mode of ['symbol','getter']){const r=records()[0],target=path==='source'?r.expected.source:path==='head'?r.expected.head:r[path],key=Object.keys(target).at(-1),original=target[key];if(mode==='symbol')target[Symbol('PRIVATE_CANARY')]=true;else Object.defineProperty(target,key,{enumerable:true,configurable:true,get(){target.unexpected='PRIVATE_CANARY';return original;}});assert.equal(parse(r),null,path+mode);}
});
