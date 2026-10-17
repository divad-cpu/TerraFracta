import {createHash} from 'node:crypto';
import {pdfHeldProposalVectors} from './pdf_held_proposal_vectors.mjs';
import {canonicalProposalJson as canonical} from '../../src/operator-proposal-capture.ts';
export const sha=raw=>createHash('sha256').update(raw,'utf8').digest('hex');
export const instantAfter=(raw,seconds)=>new Date(Date.parse(raw)+1000*seconds).toISOString().replace(/\.\d{3}Z$/,'.000000Z');
// Native-shaped envelopes below are manually invented contracts. Only the
// reused three underlying four-part vectors are actual Python producer output;
// this helper does not execute SQL or prove a stored preparation receipt.
export function pdfPreparationReviewFixtures(){return pdfHeldProposalVectors().map(row=>{
 const proof=JSON.parse(row.provenanceJson),artifact=proof.artifact;
 const parts={payload_json:row.payloadJson,selection_json:row.selectionJson,provenance_json:row.provenanceJson,context_json:row.contextJson};
 const metadata={schema_version:1,kind:'invented_detached_pdf_proposal_preparation',operation_id:'80000000-0000-4000-8000-000000000001',
  extraction_operation_id:artifact.operation_id,extraction_artifact_id:artifact.artifact_id,extraction_request_sha256:artifact.request_sha256,extraction_output_sha256:artifact.output_sha256,
  payload_sha256:sha(parts.payload_json),selection_sha256:sha(parts.selection_json),provenance_sha256:sha(parts.provenance_json),context_raw_sha256:sha(parts.context_json),prepared_at:proof.prepared_at};
 const intent=canonical(metadata),stored=instantAfter(proof.prepared_at,1),observed=instantAfter(stored,1);
 const report={schema_version:1,kind:'private_stored_pdf_preparation_review_report',scope:'invented_supplied_pdf_custody_only',review_state:'unverified',observed_at:observed,
  preparation:{operation_id:metadata.operation_id,artifact_id:'80000000-0000-4000-8000-000000000002',result_operation_id:artifact.operation_id,prepared_at:proof.prepared_at,stored_at:stored,receipt_sha256:'a'.repeat(64),intent_sha256:sha(intent),packet_sha256:'b'.repeat(64)},intent_json:intent,parts,
  limits:{original_pdf_included:false,request_body_included:false,output_body_included:false,full_result_receipt_included:false,full_preparation_receipt_included:false,source_authenticated:false,current_qualification_established:false,held_capture_observed:false,current_publication_observed:false,publication_authorized:false}};
 const raw=canonical(report),expected={reportSha256:sha(raw),preparationIntentJson:intent,preparationArtifactId:report.preparation.artifact_id,preparationStoredAt:stored,observedAt:observed};
 return {name:row.name,report,raw,expected};
});}
export function resignReport(f){f.raw=canonical(f.report);f.expected.reportSha256=sha(f.raw);return f;}
export function resignIntent(f,metadata){f.expected.preparationIntentJson=canonical(metadata);f.report.intent_json=f.expected.preparationIntentJson;f.report.preparation.intent_sha256=sha(f.report.intent_json);return resignReport(f);}
