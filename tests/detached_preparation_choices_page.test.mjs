import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/preparation-history/page.tsx',import.meta.url);
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-detached-preparation-history.json',import.meta.url),'utf8'));
function page(environment='development',intercept=()=>undefined){const marker=Error('NOT_FOUND');return {marker,mod:loadTsx(route,name=>intercept(name)??(name==='next/navigation'?{notFound(){throw marker;},unstable_rethrow(){}}:name==='../../../fixtures/fictional-detached-preparation-history.json'?{default:fixture()}:undefined),{env:{NODE_ENV:environment}})};}
test('production and test refuse before awaiting query or rendering choices',async()=>{
 let awaits=0,views=0;for(const env of ['production','test']){const p=page(env,name=>name==='../../../src/detached-preparation-choices-view.tsx'?{DetachedPreparationChoicesView(){views++;throw Error('VIEW');}}:undefined);
 await assert.rejects(p.mod.default({searchParams:{then(){awaits++;throw Error('QUERY');}}}),e=>e===p.marker);}assert.equal(awaits,0);assert.equal(views,0);
});
test('development with no choice shows only metadata and explicit members show their own recorded report',async()=>{
 const {mod}=page(),none=renderToStaticMarkup(await mod.default({searchParams:Promise.resolve({})}));assert.match(none,/Choose one record explicitly/);assert.doesNotMatch(none,/Changed exact|Invented first historical candidate/);
 assert.deepEqual(mod.metadata.robots,{index:false,follow:false});for(const report of fixture().reports){const html=renderToStaticMarkup(await mod.default({searchParams:Promise.resolve({preparation:report.operationId})}));assert.ok(html.includes(JSON.parse(report.reportJson).extraction_report.proposal.proposed_assertion));}
});
test('duplicate malformed unknown and throwing selector queries never select another record or echo input',async()=>{
 const {mod}=page();for(const query of [{preparation:['PRIVATE_CANARY','OTHER']},{preparation:'PRIVATE_CANARY'},{other:'PRIVATE_CANARY'},Object.defineProperty({},'preparation',{enumerable:true,get(){throw Error('PRIVATE_CANARY');}})]){
 const html=renderToStaticMarkup(await mod.default({searchParams:Promise.resolve(query)}));assert.match(html,/Selected preparation unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY|Changed exact|Invented first historical candidate/);}
 const html=renderToStaticMarkup(await mod.default({searchParams:Promise.reject(Error('PRIVATE_CANARY'))}));assert.match(html,/Selected preparation unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY/);
});
test('desk and fixed example link explicitly to recorded choices',()=>{
 for(const file of ['../app/editorial-preview/page.tsx','../app/editorial-preview/preparation-sample/page.tsx'])assert.match(readFileSync(new URL(file,import.meta.url),'utf8'),/href="\/editorial-preview\/preparation-history"/);
});
