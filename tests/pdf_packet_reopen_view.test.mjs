import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { manualPdfPacketReopenReport as fixture, inspectionWireSha } from './helpers/pdf_packet_reopen_fixture.mjs';
import { textPage } from './helpers/pdf_inspection_fixture.mjs';
const View=loadTsx(new URL('../src/pdf-packet-reopen-view.tsx',import.meta.url)).PdfPacketReopenView;
const render=input=>renderToStaticMarkup(View({input}));

test('passive reopening view separates historical observation, reopening and omitted supplied references',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));
 const r=fixture(),html=render(r);
 for(const value of [r.recorded_observed_at,r.reopened_at,r.packet_sha256,r.inspection_sha256,r.derivation_sha256,
  'reopens no bytes, parses no PDF and renews no source check','does not make the source newly verified or current',
  'Packet and manifest hashes are supplied references and are not recomputed here','including its final newline',
  'does not prove that a PDF worker ran','that bytes were stored','a principal authenticated them',
  'No selected-page map is supplied here','do not imply selected model coverage','No request, token proof or publication permission follows'])assert.ok(html.includes(value),value);
 assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|<object|<embed|href="https?:|download=/i);
});
test('invalid outer or inner data withholds all digests references and partial page text',()=>{
 for(const mutate of [r=>r.packet_sha256='PRIVATE_HASH',r=>r.reopened_at='PRIVATE_DATE',r=>r.inspection_sha256='f'.repeat(64),
  r=>r.inspection_report.pages[0].text='PRIVATE_TEXT',r=>r.private='PRIVATE_RAW']){
  const r=fixture();mutate(r);const html=render(r);assert.ok(html.includes('PDF reopening report unavailable'));
  assert.doesNotMatch(html,/PRIVATE_|fictional-pdf|manual-invented-report|Manual invented derived|pdf-physical-page-|[a-f0-9]{64}/);
 }
});
test('safe escaping and existing physical-page navigation are retained without source actions',()=>{
 const r=fixture();r.inspection_report.document.item_key='<img src=x onerror=PRIVATE>';
 r.inspection_report.pages[0]=textPage(1,'<script>UNTRUSTED</script> & <a href="https://evil.example">open</a>');
 r.inspection_sha256=inspectionWireSha(r.inspection_report);const html=render(r);
 assert.ok(html.includes('&lt;script&gt;UNTRUSTED&lt;/script&gt;'));assert.ok(html.includes('&lt;img src=x onerror=PRIVATE&gt;'));
 assert.ok(html.includes('href="#pdf-physical-page-1"'));assert.ok(html.includes('href="#pdf-physical-page-2"'));
 assert.doesNotMatch(html,/<script|<img|href="https?:/);
});
test('per-page holds and textless peers remain unresolved without claiming selected coverage or a new source check',()=>{
 const r=fixture();r.inspection_report.pages[0]={page_number:1,state:'held',text:null,text_sha256:null,reason_code:'page_text_unusable'};
 r.inspection_sha256=inspectionWireSha(r.inspection_report);const html=render(r);
 assert.ok(html.includes('Page held: Page text is unusable'));assert.ok(html.includes('No native text was returned'));
 assert.ok(html.includes('No selected-page map is supplied here'));assert.ok(html.includes('not printed PDF page labels or original byte offsets'));
 assert.doesNotMatch(html,/Manual invented derived text/);
});
