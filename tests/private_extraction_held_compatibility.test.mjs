import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalProposalJson} from '../src/operator-proposal-capture.ts';
import {encodeProposalCapture,decodeProposalCapture} from '../src/server/proposal-capture.ts';
import {prepareProposalCaptureCommand} from '../src/server/proposal-capture-command.ts';
import {prepareWorkProposalCapture} from '../src/server/proposal-work-command.ts';
const vectors=JSON.parse(readFileSync(new URL('../fixtures/fictional-private-extraction-held.json',import.meta.url),'utf8')).cases;
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');

test('three real full-original Python vectors retain exact existing canonical payload and provenance across languages',()=>{
 for(const row of vectors){
  const payload=JSON.parse(row.payloadJson),selection=JSON.parse(row.selectionJson),proof=JSON.parse(row.provenanceJson);
  const encoded=encodeProposalCapture(payload),command=prepareProposalCaptureCommand(selection,payload);
  assert.equal(proof.snapshot_intent,'single_claim_technical_review_not_issue_replacement');
  assert.equal(proof.independent_context.snapshot_intent,proof.snapshot_intent);
  assert.equal(sha(canonicalProposalJson(proof.independent_context)),proof.context_sha256);
  assert.equal(encoded.proposalJson,row.payloadJson);assert.equal(encoded.proposalSha256,proof.payload_sha256);
  assert.equal(sha(row.selectionJson),proof.selection_sha256);assert.equal(command.values[5],row.payloadJson);
  assert.equal(proof.artifact.output_sha256,proof.independent_context.artifact.output_sha256);
  assert.equal(proof.claim_id,payload.snapshot.claims[0].id);assert.equal(proof.independent_context.content.capture_id,selection.captureId);
  assert.equal(proof.independent_context.held.run_id,selection.runId);assert.equal(proof.independent_context.held.decision_id,selection.decisionId);
  assert.equal(proof.independent_context.issue.issue_id,selection.issueId);
  assert.equal(proof.independent_context.issue.head.publication_id,selection.basePublicationId);
  assert.equal(proof.independent_context.support.assignment_state,'proposed_only');
  assert.equal(proof.evidence_state,'unverified_not_captured_no_durable_association');
  assert.deepEqual(decodeProposalCapture(row.payloadJson,proof.payload_sha256),payload);
 }
});
test('pure existing work command preserves payload scope but has no durable private-artifact provenance slot',()=>{
 for(const row of vectors){const selection=JSON.parse(row.selectionJson),payload=JSON.parse(row.payloadJson),proof=JSON.parse(row.provenanceJson);
  const work={runId:selection.runId,requestFingerprint:'a'.repeat(64),workClaimId:'00000000-0000-4000-8000-000000000711'};
  const command=prepareWorkProposalCapture(work,selection,payload);
  assert.equal(command.values.length,8);assert.equal(command.values[7],row.payloadJson);
  assert.equal(command.capture.proposalSha256,proof.payload_sha256);assert.equal(command.work.runId,selection.runId);
  assert.equal(command.values.includes(proof.artifact.operation_id),false);
  assert.equal(command.values.includes(row.provenanceJson),false);
  assert.throws(()=>prepareWorkProposalCapture({...work,runId:'00000000-0000-4000-8000-000000000799'},selection,payload));
 }
});
test('raw model date and six-hundred scalar assertion stay exact without support or translation clearance',()=>{
 const row=vectors.find(v=>v.name==='unicode-assertion'),payload=JSON.parse(row.payloadJson),proof=JSON.parse(row.provenanceJson);
 assert.equal(payload.snapshot.claims[0].assertion,'🙂'.repeat(600));assert.equal(proof.source_date_text,'Raw date\n\tvalue');
 assert.equal(payload.snapshot.claims[0].evidence[0].sourcePublishedOn,null);
 assert.notEqual(payload.snapshot.claims[0].periodLabel,proof.source_date_text);assert.equal(payload.translation.status,'unreviewed');
 assert.equal(payload.conflictCoverage,'not_recorded');
 payload.snapshot.claims[0].assertion=' '+payload.snapshot.claims[0].assertion;
 assert.throws(()=>encodeProposalCapture(payload));
});

const {prepareDetachedExtractionProposalCapture:admit}=await import('../src/server/private-extraction-held-proposal.ts');
function expected(row){const p=JSON.parse(row.provenanceJson);return{selection:JSON.parse(row.selectionJson),provenanceSha256:sha(row.provenanceJson),
 artifactOperationId:p.artifact.operation_id,artifactId:p.artifact.artifact_id,requestSha256:p.artifact.request_sha256,outputSha256:p.artifact.output_sha256,claimId:p.claim_id};}
function bundle(row){return{payloadJson:row.payloadJson,selectionJson:row.selectionJson,provenanceJson:row.provenanceJson};}
test('real detached admission keeps the exact companion with all three unexecuted capture preparations',()=>{
 for(const row of vectors){const out=admit(bundle(row),expected(row));assert.ok(Object.isFrozen(out));
  assert.equal(out.provenanceJson,row.provenanceJson);assert.equal(out.provenanceSha256,sha(row.provenanceJson));
  assert.equal(out.capturePreparation.values[5],row.payloadJson);assert.equal(out.capturePreparation.values.length,6);
  assert.equal(out.snapshotIntent,'single_claim_technical_review_not_issue_replacement');assert.equal(out.evidenceState,'invented_unverified_detached_not_captured');
 }
});
test('detached admission refuses swapped companions, foreign expected identities, normalization and changed intent with private diagnostics',()=>{
 const row=vectors[0],other=vectors[1],b=bundle(row),e=expected(row);
 const bad=[()=>admit({...b,provenanceJson:other.provenanceJson},e),()=>admit({...b,payloadJson:b.payloadJson+' '},e),
  ()=>admit({...b,selectionJson:b.selectionJson+' '},e),()=>admit(b,{...e,artifactOperationId:'00000000-0000-4000-8000-000000000799'}),
  ()=>admit(b,{...e,artifactId:'00000000-0000-4000-8000-000000000799'}),()=>admit(b,{...e,requestSha256:'f'.repeat(64)}),
  ()=>admit(b,{...e,outputSha256:'f'.repeat(64)}),()=>admit(b,{...e,claimId:'00000000-0000-4000-8000-000000000799'}),
  ()=>admit(b,{...e,selection:{...e.selection,issueId:'00000000-0000-4000-8000-000000000799'}}),
  ()=>admit({...b,provenanceJson:'PRIVATE /home/secret'},e)];
 const p=JSON.parse(row.provenanceJson);delete p.snapshot_intent;const raw=canonicalProposalJson(p);
 bad.push(()=>admit({...b,provenanceJson:raw},{...e,provenanceSha256:sha(raw)}));
 for(const run of bad)assert.throws(run,/^Error: private_extraction_held_preparation_unavailable$/);
});

test('coherently rehashed internally contradictory claim, support and whole-issue bundles still refuse',()=>{
 const row=vectors[0];
 for(const mutate of [
  (payload,p)=>payload.snapshot.claims[0].id='00000000-0000-4000-8000-000000000799',
  (payload,p)=>payload.snapshot.claims.push({...payload.snapshot.claims[0],id:'00000000-0000-4000-8000-000000000799'}),
  (payload,p)=>payload.snapshot.claims[0].assertion='Different internally contradictory assertion.',
  (payload,p)=>payload.snapshot.claims[0].type='funding',
  (payload,p)=>payload.snapshot.claims[0].periodLabel='Different explicit period',
  (payload,p)=>payload.snapshot.issueSlug='foreign-issue',
  (payload,p)=>payload.snapshot.claims[0].evidence[0].publisher='Foreign publisher',
  (payload,p)=>payload.snapshot.claims[0].evidence[0].locator='section:other',
  (payload,p)=>payload.translation.status='not_required',
  (payload,p)=>p.independent_context.support.content_sha256='f'.repeat(64),
  (payload,p)=>p.independent_context.held.item_key='foreign-item',
  (payload,p)=>{delete p.independent_context.held.item_key;delete p.current.item_key;},
  (payload,p)=>{delete p.independent_context.issue.jurisdiction_id;delete p.independent_context.held.jurisdiction_id;},
  (payload,p)=>{p.independent_context.held.item_key=7;p.current.item_key=7;}
 ]){
  const payload=JSON.parse(row.payloadJson),p=JSON.parse(row.provenanceJson);mutate(payload,p);
  const payloadJson=canonicalProposalJson(payload);p.payload_sha256=sha(payloadJson);
  p.context_sha256=sha(canonicalProposalJson(p.independent_context));const provenanceJson=canonicalProposalJson(p);
  assert.throws(()=>admit({...bundle(row),payloadJson,provenanceJson},{...expected(row),provenanceSha256:sha(provenanceJson)}),
   /^Error: private_extraction_held_preparation_unavailable$/);
 }
});
