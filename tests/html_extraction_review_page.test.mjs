import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/html-extraction-sample/page.tsx',import.meta.url);

test('production, test and unset environments refuse before the evidence consumer',()=>{
  let calls=0;const marker=Error('NOT_FOUND');
  for(const NODE_ENV of[undefined,'production','test']){
    const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:name==='../../../src/html-extraction-review-view.tsx'?{HtmlExtractionReviewView(){calls++;assert.fail('View invoked');}}:undefined,{env:{NODE_ENV}});
    assert.throws(()=>page.default(),error=>error===marker);
  }
  assert.equal(calls,0);
});

test('development fixed illustrative fixture reaches actual passive view and internal return links only',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../fixtures/fictional-html-extraction-review.json',import.meta.url),'utf8'));
  const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){assert.fail('Development refused');}}:name==='../../../fixtures/fictional-html-extraction-review.json'?{default:fixture}:undefined);
  const html=renderToStaticMarkup(page.default());
  assert.equal(page.dynamic,'force-dynamic');assert.deepEqual(page.metadata.robots,{index:false,follow:false});
  assert.match(html,/Synthetic receipts demonstrate/);assert.match(html,/development gate is not authentication/);
  assert.match(html,/Stored HTML extraction review example/);
  for(const path of['/editorial-preview','/editorial-preview/html-sample','/editorial-preview/extraction-sample'])assert.ok(html.includes(`href="${path}"`));
  assert.doesNotMatch(html,/<form|<input|<button|<iframe|<script|href="https?:/);
});
