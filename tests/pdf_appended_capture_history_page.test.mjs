import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/pdf-capture-history/page.tsx',import.meta.url),fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-appended-capture.json',import.meta.url),'utf8'));
test('whole captured PDF example refuses outside development before receipt decode or candidate display',()=>{
 const marker=Error('NOT_FOUND');let calls=0;
 for(const NODE_ENV of[undefined,'test','production']){
  const p=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:name==='../../../fixtures/fictional-pdf-appended-capture.json'?{default:fixture()}:name==='../../../src/pdf-appended-capture-review-view.tsx'?{PdfAppendedCaptureReviewView(){calls++;assert.fail();}}:undefined,{env:{NODE_ENV}});
  assert.throws(()=>p.default(),error=>error===marker);
 }assert.equal(calls,0);
});
test('whole captured PDF example renders the complete actual supplied fixture with passive noindex boundaries',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No fetch'));
 const p=loadTsx(route,name=>name==='next/navigation'?{notFound(){assert.fail();}}:name==='../../../fixtures/fictional-pdf-appended-capture.json'?{default:fixture()}:undefined),h=renderToStaticMarkup(p.default());
 assert.equal(p.dynamic,'force-dynamic');assert.deepEqual(p.metadata.robots,{index:false,follow:false});
 for(const s of['Captured PDF whole-issue example','entirely invented','accepts no input','not authentication or a current-work check','Captured PDF whole-issue proposal','2 preserved statements','1 proposed new statement','Historical publication basis','href="/editorial-preview/pdf-append-review"','href="/editorial-preview/pdf-initial-capture"','href="/editorial-preview"'])assert.ok(h.includes(s),s);
 assert.doesNotMatch(h,/<form|<input|<button|<script|<iframe|href="https?:|base64|%PDF-/);
});
test('desk and whole preparation navigation link a separate captured example without embedding native identities',()=>{
 const f=fixture(),raw=JSON.parse(Buffer.from(f.receiptBase64,'base64').toString());
 for(const file of['app/editorial-preview/page.tsx','app/editorial-preview/pdf-append-review/page.tsx']){
  const s=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.ok(s.includes('href="/editorial-preview/pdf-capture-history"'));assert.equal(s.includes(raw.capture_id),false);
 }
});
