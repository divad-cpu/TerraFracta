import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {pdfHeldProposalVectors} from './helpers/pdf_held_proposal_vectors.mjs';
import {encodeProposalCapture,decodeProposalCapture} from '../src/server/proposal-capture.ts';
import {prepareDetachedExtractionProposalCapture as plainAdmission} from '../src/server/private-extraction-held-proposal.ts';
const rows=pdfHeldProposalVectors();
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');

test('actual PDF detached payloads match the unchanged generic encoder without dropping their distinct companion',()=>{
 for(const row of rows){
  const p=JSON.parse(row.payloadJson),proof=JSON.parse(row.provenanceJson),encoded=encodeProposalCapture(p);
  assert.equal(encoded.proposalJson,row.payloadJson);assert.equal(encoded.proposalSha256,proof.payload_sha256);
  assert.deepEqual(decodeProposalCapture(row.payloadJson,proof.payload_sha256),p);
  assert.equal(proof.kind,'detached_pdf_extraction_proposal');assert.equal(proof.limits.offset_space,'derived_page_utf8');
  assert.equal(proof.limits.page_index_kind,'physical_1_based');assert.equal(proof.limits.durable_association_included,false);
  assert.equal(proof.selection_sha256,sha(row.selectionJson));assert.equal(proof.supplied_context_sha256,sha(row.contextJson));
  assert.equal(p.kind,'review_only');assert.equal(p.snapshot.claims.length,1);assert.equal(p.conflictCoverage,'not_recorded');
  assert.equal(p.translation.status,'unreviewed');assert.equal(proof.independent_context.support.assignment_state,'proposed_only');
 }
});
test('known head and Unicode proposal are supplied independently and stay lossless',()=>{
 const empty=rows.find(r=>r.name==='empty-head'),known=rows.find(r=>r.name==='known-head'),unicode=rows.find(r=>r.name==='unicode-assertion');
 assert.equal(JSON.parse(empty.selectionJson).basePublicationId,null);
 const p=JSON.parse(known.provenanceJson);assert.equal(JSON.parse(known.selectionJson).basePublicationId,p.independent_context.issue.head.publication_id);
 assert.notEqual(p.independent_context.issue.head.publication_id,p.previous.source_version_id);
 assert.equal(JSON.parse(unicode.payloadJson).snapshot.claims[0].assertion,'🙂'.repeat(600));
});
test('a PDF companion cannot be relabelled as an existing plain preparation or source/support approval',()=>{
 for(const row of rows){const p=JSON.parse(row.provenanceJson),a=p.artifact;
  const expected={selection:JSON.parse(row.selectionJson),provenanceSha256:sha(row.provenanceJson),artifactOperationId:a.operation_id,artifactId:a.artifact_id,requestSha256:a.request_sha256,outputSha256:a.output_sha256,claimId:p.claim_id};
  assert.throws(()=>plainAdmission({payloadJson:row.payloadJson,selectionJson:row.selectionJson,provenanceJson:row.provenanceJson},expected),/^Error: private_extraction_held_preparation_unavailable$/);
  assert.equal(p.evidence_state,'unverified_not_captured_no_durable_association');assert.equal(p.limits.publication_authorized,false);
 }
});
