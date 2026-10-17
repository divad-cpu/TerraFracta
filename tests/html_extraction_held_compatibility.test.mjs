import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { htmlHeldProposalVectors } from './helpers/html_held_proposal_vectors.mjs';
import { canonicalProposalJson } from '../src/operator-proposal-capture.ts';
import { encodeProposalCapture, decodeProposalCapture } from '../src/server/proposal-capture.ts';
import { prepareProposalCaptureCommand } from '../src/server/proposal-capture-command.ts';
import { prepareDetachedExtractionProposalCapture as plainAdmission } from '../src/server/private-extraction-held-proposal.ts';
const rows=htmlHeldProposalVectors();
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');

test('new HTML full-receipt vectors match the existing strict review-only encoder exactly',()=>{
  for(const row of rows){const p=JSON.parse(row.payloadJson),proof=JSON.parse(row.provenanceJson),selection=JSON.parse(row.selectionJson);
    const encoded=encodeProposalCapture(p),command=prepareProposalCaptureCommand(selection,p);
    assert.equal(encoded.proposalJson,row.payloadJson);assert.equal(encoded.proposalSha256,proof.payload_sha256);
    assert.equal(command.values[5],row.payloadJson);assert.deepEqual(decodeProposalCapture(row.payloadJson,proof.payload_sha256),p);
    assert.equal(p.snapshot.claims.length,1);assert.equal(p.kind,'review_only');assert.equal(p.conflictCoverage,'not_recorded');
    assert.equal(proof.kind,'detached_html_extraction_proposal');assert.equal(proof.snapshot_intent,'single_claim_technical_review_not_issue_replacement');
    assert.equal(sha(canonicalProposalJson(proof.independent_context)),proof.context_sha256);assert.equal(sha(row.contextJson),proof.supplied_context_sha256);
    assert.equal(sha(row.selectionJson),proof.selection_sha256);assert.equal(proof.current.adapter_identity,'terrafracta-selected-html-parsed-text/v1');
    assert.notEqual(proof.current.artifact_id,proof.previous.artifact_id);assert.notEqual(proof.current.receipt_sha256,proof.previous.receipt_sha256);
  }
});
test('explicit empty and known heads remain independent of the earlier source original',()=>{
  const empty=rows.find(r=>r.name==='empty-head'),known=rows.find(r=>r.name==='known-head');
  assert.equal(JSON.parse(empty.selectionJson).basePublicationId,null);
  const p=JSON.parse(known.provenanceJson);assert.equal(JSON.parse(known.selectionJson).basePublicationId,p.independent_context.issue.head.publication_id);
  assert.notEqual(p.independent_context.issue.head.publication_id,p.previous.artifact_id);
});
test('six hundred scalars and unparsed model date preserve proposed support and unreviewed translation',()=>{
  const row=rows.find(r=>r.name==='unicode-assertion'),payload=JSON.parse(row.payloadJson),proof=JSON.parse(row.provenanceJson);
  assert.equal(payload.snapshot.claims[0].assertion,'🙂'.repeat(600));assert.equal(proof.source_date_text,'Raw source date\n\tstill unparsed');
  assert.equal(payload.snapshot.claims[0].evidence[0].sourcePublishedOn,null);assert.equal(payload.translation.status,'unreviewed');
  assert.equal(proof.independent_context.support.assignment_state,'proposed_only');
});
test('new HTML companion never enters the existing plain-document detached admission',()=>{
  for(const row of rows){const p=JSON.parse(row.provenanceJson);const expected={selection:JSON.parse(row.selectionJson),provenanceSha256:sha(row.provenanceJson),
    artifactOperationId:p.artifact.operation_id,artifactId:p.artifact.artifact_id,requestSha256:p.artifact.request_sha256,outputSha256:p.artifact.output_sha256,claimId:p.claim_id};
    assert.throws(()=>plainAdmission({payloadJson:row.payloadJson,selectionJson:row.selectionJson,provenanceJson:row.provenanceJson},expected),/^Error: private_extraction_held_preparation_unavailable$/);
    const command=prepareProposalCaptureCommand(expected.selection,JSON.parse(row.payloadJson));
    assert.equal(command.values.includes(row.provenanceJson),false);assert.equal(command.values.includes(row.contextJson),false);
  }
});
