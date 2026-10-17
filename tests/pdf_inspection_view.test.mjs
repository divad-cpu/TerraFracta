import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { manualPdfReport as fixture,textPage } from './helpers/pdf_inspection_fixture.mjs';
const View=loadTsx(new URL('../src/pdf-inspection-view.tsx',import.meta.url)).PdfInspectionView;
const render=input=>renderToStaticMarkup(View({input}));

test('passive view separates document receipt, original hash, retrieval, observation and page text',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No fetch'));
 const r=fixture(),html=render(r);
 for(const value of [r.document.content_sha256,r.document.source_version_id,r.document.retrieved_at,r.observed_at,r.pages[0].text_sha256,
  'not independently verified here','not a source publication date','does not renew','not a rendered PDF','OCR','publication eligibility are not verified',
  'not printed PDF page labels or original byte offsets','No native text was returned','does not establish an empty document, a scanned page'])assert.ok(html.includes(value),value);
 assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|<object|<embed|href="https?:|download=/i);
});
test('hostile derived text and source item metadata render escaped without links or instructions',()=>{
 const r=fixture();r.pages[0]=textPage(1,'<script>UNTRUSTED_PDF</script> & <a href="https://evil.example">open</a>');
 r.document.item_key='<img src=x onerror=PRIVATE>';
 const html=render(r);assert.ok(html.includes('&lt;script&gt;UNTRUSTED_PDF&lt;/script&gt;'));
 assert.ok(html.includes('&lt;img src=x onerror=PRIVATE&gt;'));assert.doesNotMatch(html,/<script|<img|href="https:\/\/evil/);
 assert.match(html,/white-space:pre-wrap/);assert.match(html,/<bdi>/);
});
test('whole-document holds withhold all page text/count/navigation',()=>{
 for(const reason of ['pdf_encrypted','pdf_parse_unavailable','pdf_page_limit','pdf_output_limit']){
  const r=fixture();Object.assign(r,{state:'held',reason_code:reason,page_count:null,pages:[]});const html=render(r);
  assert.ok(html.includes('whole document inspection is held'));assert.ok(html.includes('No page count or partial page text'));
  assert.doesNotMatch(html,/pdf-physical-page-|Manual invented derived text|physical pages inspected/);
 }
});
test('individual page holds show only curated wording and preserve other physical positions',()=>{
 const r=fixture();r.pages[1]={page_number:2,state:'held',text:null,text_sha256:null,reason_code:'page_extraction_unavailable'};
 const html=render(r);assert.ok(html.includes('Page held: Page text extraction unavailable'));
 assert.ok(html.includes(r.pages[0].text.trim()));assert.ok(html.includes('No text or unsafe parser details'));
 assert.ok(html.includes('held or textless pages remain unresolved'));
});
test('one invalid page or receipt withholds every partial private field',()=>{
 for(const mutate of [r=>r.pages[0].text='PRIVATE_TEXT',r=>r.pages[1].text='PRIVATE_PAGE',r=>r.document.source_url='file:///PRIVATE_PATH',
  r=>r.observed_at='PRIVATE_DATE',r=>r.private='PRIVATE_RAW']){
  const r=fixture();mutate(r);const html=render(r);assert.ok(html.includes('PDF inspection unavailable'));
  assert.doesNotMatch(html,/PRIVATE_|fictional-pdf|manual-invented-report|Manual invented derived|pdf-physical-page-/);
 }
});
test('physical-page navigation has exact occurrence anchors and overview return targets',()=>{
 const html=render(fixture());
 for(const n of [1,2]){assert.ok(html.includes(`href="#pdf-physical-page-${n}"`));assert.ok(html.includes(`<article id="pdf-physical-page-${n}" tabindex="-1">`));}
 assert.equal((html.match(/id="pdf-inspection-heading"/g)||[]).length,1);
 assert.equal((html.match(/href="#pdf-inspection-heading"/g)||[]).length,2);
});
