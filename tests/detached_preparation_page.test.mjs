import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/preparation-sample/page.tsx',import.meta.url);
test('production/test refuse before preparation view is invoked',()=>{
 let calls=0;const marker=Error('NOT_FOUND');for(const NODE_ENV of ['production','test']){
  const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:name==='../../../src/detached-preparation-view.tsx'?{DetachedPreparationView(){calls++;throw Error('VIEW');}}:undefined,{env:{NODE_ENV}});
  assert.throws(()=>page.default(),e=>e===marker);
 }assert.equal(calls,0);
});
test('development renders the exact fixed fixture with noindex and no operational actions',()=>{
 const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw Error('NOT_FOUND');}}:name==='../../../fixtures/fictional-detached-preparation.json'?{default:JSON.parse(readFileSync(new URL('../fixtures/fictional-detached-preparation.json',import.meta.url),'utf8'))}:name==='../../../fixtures/fictional-detached-preparation-expected.json'?{default:JSON.parse(readFileSync(new URL('../fixtures/fictional-detached-preparation-expected.json',import.meta.url),'utf8'))}:undefined);const html=renderToStaticMarkup(page.default());
 assert.equal(page.dynamic,'force-dynamic');assert.deepEqual(page.metadata.robots,{index:false,follow:false});assert.match(html,/development gate is not authentication/);
 assert.match(html,/Original exact invented passage/);assert.match(html,/Historical private preparation/);assert.match(html,/href="\/editorial-preview"/);assert.match(html,/href="\/editorial-preview\/extraction-sample"/);assert.doesNotMatch(html,/<form|<button|<input/);
});
test('desk and extraction-only example supply labelled next and return paths',()=>{
 const desk=readFileSync(new URL('../app/editorial-preview/page.tsx',import.meta.url),'utf8'),old=readFileSync(new URL('../app/editorial-preview/extraction-sample/page.tsx',import.meta.url),'utf8');
 assert.match(desk,/href="\/editorial-preview\/preparation-sample">Inspect invented historical preparation/);assert.match(old,/href="\/editorial-preview\/preparation-sample">Follow the invented historical preparation/);
 assert.match(desk,/Current qualification and actual held capture remain open/);
});
