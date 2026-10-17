import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/html-capture-history/page.tsx',import.meta.url);
const history=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-html-capture-history.json',import.meta.url),'utf8'));
const saved=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-html-appended-capture.json',import.meta.url),'utf8'));
function page(env='development',custom=()=>undefined){const marker=Error('NOT_FOUND'),control=Error('FRAMEWORK');return {marker,control,mod:loadTsx(route,n=>custom(n)??(n==='next/navigation'?{notFound(){throw marker;},unstable_rethrow(e){if(e===control)throw e;}}:n==='../../../fixtures/fictional-html-capture-history.json'?{default:history()}:n==='../../../fixtures/fictional-html-appended-capture.json'?{default:saved()}:undefined),{env:{NODE_ENV:env}})};}
const render=async(p,q)=>renderToStaticMarkup(await p.mod.default({searchParams:Promise.resolve(q)}));
test('HTML continuation route refuses nondevelopment before query observation or private consumer',async()=>{
 let calls=0;for(const env of ['production','test']){const p=page(env,n=>n==='../../../src/server/recorded-html-appended-capture.ts'?{resolveRecordedHtmlAppendedCapture(){calls++;assert.fail('No consumer');}}:undefined);await assert.rejects(p.mod.default({searchParams:{then(){calls++;assert.fail('No query');}}}),e=>e===p.marker);}assert.equal(calls,0);
});
test('initial and preparation-only stages require explicit choices and never load complete saved fixture',async()=>{
 let loads=0;const p=page('development',n=>n==='../../../fixtures/fictional-html-appended-capture.json'?(loads++,assert.fail('No full fixture')):undefined),h=history();
 const first=await render(p,{});assert.match(first,/Choose the recorded HTML preparation/);assert.doesNotMatch(first,/Saved HTML whole-issue composition comparison|Revised invented wording/);
 const second=await render(p,{preparation:h.preparationId});assert.match(second,/Choose a saved HTML composition/);assert.match(second,/capture=90000000/);assert.doesNotMatch(second,/Saved HTML whole-issue composition comparison/);assert.equal(loads,0);assert.equal(p.mod.dynamic,'force-dynamic');assert.deepEqual(p.mod.metadata.robots,{index:false,follow:false});
});
test('checked explicit composition renders complete preserved statements passages comparison and contextual return links',async()=>{
 const h=history(),id=JSON.parse(h.lookupJson).matches[0].capture_id,html=await render(page(),{preparation:h.preparationId,capture:id});assert.match(html,/Saved HTML whole-issue composition comparison/);assert.match(html,/2 preserved statements; 1 added candidate/);assert.match(html,/Return to this preparation/);assert.match(html,/development gate is not authentication/);assert.doesNotMatch(html,/<main|<form|<button|<input|<iframe|href="https?:/);
});
test('invalid repeated hidden inherited symbols foreign selectors and rejected query withhold all private detail',async()=>{
 const h=history(),hidden={};Object.defineProperty(hidden,'preparation',{value:h.preparationId});let calls=0;const getter={};Object.defineProperty(getter,'preparation',{enumerable:true,get(){calls++;return h.preparationId;}});
 for(const q of [{preparation:'PRIVATE_CANARY'},{preparation:[h.preparationId]},{capture:'90000000-0000-4000-8000-000000000004'},hidden,getter,{[Symbol('extra')]:true},Object.assign(Object.create({extra:true}),{preparation:h.preparationId})]){const html=await render(page(),q);assert.match(html,/Selected HTML continuation unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY|Revised invented wording|Saved HTML whole-issue composition comparison/);}assert.equal(calls,0);
 const p=page();const html=renderToStaticMarkup(await p.mod.default({searchParams:Promise.reject(Error('PRIVATE_CANARY'))}));assert.match(html,/Selected HTML continuation unavailable/);await assert.rejects(p.mod.default({searchParams:Promise.reject(p.control)}),e=>e===p.control);
});
test('foreign capture does not load the full record or fall back to the known composition',async()=>{
 const h=history(),p=page('development',n=>n==='../../../fixtures/fictional-html-appended-capture.json'?assert.fail('No full fixture'):undefined),html=await render(p,{preparation:h.preparationId,capture:'00000000-0000-4000-8000-000000000999'});assert.match(html,/Selected HTML continuation unavailable/);assert.doesNotMatch(html,/Saved HTML whole-issue composition comparison/);
});
test('actual root layout retains one main landmark skip target and page heading across both selection stages',async()=>{
 const layout=loadTsx(new URL('../app/layout.tsx',import.meta.url),n=>n==='./globals.css'?{}:n==='./components'?{DemoNotice:()=>null}:n==='./site-navigation'?{SiteNavigation:()=>null}:undefined),h=history(),id=JSON.parse(h.lookupJson).matches[0].capture_id;
 for(const q of [{},{preparation:h.preparationId,capture:id}]){const child=await page().mod.default({searchParams:Promise.resolve(q)}),html=renderToStaticMarkup(layout.default({children:child}));assert.equal((html.match(/<main\b/g)||[]).length,1);assert.equal((html.match(/<h1\b/g)||[]).length,1);assert.match(html,/<main id="main" tabindex="-1">/);assert.match(html,/href="#main"/);}
});
test('review desk and fixed saved example provide explicit routes into the new HTML choice flow',()=>{
 for(const n of ['app/editorial-preview/page.tsx','app/editorial-preview/html-capture-sample/page.tsx'])assert.match(readFileSync(new URL('../'+n,import.meta.url),'utf8'),/href="\/editorial-preview\/html-capture-history"/);
});
