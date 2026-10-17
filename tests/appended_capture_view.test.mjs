import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-capture.json',import.meta.url),'utf8'));
const {AppendedCaptureView:View}=loadTsx(new URL('../src/appended-capture-view.tsx',import.meta.url));
const props=f=>({raw:Buffer.from(f.rawReceiptJson),retainedIntentJson:f.retainedIntentJson,observedAt:f.observedAt,actualReport:f.actualComparison});
const render=p=>renderToStaticMarkup(View(p));
test('actual invented stored pair displays complete preserved comparison original passages and separate historical times without actions',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));const f=fixture(),html=render(props(f));
 for(const phrase of ['Saved whole-issue composition comparison','2 preserved statements; 1 added candidate; 0 rewritten; 0 removed','All 2 preserved statements','Saved added candidate 3','Whole-page wording','Earlier supplied document','Current supplied document','Opening the page does not renew','recorded together','No editorial action is available','not independent confirmation'])assert.ok(html.includes(phrase),phrase);
 const native=JSON.parse(f.rawReceiptJson);for(const instant of [native.capture.capturedAt,native.stored_at,f.actualComparison.observedAt,f.observedAt])assert.ok(html.includes(instant),instant);
 assert.ok(html.includes(f.receiptSha256));assert.doesNotMatch(html,/<form|<button|<input|<script|href="(?!#)/);
 const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);for(const match of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(match[1]),match[1]);
});
test('changed absent malformed or mismatched separate comparison holds all baseline candidate passage and identity details',()=>{
 const f=fixture(),base=props(f);const changed=structuredClone(f.actualComparison);changed.capture.proposalSha256='0'.repeat(64);
 for(const actualReport of [null,{},changed,{status:'changed'}]){const html=render({...base,actualReport});assert.match(html,/Saved composition comparison unavailable/);assert.doesNotMatch(html,/Saved added candidate|Whole-page wording|Exact saved association identity|Preserved statement|Original exact|Changed exact/);}
 const old=structuredClone(f.actualComparison);old.observedAt='2025-10-15T00:00:00.000000Z';assert.match(render({...base,actualReport:old}),/unavailable/);
});
test('invalid full custody withholds supplied markup and never falls back to the otherwise valid comparison',()=>{
 const f=fixture(),p=props(f);for(const bad of [Buffer.from('<script>PRIVATE_CANARY</script>'),Buffer.from('{}'),Buffer.alloc(131073)]){const html=render({...p,raw:bad});assert.match(html,/unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY|<script|Saved added candidate|Whole-page wording/);}
 const i=JSON.parse(f.retainedIntentJson);i.capture_id='00000000-0000-4000-8000-000000000994';assert.match(render({...p,retainedIntentJson:JSON.stringify(i)}),/unavailable/);
 const actualReport=new Proxy({}, {get(){throw Error('PRIVATE_CANARY');}});assert.doesNotMatch(render({...p,actualReport}),/PRIVATE_CANARY|Saved added candidate/);
});
