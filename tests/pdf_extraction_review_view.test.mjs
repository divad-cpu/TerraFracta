import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
const View=loadTsx(new URL('../src/pdf-extraction-review-view.tsx',import.meta.url)).PdfExtractionReviewView;
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-extraction-review.json',import.meta.url),'utf8'));
const render=r=>renderToStaticMarkup(View({input:r}));

test('passive proposal view joins exact physical page, current/earlier wording and separate times',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No source request'));
 const r=fixture(),html=render(r);
 for(const value of ['Unverified proposed assertion',r.proposal.proposed_assertion,'Current invented selected text.',
  'Earlier invented selected text.','Physical page 1','section-one',r.recorded_observed_at,r.prepared_at,r.reopened_at,
  'not printed page labels','not the original PDF','Reading order, visual layout, OCR and tables remain unqualified',
  'Unselected and unchanged page text is omitted','does not establish that the proposed assertion is supported',
  'not measured usage','omitted','No review decision or publication authority is included'])assert.ok(html.toLowerCase().includes(value.toLowerCase()),value);
 assert.doesNotMatch(html,/PRIVATE_|Shared unchanged text\.|<form|<input|<button|<script|<iframe|<embed|href="https?:/i);
 assert.ok(html.includes('href="#pdf-result-selected-pages"'));
});

test('invalid joins withhold all proposal/source text and every private reference',()=>{
 for(const mutate of [r=>r.proposal.locator='section-two',r=>r.selected_passages[0].text='PRIVATE_TEXT',
  r=>r.current.selected_pages[0].page_number=2,r=>r.artifact.extra='PRIVATE_RAW']){
  const r=fixture();mutate(r);const html=render(r);assert.ok(html.includes('PDF extraction review unavailable'));
  assert.doesNotMatch(html,/PRIVATE_|Current invented|Earlier invented|section-one|[a-f0-9]{64}/);
 }
});

test('proposal markup and bidi content remain escaped ordinary text without executable source links',()=>{
 const r=fixture();r.proposal.proposed_assertion='<script>UNTRUSTED</script> & <img src=x onerror=evil>.';
 r.proposal.source_date_text='<a href="https://evil.example">date</a>';const html=render(r);
 assert.ok(html.includes('&lt;script&gt;UNTRUSTED&lt;/script&gt;'));assert.ok(html.includes('&lt;img src=x onerror=evil&gt;'));
 assert.doesNotMatch(html,/<script|<img|href="https?:/);
});


test('an explicit first observation does not claim that an absent earlier original was rederived',()=>{
 const r=fixture();r.previous=null;r.current.selected_pages.pop();r.selected_passages[0].earlier=[null];
 const html=render(r);
 assert.ok(html.includes('Explicit first observation: no earlier original was supplied.'));
 assert.ok(html.includes('No earlier original: explicit first observation.'));
 assert.ok(html.includes('rederives each supplied complete original'));
 assert.doesNotMatch(html,/rederives both complete originals/);
});
