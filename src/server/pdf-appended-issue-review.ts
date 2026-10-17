import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalProposalJson, recordedProposalBaseSchema, proposalCapturePayloadSchema } from "../operator-proposal-capture.ts";
import { pdfPreparationReviewReport } from "./pdf-preparation-review-report.ts";
import { admitIssueReviewStructure } from "./issue-review-composition.ts";

// Strict second-phase syntax/correspondence admission of six supplied parts.
// Hashes/artifact/time are independent selectors, not authentication, original
// PDF inspection, current head/support qualification or permission to capture.
// Original context spelling remains opaque retained identity, as in its port.
const intent="append_only_whole_issue_technical_review_not_publication";
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const instant=z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s=>!s.startsWith("0000-"));
const bytes=(maximum:number)=>z.string().refine(s=>!/[\ud800-\udfff]/u.test(s)&&Buffer.byteLength(s,"utf8")>0&&Buffer.byteLength(s,"utf8")<=maximum);
const contextSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_append_only_issue_context"),snapshot_intent:z.literal(intent),
 baseline:z.strictObject({publication_id:uuid,issue_id:uuid,content_sha256:hash,head_changed_at:instant,head_observed_at:instant}),
 page:z.strictObject({title:recordedProposalBaseSchema.shape.snapshot.shape.title,summary:recordedProposalBaseSchema.shape.snapshot.shape.summary,last_evidence_review_on:z.iso.date().refine(s=>!s.startsWith("0000-"))}),
 review:z.strictObject({conflict_coverage:z.literal("not_recorded"),translation:z.strictObject({display_language:proposalCapturePayloadSchema.shape.translation.shape.displayLanguage,status:z.enum(["not_recorded","unreviewed"])})})});
const bundleSchema=z.strictObject({candidateReportJson:bytes(262144),baselineJson:bytes(24576),canonicalBaselineJson:bytes(24576),contextJson:bytes(32768),proposalJson:bytes(16384),compositionJson:bytes(65536)});
const expectedSchema=z.strictObject({compositionSha256:hash,candidateReportSha256:hash,preparationIntentJson:bytes(4096),baselineSha256:hash,contextSha256:hash,observedAt:instant,preparationArtifactId:uuid,preparationStoredAt:instant});
const proofSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_pdf_appended_issue_review"),scope:z.literal("invented_supplied_full_pdf_receipts_only"),snapshot_intent:z.literal(intent),
 evidence_state:z.literal("unverified_whole_issue_preparation_not_captured_or_publication_qualified"),observed_at:instant,
 candidate_report_sha256:hash,candidate_preparation_intent_sha256:hash,candidate_full_receipt_sha256:hash,candidate_part_sha256:z.array(hash).length(4),
 baseline_sha256:hash,canonical_baseline_sha256:hash,context_raw_sha256:hash,context_sha256:hash,independent_context:contextSchema,
 proposal_sha256:hash,preserved_claim_sha256:z.array(hash).min(1).max(29),appended_claim_sha256:hash,source_manifest_sha256:hash});
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
function canonical(s:string):unknown{const v:unknown=JSON.parse(s);if(canonicalProposalJson(v)!==s)throw Error();return v;}
function same(a:unknown,b:unknown){return canonicalProposalJson(a)===canonicalProposalJson(b);}
function ownStrings(value:unknown,fields:readonly string[]):Record<string,string>{
 if(value===null||typeof value!=="object"||Array.isArray(value))throw Error();
 const proto=Object.getPrototypeOf(value),keys=Reflect.ownKeys(value);
 if(proto!==Object.prototype&&proto!==null||keys.length!==fields.length||keys.some(k=>typeof k!=="string"||!fields.includes(k)))throw Error();
 const copy:Record<string,string>={};
 for(const key of fields){const d=Object.getOwnPropertyDescriptor(value,key);if(!d?.enumerable||!("value"in d)||typeof d.value!=="string")throw Error();copy[key]=d.value;}
 return copy;
}
export function admitPdfAppendedIssueReview(bundle:unknown,expected:unknown){
 try{
  // Snapshot both closed independent channels before any report consumer.
  const b0=ownStrings(bundle,["candidateReportJson","baselineJson","canonicalBaselineJson","contextJson","proposalJson","compositionJson"]),
   e0=ownStrings(expected,["compositionSha256","candidateReportSha256","preparationIntentJson","baselineSha256","contextSha256","observedAt","preparationArtifactId","preparationStoredAt"]);
  const b=bundleSchema.parse(b0),e=expectedSchema.parse(e0);
  if(sha(b.compositionJson)!==e.compositionSha256||sha(b.baselineJson)!==e.baselineSha256||sha(b.contextJson)!==e.contextSha256)throw Error();
  const proof=proofSchema.parse(canonical(b.compositionJson)),parsedContext:unknown=JSON.parse(b.contextJson),context=contextSchema.parse(parsedContext);
  if(!same(parsedContext,context)||!same(context,proof.independent_context)||proof.observed_at!==e.observedAt||
   proof.candidate_report_sha256!==e.candidateReportSha256||proof.candidate_preparation_intent_sha256!==sha(e.preparationIntentJson)||
   proof.baseline_sha256!==e.baselineSha256||proof.canonical_baseline_sha256!==sha(b.canonicalBaselineJson)||proof.context_raw_sha256!==e.contextSha256||
   proof.context_sha256!==sha(canonicalProposalJson(context))||proof.proposal_sha256!==sha(b.proposalJson))throw Error();
  const admitted=pdfPreparationReviewReport(b.candidateReportJson,{reportSha256:e.candidateReportSha256,preparationIntentJson:e.preparationIntentJson,
   preparationArtifactId:e.preparationArtifactId,preparationStoredAt:e.preparationStoredAt,observedAt:e.observedAt});
  if(admitted===null||admitted.candidate.selection.basePublicationId===null||admitted.report.observed_at!==proof.observed_at||
   context.page.last_evidence_review_on>e.observedAt.slice(0,10)||proof.candidate_full_receipt_sha256!==admitted.report.preparation.receipt_sha256||
   !same(proof.candidate_part_sha256,[admitted.identity.payloadSha256,admitted.identity.selectionSha256,admitted.identity.provenanceSha256,admitted.identity.contextSha256]))throw Error();
  const candidate=admitted.candidate,history=candidate.proof.independent_context;
  const structural=admitIssueReviewStructure(b,e.baselineSha256,proof,context,{selection:candidate.selection,snapshot:candidate.payload.snapshot,
   head:history.issue.head,headObservedAt:history.issue.observed_at,language:candidate.proof.current.language_code},true);
  // Validate critical capture identities internally, but never discard the six
  // parts by returning the generic companionless SQL command/values to callers.
  return Object.freeze({bundle:Object.freeze(b),encodedProposal:structural.encoded,selection:structural.capturePreparation.selection,
   compositionSha256:e.compositionSha256,snapshotIntent:intent,baselineClaimCount:structural.baselineClaimCount,appendedClaimCount:1,
   evidenceState:"invented_pdf_unverified_whole_issue_not_captured_or_publication_qualified" as const});
 }catch{throw Error("pdf_appended_issue_review_unavailable");}
}
