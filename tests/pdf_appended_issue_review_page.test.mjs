import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/pdf-append-review/page.tsx',import.meta.url);
test('whole-issue PDF example refuses outside development before candidate rendering',()=>{
 const marker=Error('NOT_FOUND');let calls=0;
 for(const NODE_ENV of[undefined,'test','production']){
  const p=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:name==='../../../src/pdf-appended-issue-review-view.tsx'?{PdfAppendedIssueReviewView(){calls++;assert.fail();}}:undefined,{env:{NODE_ENV}});
  assert.throws(()=>p.default(),error=>error===marker);
 }assert.equal(calls,0);
});
test('whole-issue PDF fixed example has a coherent passive development-only review chain',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No fetch'));
 const p=loadTsx(route,name=>name==='next/navigation'?{notFound(){assert.fail();}}:name==='../../../fixtures/fictional-pdf-appended-issue-review.json'?{default:JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-appended-issue-review.json',import.meta.url),'utf8'))}:undefined),h=renderToStaticMarkup(p.default());
 assert.equal(p.dynamic,'force-dynamic');assert.deepEqual(p.metadata.robots,{index:false,follow:false});
 for(const s of['Invented PDF whole-issue review','accepts no input','not authentication','PDF whole-issue preparation for review','2 preserved statements','href="/editorial-preview/pdf-preparation-history"','href="/editorial-preview/pdf-initial-capture"','href="/editorial-preview"'])assert.ok(h.includes(s),s);
 assert.doesNotMatch(h,/<form|<input|<button|<script|<iframe|href="https?:|base64|%PDF-/);
});
test('desk and preparation history link the separate whole-issue example without embedding its contents',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-appended-issue-review.json',import.meta.url),'utf8'));
 for(const file of['app/editorial-preview/page.tsx','app/editorial-preview/pdf-preparation-history/page.tsx']){
  const raw=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.ok(raw.includes('href="/editorial-preview/pdf-append-review"'));assert.equal(raw.includes(fixture.expected.preparationArtifactId),false);
 }
});
