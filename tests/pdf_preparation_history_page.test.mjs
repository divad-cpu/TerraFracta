import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/pdf-preparation-history/page.tsx',import.meta.url);
test('new saved PDF page refuses nondevelopment before rendering any candidate',()=>{
 const marker=Error('NOT_FOUND');let calls=0;
 for(const NODE_ENV of[undefined,'test','production']){
  const p=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:name==='../../../src/pdf-preparation-review-view.tsx'?{PdfPreparationReviewView(){calls++;assert.fail();}}:undefined,{env:{NODE_ENV}});
  assert.throws(()=>p.default(),e=>e===marker);
 }assert.equal(calls,0);
});
test('new saved PDF page is fixed passive noindex with explicit illustrative navigation',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No fetch'));
 const p=loadTsx(route,name=>name==='next/navigation'?{notFound(){assert.fail();}}:name==='../../../fixtures/fictional-stored-pdf-preparation-review.json'?{default:JSON.parse(readFileSync(new URL('../fixtures/fictional-stored-pdf-preparation-review.json',import.meta.url),'utf8'))}:undefined);
 const html=renderToStaticMarkup(p.default());assert.equal(p.dynamic,'force-dynamic');assert.deepEqual(p.metadata.robots,{index:false,follow:false});
 for(const text of ['Saved PDF preparation example','Entirely invented','fixed example accepts no input','opens no PDF and connects to no database','development gate is not authentication','Saved PDF preparation','Invented durable PDF preparation','href="/editorial-preview/pdf-held-preparation"','href="/editorial-preview"'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|href="https?:/);
});
test('the current desk and detached PDF page link to the saved example without adopting its identity',()=>{
 const desk=readFileSync(new URL('../app/editorial-preview/page.tsx',import.meta.url),'utf8'),detached=readFileSync(new URL('../app/editorial-preview/pdf-held-preparation/page.tsx',import.meta.url),'utf8');
 assert.ok(desk.includes('href="/editorial-preview/pdf-preparation-history"'));assert.ok(detached.includes('Inspect a separate saved PDF preparation example'));
 assert.equal(desk.includes('60735a11'),false);assert.equal(detached.includes('60735a11'),false);
});
