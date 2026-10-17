import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { manualPdfPacketReopenReport } from './helpers/pdf_packet_reopen_fixture.mjs';
const route=new URL('../app/editorial-preview/pdf-reopen/page.tsx',import.meta.url);

test('nondevelopment refuses before consuming a reopening fixture or invoking its view',()=>{
 let reads=0,calls=0;const marker=Error('NOT_FOUND');
 for(const NODE_ENV of [undefined,'production','test']){
  const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:
   name==='../../../src/pdf-packet-reopen-view.tsx'?{PdfPacketReopenView(){calls++;assert.fail('No view');}}:
   name==='../../../fixtures/fictional-pdf-reopen.json'?{get default(){reads++;assert.fail('No fixture');}}:undefined,{env:{NODE_ENV}});
  assert.throws(()=>page.default(),e=>e===marker);
 }
 assert.equal(reads,0);assert.equal(calls,0);
});
test('development renders a labelled passive invented reopening example with internal returns',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));
 // Manual consumer assertions, not a claim that this fixture came from a worker.
 const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){assert.fail('Development refused');}}:
  name==='../../../fixtures/fictional-pdf-reopen.json'?{default:manualPdfPacketReopenReport()}:undefined);
 const html=renderToStaticMarkup(page.default());assert.equal(page.dynamic,'force-dynamic');
 assert.deepEqual(page.metadata.robots,{index:false,follow:false});assert.ok(html.includes('Entirely invented'));
 assert.ok(html.includes('development gate is not authentication'));assert.ok(html.includes('makes no source request and accepts no input'));
 assert.ok(html.includes('href="/editorial-preview/pdf-inspection"'));assert.ok(html.includes('href="/editorial-preview"'));
 assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|href="https?:/i);
});
test('the actual page withholds every private report field when its fixed envelope is corrupt',()=>{
 const r=manualPdfPacketReopenReport();r.inspection_report.pages[0].text='PRIVATE_REOPEN_CANARY';
 const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){assert.fail('Development refused');}}:
  name==='../../../fixtures/fictional-pdf-reopen.json'?{default:r}:undefined);
 const html=renderToStaticMarkup(page.default());assert.ok(html.includes('PDF reopening report unavailable'));
 assert.doesNotMatch(html,/PRIVATE_REOPEN_CANARY|manual-invented-report|pdf-physical-page-|[a-f0-9]{64}/);
});
