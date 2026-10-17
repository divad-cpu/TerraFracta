import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/pdf-extraction-review/page.tsx',import.meta.url);

test('nondevelopment refuses before consuming the fixture or invoking the private view',()=>{
 let reads=0,calls=0;const marker=Error('NOT_FOUND');
 for(const NODE_ENV of [undefined,'test','production']){
  const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:
   name==='../../../src/pdf-extraction-review-view.tsx'?{PdfExtractionReviewView(){calls++;assert.fail('No view');}}:
   name==='../../../fixtures/fictional-pdf-extraction-review.json'?{get default(){reads++;assert.fail('No fixture');}}:undefined,{env:{NODE_ENV}});
  assert.throws(()=>page.default(),e=>e===marker);
 }
 assert.equal(reads,0);assert.equal(calls,0);
});

test('actual development fixture renders with explicit scope, noindex and internal navigation',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No fetch'));
 const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){assert.fail('No refusal');}}:name==='../../../fixtures/fictional-pdf-extraction-review.json'?{default:JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-extraction-review.json',import.meta.url),'utf8'))}:undefined);
 const html=renderToStaticMarkup(page.default());assert.equal(page.dynamic,'force-dynamic');
 assert.deepEqual(page.metadata.robots,{index:false,follow:false});
 for(const value of ['Supplied PDF extraction review','Current invented selected text.','href="/editorial-preview/pdf-held-preparation"','Entirely invented','development gate is not authentication','makes no source request and accepts no input',
  'href="/editorial-preview/pdf-reopen"','href="/editorial-preview/pdf-inspection"','href="/editorial-preview"'])assert.ok(html.includes(value),value);
 assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|href="https?:/i);
});
