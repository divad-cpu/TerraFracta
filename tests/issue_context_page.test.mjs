import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/context-sample/page.tsx',import.meta.url),fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-issue-preparation-context.json',import.meta.url),'utf8'));
function page(env='development',intercept=()=>undefined){const marker=Error('NOT_FOUND'),control=Error('FRAMEWORK');return {marker,control,mod:loadTsx(route,name=>intercept(name)??(name==='next/navigation'?{notFound(){throw marker;},unstable_rethrow(e){if(e===control)throw e;}}:name==='../../../fixtures/fictional-issue-preparation-context.json'?{default:fixture()}:undefined),{env:{NODE_ENV:env}})};}
const render=async(p,q)=>renderToStaticMarkup(await p.mod.default({searchParams:Promise.resolve(q)}));
test('production and test gates refuse before awaiting selectors or showing any observation',async()=>{
 let awaits=0,views=0;for(const env of ['production','test']){const p=page(env,name=>name==='../../../src/issue-preparation-context-view.tsx'?{IssuePreparationContextView(){views++;throw Error('VIEW');}}:undefined);await assert.rejects(p.mod.default({searchParams:{then(){awaits++;throw Error('QUERY');}}}),e=>e===p.marker);}assert.equal(awaits,0);assert.equal(views,0);
});
test('no selector keeps both context records unselected with explicit choices and honest example scope',async()=>{
 const p=page(),html=await render(p,{});assert.match(html,/No context is selected/);assert.match(html,/different isolated runs/);assert.doesNotMatch(html,/Explicit held candidate and source identity|Baseline title|both current fields empty/);assert.deepEqual(p.mod.metadata.robots,{index:false,follow:false});assert.equal(p.mod.dynamic,'force-dynamic');
});
test('each explicit mode displays only its checked observation with no actions or external reads',async()=>{
 const p=page();for(const context of ['known-base','empty-head']){const html=await render(p,{context});assert.match(html,/Observed issue context before preparation/);assert.doesNotMatch(html,/<form|<button|<input|href="https?:/);assert.equal(html.includes('Baseline title'),context==='known-base');assert.equal(html.includes('both current fields empty'),context==='empty-head');}
});
test('duplicate foreign extra hidden throwing or rejected selectors never disclose an observation or echo input',async()=>{
 const p=page();for(const q of [{context:['known-base','empty-head']},{context:'PRIVATE_CANARY'},{context:'known-base',extra:'PRIVATE_CANARY'},Object.defineProperty({},'context',{enumerable:true,get(){throw Error('PRIVATE_CANARY');}})]){const html=await render(p,q);assert.match(html,/Recorded preparation context unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY|Explicit held candidate and source identity|Baseline title/);}
 const html=renderToStaticMarkup(await p.mod.default({searchParams:Promise.reject(Error('PRIVATE_CANARY'))}));assert.match(html,/unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY/);
});
test('framework control flow is rethrown instead of becoming recorded-context failure',async()=>{
 const p=page();await assert.rejects(p.mod.default({searchParams:Promise.reject(p.control)}),e=>e===p.control);
});

test('review desk and explicit continuation provide distinct labelled context-example links',()=>{
 for(const name of ['../app/editorial-preview/page.tsx','../app/editorial-preview/capture-history/page.tsx'])assert.match(readFileSync(new URL(name,import.meta.url),'utf8'),/href="\/editorial-preview\/context-sample"/);
});
