import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {preparePdfInitialCandidateCaptureForWork} from '../src/server/pdf-initial-candidate-capture.ts';
const View=loadTsx(new URL('../src/pdf-initial-candidate-review-view.tsx',import.meta.url)).PdfInitialCandidateReviewView;
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const after=(raw,n)=>new Date(Date.parse(raw)+n*1000).toISOString().replace(/\.\d{3}Z$/,'.000000Z');
const b64=s=>Buffer.from(s,'utf8').toString('base64');
// The saved preparation comes from the separately retained invented producer.
// This NEW capture envelope is manually invented to test passive rendering.
// No database, worker, original PDF inspection or native receipt is executed.
function input(edit){
 const f=JSON.parse(readFileSync(new URL('../fixtures/fictional-stored-pdf-preparation-review.json',import.meta.url),'utf8'));
 if(edit)edit(f);
 const r=JSON.parse(f.reportJson),selection=JSON.parse(r.parts.selection_json),proof=JSON.parse(r.parts.provenance_json);
 const work={runId:selection.runId,requestFingerprint:'a'.repeat(64),workClaimId:'c3000000-0000-4000-8000-000000000001'};
 const prepared=preparePdfInitialCandidateCaptureForWork(work,f.reportJson,f.expected),intent=JSON.parse(prepared.intentJson),capturedAt=after(r.observed_at,1),storedAt=after(capturedAt,1);
 const current=proof.current;
 const native={schema_version:1,kind:'invented_pdf_initial_candidate_capture_stored',capture_id:intent.capture_id,preparation_operation_id:intent.preparation_operation_id,stored_at:storedAt,intent_base64:b64(prepared.intentJson),report_base64:b64(f.reportJson),capture:{captureId:selection.captureId,runId:selection.runId,decisionId:selection.decisionId,issueId:selection.issueId,basePublicationId:null,baseHeadChangedAt:null,baseContentSha256:null,proposalSha256:sha(r.parts.payload_json),capturedAt,sourceReceipts:[{sourceVersionId:current.source_version_id,contentSha256:current.content_sha256,languageCode:current.language_code,retrievedAt:current.retrieved_at}]}};
 return {receipt:Buffer.from(canonical(native),'utf8'),intentJson:prepared.intentJson,expected:f.expected,observedAt:after(storedAt,1),native,report:r};
}
const render=f=>renderToStaticMarkup(View(f));
test('initial PDF capture shows later association separately from the exact older detached preparation',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No fetch'));
 const f=input(),html=render(f);
 for(const text of ['PDF candidate capture','initially empty issue head','Historical candidate captured','PDF companion stored','Later receipt observation','earlier, uncaptured record','separate supplied receipt above records the later association','does not open the original PDF','does not authenticate a source',f.native.capture_id,f.native.capture.capturedAt,f.native.stored_at,f.observedAt,f.report.preparation.artifact_id,f.report.preparation.prepared_at,'Detached PDF candidate','Proposed only; factual support is not assessed'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|<embed|href="https?:|%PDF-|base64/);
});
test('refused capture hides source and preparation identities with the candidate',()=>{
 for(const mutate of [f=>{f.expected={...f.expected,reportSha256:'0'.repeat(64)};},f=>{f.receipt=Buffer.from('{');},f=>{f.observedAt=f.report.observed_at;},f=>{f.intentJson+=' ';}]){
  const f=input();mutate(f);const html=render(f);
  assert.ok(html.includes('PDF candidate capture unavailable'));assert.doesNotMatch(html,/c1000000|60735a11|Detached PDF|[a-f0-9]{64}|<time|<code/);
 }
});
test('proposed untrusted wording is escaped after complete captured receipt admission',()=>{
 const f=input(f=>{
  const r=JSON.parse(f.reportJson),p=JSON.parse(r.parts.provenance_json),payload=JSON.parse(r.parts.payload_json),i=JSON.parse(r.intent_json),s='<script>PRIVATE</script> & <img src=x onerror=evil>.';
  p.independent_context.support.assertion=s;payload.snapshot.claims[0].assertion=s;r.parts.payload_json=canonical(payload);p.payload_sha256=sha(r.parts.payload_json);p.context_sha256=sha(canonical(p.independent_context));r.parts.provenance_json=canonical(p);
  i.payload_sha256=sha(r.parts.payload_json);i.provenance_sha256=sha(r.parts.provenance_json);r.intent_json=canonical(i);r.preparation.intent_sha256=sha(r.intent_json);f.expected.preparationIntentJson=r.intent_json;f.reportJson=canonical(r);f.expected.reportSha256=sha(f.reportJson);
 });
 const html=render(f);assert.ok(html.includes('&lt;script&gt;PRIVATE&lt;/script&gt;'));assert.doesNotMatch(html,/<script|<img|href="https?:/);
});
