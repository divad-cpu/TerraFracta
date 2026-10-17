import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/capture-history/page.tsx',import.meta.url),fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-recorded-capture-history.json',import.meta.url),'utf8'));
function page(env='development',intercept=()=>undefined){const marker=Error('NOT_FOUND'),control=Error('FRAMEWORK');return {marker,control,mod:loadTsx(route,name=>intercept(name)??(name==='next/navigation'?{notFound(){throw marker;},unstable_rethrow(e){if(e===control)throw e;}}:name==='../../../fixtures/fictional-recorded-capture-history.json'?{default:fixture()}:name==='../../../fixtures/fictional-appended-capture.json'?{default:JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-capture.json',import.meta.url),'utf8'))}:undefined),{env:{NODE_ENV:env}})};}
const render=async(mod,query)=>renderToStaticMarkup(await mod.default({searchParams:Promise.resolve(query)}));
test('production and test refuse before query or resolver executes',async()=>{
 let awaits=0,calls=0;for(const env of ['production','test']){const p=page(env,name=>name==='../../../src/server/recorded-appended-capture.ts'?{resolveRecordedAppendedCapture(){calls++;throw Error('READ');}}:undefined);await assert.rejects(p.mod.default({searchParams:{then(){awaits++;throw Error('QUERY');}}}),e=>e===p.marker);}assert.equal(awaits,0);assert.equal(calls,0);
});
test('development starts with an explicit preparation choice and no private source content',async()=>{
 const p=page(),html=await render(p.mod,{});assert.equal(p.mod.dynamic,'force-dynamic');assert.deepEqual(p.mod.metadata.robots,{index:false,follow:false});assert.match(html,/Choose the recorded preparation/);assert.doesNotMatch(html,/Changed exact|Exact Å|Original exact|Recorded composition 1|Saved whole-issue composition comparison/);
});
test('a chosen preparation shows its authentic predecessor and metadata without selecting its sole capture',async()=>{
 const f=fixture(),p=page(),html=await render(p.mod,{preparation:f.preparationId});assert.match(html,/Inspect the separately retained original preparation/);assert.match(html,/Historical private preparation/);assert.match(html,/Recorded composition 1/);assert.match(html,/Choose a composition explicitly/);assert.doesNotMatch(html,/Saved whole-issue composition comparison/);
});
test('explicit capture opens the exact saved result with checked return selectors and distinct other history',async()=>{
 const f=fixture(),p=page(),html=await render(p.mod,{preparation:f.preparationId,capture:f.captureId});assert.match(html,/Saved whole-issue composition comparison/);assert.match(html,/Return to this exact preparation/);assert.match(html,/different preparation records/);assert.doesNotMatch(html,/<form|<button|<input|href="https?:/);
});
test('foreign duplicate extra malformed and failed query inputs never echo or select private text',async()=>{
 const f=fixture(),p=page();for(const q of [{preparation:'PRIVATE_CANARY'},{preparation:[f.preparationId,f.preparationId]},{preparation:f.preparationId,capture:['PRIVATE_CANARY']},{capture:f.captureId},{preparation:f.preparationId,extra:'PRIVATE_CANARY'},{preparation:'00000000-0000-4000-8000-000000000999'},{preparation:f.preparationId,capture:'00000000-0000-4000-8000-000000000999'},Object.defineProperty({},'preparation',{enumerable:true,get(){throw Error('PRIVATE_CANARY');}})]){const html=await render(p.mod,q);assert.match(html,/Selected continuation unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY|Changed exact|Exact Å|Original exact|Historical private preparation/);}
 const html=renderToStaticMarkup(await p.mod.default({searchParams:Promise.reject(Error('PRIVATE_CANARY'))}));assert.match(html,/Selected continuation unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY/);
});
test('framework control exceptions remain control flow rather than an invented failed record',async()=>{
 const p=page();await assert.rejects(p.mod.default({searchParams:Promise.reject(p.control)}),e=>e===p.control);
});

test('review desk and fixed saved comparison provide a continuation without changing older history scope',()=>{
 for(const file of ['../app/editorial-preview/page.tsx','../app/editorial-preview/capture-sample/page.tsx'])assert.match(readFileSync(new URL(file,import.meta.url),'utf8'),/href="\/editorial-preview\/capture-history"/);
});
