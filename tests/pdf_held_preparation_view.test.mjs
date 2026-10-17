import assert from 'node:assert/strict';import test from 'node:test';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{renderToStaticMarkup}from'react-dom/server';import{loadTsx}from'./helpers/tsx_loader.mjs';
import{canonicalProposalJson as canonical}from'../src/operator-proposal-capture.ts';
const View=loadTsx(new URL('../src/pdf-held-preparation-view.tsx',import.meta.url)).PdfHeldPreparationView;
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-held-preparation.json',import.meta.url),'utf8'));
const render=x=>renderToStaticMarkup(View(x)),sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
test('passive view distinguishes proposed support, explicit issue basis and all separate historical times',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No fetch'));const f=fixture(),p=JSON.parse(f.bundle.provenanceJson),html=render(f);
 for(const text of ['Detached PDF candidate','not been captured','not a replacement issue edition','Explicit empty head','Proposed only; factual support is not assessed','Physical page 1','not original PDF byte offsets','unreviewed','Preserved four-part preparation',p.recorded_observed_at,p.artifact_prepared_at,p.artifact_stored_at,p.prepared_at])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|<embed|href="https?:|%PDF-|base64/);
});
test('any refused bundle withholds assertion, identity, original context and hashes together',()=>{const f=fixture();f.bundle.provenanceJson+='PRIVATE';const html=render(f);assert.ok(html.includes('preparation unavailable'));assert.doesNotMatch(html,/PRIVATE|CLI_CURRENT|70000000|[a-f0-9]{64}/);});
test('source and candidate markup stay escaped ordinary text without executable links',()=>{
 const f=fixture(),p=JSON.parse(f.bundle.provenanceJson),payload=JSON.parse(f.bundle.payloadJson),s='<script>PRIVATE</script> & <img src=x onerror=evil>.';
 p.independent_context.support.assertion=s;payload.snapshot.claims[0].assertion=s;f.bundle.payloadJson=canonical(payload);p.payload_sha256=sha(f.bundle.payloadJson);p.context_sha256=sha(canonical(p.independent_context));f.bundle.provenanceJson=canonical(p);
 f.expected.payloadSha256=sha(f.bundle.payloadJson);f.expected.provenanceSha256=sha(f.bundle.provenanceJson);const html=render(f);assert.ok(html.includes('&lt;script&gt;PRIVATE&lt;/script&gt;'));assert.doesNotMatch(html,/<script|<img|href="https?:/);
});
