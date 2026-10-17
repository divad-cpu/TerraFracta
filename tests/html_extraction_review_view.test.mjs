import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { htmlExtractionReviewVectors } from './helpers/html_extraction_review_vectors.mjs';
const View=loadTsx(new URL('../src/html-extraction-review-view.tsx',import.meta.url)).HtmlExtractionReviewView;
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-html-extraction-review.json',import.meta.url),'utf8'));
const vectors=htmlExtractionReviewVectors();
const render=input=>renderToStaticMarkup(View({input}));

test('actual passive view keeps proposal, selected earlier/current text and historical custody together',t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('No network'));
  const html=render(fixture());
  for(const phrase of['Unverified proposed assertion','An invented source statement remains unverified.', 'Earlier invented wording.',
    'Original outer-element hash','Derived parsed-text hash','Immutable preparation time','Reported storage time','Report observation time',
    'not an editorial review date','synthetic full receipts','not evidence of an actual database write','server authentication',
    'not reverified here','Source qualification and rights are not established','No review decision or publication authority'])assert.ok(html.includes(phrase),phrase);
  for(const sha of[fixture().artifact.receipt_sha256,fixture().artifact.output_sha256,fixture().originals.previous.metadata_sha256])assert.ok(html.includes(sha));
  assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|href="https?:/);
});

test('proposal and raw source-date text are escaped and never interpreted as HTML or dates',()=>{
  const html=render(vectors.markup);
  assert.match(html,/&lt;script&gt;alert\(&quot;quoted&quot;\)&lt;\/script&gt;/);
  assert.match(html,/&lt;img src=x onerror=quoted&gt;/);assert.match(html,/&lt;b&gt;unspecified date&lt;\/b&gt;/);
  assert.match(html,/Source date text, not interpreted/);assert.doesNotMatch(html,/<script|<img|<b>unspecified|dangerouslySetInnerHTML|srcdoc=/i);
  assert.match(render(vectors.date_none),/No source date text was supplied/);
});

test('one embedded inspection preserves unique internal IDs and exact source passage return links',()=>{
  const html=render(fixture());
  assert.equal((html.match(/id="html-inspection-heading"/g)??[]).length,1);
  assert.equal((html.match(/id="html-extraction-review-heading"/g)??[]).length,1);
  for(const index of[1,2]){
    assert.equal((html.match(new RegExp(`id="html-passage-${index}"`,'g'))??[]).length,1);
    assert.ok(html.includes(`href="#html-passage-${index}"`));
  }
  assert.match(html,/supplied-input storage as not observed/);assert.match(html,/illustrative custody only/);
});

test('invalid outer artifact, nested selection or proposal withholds every partial private body',()=>{
  for(const mutate of[r=>r.proposal.locator='context:one',r=>r.artifact.request_bytes++,r=>r.inspection.current.passages[0].text='PRIVATE_CANARY',r=>r.proposal.review_state='approved']){
    const r=fixture();mutate(r);r.proposal.proposed_assertion='PRIVATE_CANARY assertion remains private.';
    const html=render(r);assert.match(html,/HTML extraction review unavailable/);
    assert.doesNotMatch(html,/PRIVATE_CANARY|Earlier invented wording|Historical artifact references|Result operation|Selected HTML text comparison/);
  }
});
