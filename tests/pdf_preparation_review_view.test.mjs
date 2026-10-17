import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-stored-pdf-preparation-review.json',import.meta.url),'utf8'));
const View=loadTsx(new URL('../src/pdf-preparation-review-view.tsx',import.meta.url)).PdfPreparationReviewView;
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const render=f=>renderToStaticMarkup(View(f));
test('saved preparation shows separate storage and historical times with no write or external action',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No fetch'));const f=fixture(),v=JSON.parse(f.reportJson),html=render(f);
 for(const text of ['Saved PDF preparation','does not authenticate storage','does not capture it against an issue','Preparation operation','Supplied preparation stored','Later report observation','does not renew the old held decision',v.preparation.artifact_id,v.preparation.prepared_at,v.preparation.stored_at,v.observed_at,'Detached PDF candidate','not been captured','Proposed only; factual support is not assessed'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|<embed|href="https?:|%PDF-|base64/);
});
test('refused report hides candidate and every native identity together',()=>{
 const f=fixture();f.expected.preparationArtifactId='b2000000-0000-4000-8000-000000000099';const html=render(f);
 assert.ok(html.includes('Saved PDF preparation unavailable'));assert.doesNotMatch(html,/60735a11|c17b4e69|invented condition|[a-f0-9]{64}/);
});
test('source and proposed markup remain escaped through both admitted layers',()=>{
 const f=fixture(),r=JSON.parse(f.reportJson),p=JSON.parse(r.parts.provenance_json),payload=JSON.parse(r.parts.payload_json),i=JSON.parse(r.intent_json),s='<script>PRIVATE</script> & <img src=x onerror=evil>.';
 p.independent_context.support.assertion=s;payload.snapshot.claims[0].assertion=s;r.parts.payload_json=canonical(payload);p.payload_sha256=sha(r.parts.payload_json);p.context_sha256=sha(canonical(p.independent_context));r.parts.provenance_json=canonical(p);
 i.payload_sha256=sha(r.parts.payload_json);i.provenance_sha256=sha(r.parts.provenance_json);r.intent_json=canonical(i);r.preparation.intent_sha256=sha(r.intent_json);f.expected.preparationIntentJson=r.intent_json;f.reportJson=canonical(r);f.expected.reportSha256=sha(f.reportJson);
 const html=render(f);assert.ok(html.includes('&lt;script&gt;PRIVATE&lt;/script&gt;'));assert.doesNotMatch(html,/<script|<img|href="https?:/);
});
