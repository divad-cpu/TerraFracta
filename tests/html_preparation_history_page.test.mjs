import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/html-preparation-history/page.tsx',import.meta.url),fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-html-preparation-history.json',import.meta.url),'utf8'));
function page(env,intercept=()=>undefined){if(!arguments.length)env='development';const marker=Error('NOT_FOUND'),control=Error('FRAMEWORK');return{marker,control,mod:loadTsx(route,name=>intercept(name)??(name==='next/navigation'?{notFound(){throw marker;},unstable_rethrow(e){if(e===control)throw e;}}:name==='../../../fixtures/fictional-html-preparation-history.json'?{default:fixture()}:undefined),{env:{NODE_ENV:env}})};}
const render=async(p,q)=>renderToStaticMarkup(await p.mod.default({searchParams:Promise.resolve(q)}));
test('production test and unset refuse before query, choice parser or evidence consumer',async()=>{
 let awaits=0,calls=0;for(const env of['production','test',undefined]){const p=page(env,name=>name==='../../../src/server/html-preparation-review-report.ts'?{htmlPreparationHistory(){calls++;assert.fail('No inventory');}}:undefined);
 await assert.rejects(p.mod.default({searchParams:{then(){awaits++;assert.fail('No query');}}}),e=>e===p.marker);}
 assert.equal(awaits,0);assert.equal(calls,0);
});
test('empty selection shows only explicit invented choices and no candidate source text',async()=>{
 const p=page(),html=await render(p,{});assert.equal(p.mod.dynamic,'force-dynamic');assert.deepEqual(p.mod.metadata.robots,{index:false,follow:false});
 assert.match(html,/Choose a preparation explicitly/);assert.match(html,/Empty-head preparation example/);assert.match(html,/Known-head preparation example/);
 assert.doesNotMatch(html,/Revised invented wording|Invented HTML review candidate|Stored HTML extraction review example/);
});
test('each explicit choice opens only its own historical head and exact source comparison',async()=>{
 for(const row of fixture().reports){const html=await render(page(),{preparation:row.operationId});assert.match(html,/Historical HTML preparation<\/h2>/);assert.match(html,/Revised invented wording/);
 assert.match(html,row.label.startsWith('Empty')?/Explicitly supplied as empty/:/Publication <code>/);assert.ok(html.includes('/editorial-preview/html-preparation-history'));
 assert.doesNotMatch(html,/<form|<input|<button|<iframe|<script|href="https?:/);}
});
test('unknown aliases hidden symbols inherited or getter selectors never echo or fall back',async()=>{
 const id=fixture().reports[0].operationId;let getters=0;
 const hidden={};Object.defineProperty(hidden,'preparation',{value:id});
 const getter={};Object.defineProperty(getter,'preparation',{enumerable:true,get(){getters++;throw Error('PRIVATE_CANARY');}});
 for(const q of [{preparation:'PRIVATE_CANARY'},{preparation:[id,id]},{preparation:id,extra:true},{preparation:'00000000-0000-4000-8000-000000000999'},hidden,getter,
 {[Symbol('PRIVATE_CANARY')]:id},Object.assign(Object.create({extra:true}),{preparation:id})]){
 const html=await render(page(),q);assert.match(html,/Selected HTML preparation unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY|Revised invented wording|Invented HTML review candidate/);}
 assert.equal(getters,0);
});
test('ordinary asynchronous failures withhold details while framework control still propagates',async()=>{
 const p=page();const html=renderToStaticMarkup(await p.mod.default({searchParams:Promise.reject(Error('PRIVATE_CANARY'))}));assert.match(html,/Selected HTML preparation unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY/);
 await assert.rejects(p.mod.default({searchParams:Promise.reject(p.control)}),e=>e===p.control);
});
test('a corrupt unselected report does not block another independently selected report',async()=>{
 const f=fixture();f.reports[1].reportJson='PRIVATE_CANARY';const p=page('development',name=>name==='../../../fixtures/fictional-html-preparation-history.json'?{default:f}:undefined);
 const first=await render(p,{preparation:f.reports[0].operationId});assert.match(first,/Revised invented wording/);
 const second=await render(p,{preparation:f.reports[1].operationId});assert.match(second,/Historical HTML preparation unavailable/);assert.doesNotMatch(second,/PRIVATE_CANARY|Revised invented wording/);
});
