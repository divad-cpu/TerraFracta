import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/pdf-initial-capture/page.tsx',import.meta.url);
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-initial-candidate-capture.json',import.meta.url),'utf8'));
test('captured PDF example refuses nondevelopment before decoding or exposing the fixed receipt',()=>{
 const marker=Error('NOT_FOUND');let calls=0;
 for(const NODE_ENV of[undefined,'test','production']){
  const p=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:name==='../../../src/pdf-initial-candidate-review-view.tsx'?{PdfInitialCandidateReviewView(){calls++;assert.fail();}}:undefined,{env:{NODE_ENV}});
  assert.throws(()=>p.default(),e=>e===marker);
 }assert.equal(calls,0);
});
test('captured PDF example renders its whole supplied fixture once with passive noindex limits',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No fetch'));
 const f=fixture(),p=loadTsx(route,name=>name==='next/navigation'?{notFound(){assert.fail();}}:name==='../../../fixtures/fictional-pdf-initial-candidate-capture.json'?{default:f}:undefined);
 const html=renderToStaticMarkup(p.default());assert.equal(p.dynamic,'force-dynamic');assert.deepEqual(p.metadata.robots,{index:false,follow:false});
 for(const text of['Captured PDF candidate example','Entirely invented','accepts no input','opens no PDF and connects to no database','not authentication or a current-work check','PDF candidate capture','Historical candidate captured','Detached PDF candidate','href="/editorial-preview/pdf-preparation-history"','href="/editorial-preview"'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|href="https?:|base64|%PDF-/);
 assert.equal((html.match(/id="pdf-candidate-capture-heading"/g)||[]).length,1);
});
test('review desk and saved preparation navigation disclose a separate captured example',()=>{
 const desk=readFileSync(new URL('../app/editorial-preview/page.tsx',import.meta.url),'utf8'),saved=readFileSync(new URL('../app/editorial-preview/pdf-preparation-history/page.tsx',import.meta.url),'utf8');
 assert.ok(desk.includes('href="/editorial-preview/pdf-initial-capture"'));assert.ok(saved.includes('Inspect a separate captured PDF candidate example'));
 const f=fixture(),capture=JSON.parse(Buffer.from(f.receiptBase64,'base64').toString());
 assert.equal(desk.includes(capture.capture_id),false);assert.equal(saved.includes(capture.capture_id),false);
});
