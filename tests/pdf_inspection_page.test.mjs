import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { manualPdfReport } from './helpers/pdf_inspection_fixture.mjs';
const route=new URL('../app/editorial-preview/pdf-inspection/page.tsx',import.meta.url);

test('nondevelopment refuses before consuming the PDF report or invoking its view',()=>{
 let calls=0,fixtureReads=0;const marker=Error('NOT_FOUND');
 for(const NODE_ENV of [undefined,'production','test']){
  const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:
   name==='../../../src/pdf-inspection-view.tsx'?{PdfInspectionView(){calls++;assert.fail('View consumed');}}:
   name==='../../../fixtures/fictional-pdf-inspection.json'?{get default(){fixtureReads++;assert.fail('Fixture consumed');}}:undefined,{env:{NODE_ENV}});
  assert.throws(()=>page.default(),e=>e===marker);
 }
 assert.equal(calls,0);assert.equal(fixtureReads,0);
});
test('development renders the passive contract with fixed sample labels and internal returns',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));
 // Deliberately manual consumer fixture; actual worker fixture is root-owned.
 const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){assert.fail('Development refused');}}:
  name==='../../../fixtures/fictional-pdf-inspection.json'?{default:manualPdfReport()}:undefined);
 const html=renderToStaticMarkup(page.default());assert.equal(page.dynamic,'force-dynamic');
 assert.deepEqual(page.metadata.robots,{index:false,follow:false});assert.ok(html.includes('Entirely invented'));
 assert.ok(html.includes('development gate is not authentication'));assert.ok(html.includes('makes no source request and accepts no input'));
 assert.ok(html.includes('href="/editorial-preview"'));assert.ok(html.includes('href="/editorial-preview/source-discovery"'));
 assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|href="https?:/i);
});
test('a corrupt fixed report does not expose its private data through the real page',()=>{
 const r=manualPdfReport();r.pages[0].text='PRIVATE_PDF_CANARY';
 const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){assert.fail('Development refused');}}:
  name==='../../../fixtures/fictional-pdf-inspection.json'?{default:r}:undefined);
 const html=renderToStaticMarkup(page.default());assert.ok(html.includes('PDF inspection unavailable'));
 assert.doesNotMatch(html,/PRIVATE_PDF_CANARY|manual-invented-report|pdf-physical-page-/);
});
