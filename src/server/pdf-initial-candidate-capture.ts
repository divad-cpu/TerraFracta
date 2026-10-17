import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalProposalJson as canonical,capturedProposalEnvelopeSchema } from "../operator-proposal-capture.ts";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";
import { pdfPreparationReviewReport } from "./pdf-preparation-review-report.ts";
import { prepareWorkProposalCapture } from "./proposal-work-command.ts";
import { proposalCaptureSelectionSchema } from "./proposal-capture-command.ts";

// PDF initial SINGLE candidate only. Preserves binary-original and whole-derived-page provenance. No whole-issue replacement, publication,
// target, transport, principal, work acquisition or automatic retry is supplied.
// Fixed SQL names describe a future association contract; nothing is installed.
const uuid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),instant=z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s=>!s.startsWith("0000-")),hash=z.string().regex(/^[a-f0-9]{64}$/),sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const INTENT="single_claim_technical_review_not_issue_replacement";
const captureUuid=proposalCaptureSelectionSchema.shape.captureId;
const intentSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_pdf_initial_candidate_capture"),snapshot_intent:z.literal(INTENT),capture_id:captureUuid,run_id:captureUuid,decision_id:captureUuid,issue_id:captureUuid,base_publication_id:z.null(),preparation_operation_id:uuid,preparation_artifact_id:uuid,preparation_intent_sha256:hash,preparation_full_receipt_sha256:hash,report_sha256:hash,part_sha256:z.array(hash).length(4),preparation_observed_at:instant});
const sourceReceipts=capturedProposalEnvelopeSchema.options[0].shape.sourceReceipts;
const nativeSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_pdf_initial_candidate_capture_stored"),capture_id:captureUuid,preparation_operation_id:uuid,stored_at:instant,intent_base64:z.string().max(5464),report_base64:z.string().max(349528),capture:z.strictObject({captureId:captureUuid,runId:captureUuid,decisionId:captureUuid,issueId:captureUuid,basePublicationId:z.null(),baseHeadChangedAt:z.null(),baseContentSha256:z.null(),proposalSha256:hash,capturedAt:instant,sourceReceipts})});
export const PDF_INITIAL_CANDIDATE_CAPTURE_SQL="SELECT tf_pdf_initial_candidate.capture_for_work($1::uuid,$2::text,$3::uuid,decode($4::text,'base64'),decode($5::text,'base64'))::text AS capture";
export const PDF_INITIAL_CANDIDATE_CAPTURE_READ_SQL="SELECT tf_pdf_initial_candidate.capture_receipt($1::uuid)::text AS capture";
const fail=()=>Error("pdf_initial_candidate_capture_unavailable");
function scalar(s:string){return !/[\ud800-\udfff]/u.test(s);}
function own(value:unknown,keys:readonly string[]){
 if(value===null||typeof value!=="object"||Array.isArray(value))throw fail();
 const check=()=>{const actual=Reflect.ownKeys(value);if(actual.length!==keys.length||actual.some(k=>typeof k!=="string"||!keys.includes(k)||!Object.getOwnPropertyDescriptor(value,k)?.enumerable))throw fail();};
 check();const captured=captureOwnEnumerableSelectors(value,keys);if(captured===null)throw fail();check();return captured;
}
function report(input:unknown,expected:unknown){
 if(typeof input!=="string"||!scalar(input)||Buffer.byteLength(input,"utf8")<2||Buffer.byteLength(input,"utf8")>262144)throw fail();
 const r=pdfPreparationReviewReport(input,expected);if(r===null)throw fail();
 const c=r.candidate,h=c.proof.independent_context.issue.head,p=c.payload;
 if(c.selection.basePublicationId!==null||h.publication_id!==null||h.content_sha256!==null||h.changed_at!==null||p.snapshot.claims.length!==1||p.snapshot.claims[0]!.evidence.length!==1||p.dependencyManifest.sourceVersionIds.length!==1||p.conflictCoverage!=="not_recorded"||!["unreviewed","not_recorded"].includes(p.translation.status))throw fail();
 return {raw:input,expected:r.expected,value:r,payload:p};
}
function intent(input:unknown){if(typeof input!=="string"||!scalar(input)||Buffer.byteLength(input)>4096)throw fail();const i=intentSchema.parse(JSON.parse(input));if(canonical(i)!==input)throw fail();return i;}
function b64(s:string){return Buffer.from(s,"utf8").toString("base64");}
function decode(s:string,max:number){if(s.length<4||s.length>4*Math.ceil(max/3)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw fail();const b=Buffer.from(s,"base64");if(b.length<1||b.length>max||b.toString("base64")!==s)throw fail();const text=new TextDecoder("utf8",{fatal:true,ignoreBOM:true}).decode(b);if(!scalar(text)||!Buffer.from(text).equals(b))throw fail();return text;}
function identity(r:ReturnType<typeof report>){const v=r.value,m=JSON.parse(v.report.intent_json),s=v.candidate.selection;return intentSchema.parse({schema_version:1,kind:"invented_pdf_initial_candidate_capture",snapshot_intent:INTENT,capture_id:s.captureId,run_id:s.runId,decision_id:s.decisionId,issue_id:s.issueId,base_publication_id:null,preparation_operation_id:v.report.preparation.operation_id,preparation_artifact_id:v.report.preparation.artifact_id,preparation_intent_sha256:sha(r.expected.preparationIntentJson),preparation_full_receipt_sha256:v.report.preparation.receipt_sha256,report_sha256:r.expected.reportSha256,part_sha256:[m.payload_sha256,m.selection_sha256,m.provenance_sha256,m.context_raw_sha256],preparation_observed_at:v.report.observed_at});}
export function preparePdfInitialCandidateCaptureForWork(work:unknown,rawReport:unknown,independentExpectedReport:unknown){
 try{const r=report(rawReport,independentExpectedReport),w=own(work,["runId","requestFingerprint","workClaimId"]),prepared=prepareWorkProposalCapture(w,r.value.candidate.selection,r.payload),intentJson=canonical(identity(r));if(Buffer.byteLength(intentJson)>4096)throw fail();const values=Object.freeze([prepared.work.runId,prepared.work.requestFingerprint,prepared.work.workClaimId,b64(intentJson),b64(r.raw)]);
 // Reuse the conservative complete-envelope bound of existing initial contracts.
 // A larger admitted PDF preparation report never enlarges the native
 // receipt budget. Later SQL must recheck actual bytes before COMMIT as well.
 const receiptEstimate=Buffer.byteLength(canonical({intent_base64:values[3],report_base64:values[4]}))+8192+320;
 if(receiptEstimate>131072)throw fail();return Object.freeze({sql:PDF_INITIAL_CANDIDATE_CAPTURE_SQL,values,receiptEstimate,work:prepared.work,intentJson,intentSha256:sha(intentJson),reportJson:r.raw,expected:Object.freeze(r.expected),evidenceState:"invented_pdf_initial_single_candidate_unexecuted_not_whole_issue_or_publication" as const});}catch{throw fail();}
}
export function preparePdfInitialCandidateCaptureRead(retainedIntentJson:unknown){try{const i=intent(retainedIntentJson);return Object.freeze({sql:PDF_INITIAL_CANDIDATE_CAPTURE_READ_SQL,values:Object.freeze([i.capture_id])});}catch{throw fail();}}
function frozen<T>(v:T):Readonly<T>{if(v!==null&&typeof v==="object"){for(const child of Object.values(v))frozen(child);Object.freeze(v);}return v;}
export function parseStoredPdfInitialCandidateCapture(raw:unknown,retainedIntentJson:unknown,independentExpectedReport:unknown,trustedObservedAt:unknown){
 try{const i=intent(retainedIntentJson),at=instant.parse(trustedObservedAt),bytes=new Uint8Array(131072),size=copyNativeByteChunk(bytes,0,raw);if(size<2)throw fail();const text=new TextDecoder("utf8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,size));if(!scalar(text))throw fail();const n=nativeSchema.parse(JSON.parse(text)),keys=text.match(/"(?:[^"\\]|\\.)*"\s*:/g)??[];if(keys.length!==18+4*n.capture.sourceReceipts.length||keys.some(key=>{const spelling=key.slice(0,key.lastIndexOf(":")).trim();return JSON.stringify(JSON.parse(spelling))!==spelling;}))throw fail();
  const nativeIntent=decode(n.intent_base64,4096),rawReport=decode(n.report_base64,262144),r=report(rawReport,independentExpectedReport);if(nativeIntent!==retainedIntentJson||canonical(identity(r))!==retainedIntentJson||n.capture_id!==i.capture_id||n.preparation_operation_id!==i.preparation_operation_id)throw fail();
  const c=n.capture,s=r.value.candidate.selection,e=r.value.candidate.proof.current,reference=r.value.candidate.payload.snapshot.claims[0]!.evidence[0]!;
  if(c.captureId!==i.capture_id||c.runId!==i.run_id||c.decisionId!==i.decision_id||c.issueId!==i.issue_id||c.proposalSha256!==r.value.identity.payloadSha256||c.sourceReceipts.length!==1||c.sourceReceipts[0]!.sourceVersionId!==e.source_version_id||c.sourceReceipts[0]!.contentSha256!==e.content_sha256||c.sourceReceipts[0]!.languageCode!==e.language_code||c.sourceReceipts[0]!.retrievedAt!==e.retrieved_at||reference.sourceVersionId!==e.source_version_id||s.basePublicationId!==null||micros(i.preparation_observed_at)>micros(c.capturedAt)||micros(c.capturedAt)>micros(n.stored_at)||micros(n.stored_at)>micros(at))throw fail();
  return frozen({capture:c,preparation:r.value,reportJson:rawReport,intentJson:nativeIntent,storedAt:n.stored_at,observedAt:at,receiptSha256:createHash("sha256").update(bytes.subarray(0,size)).digest("hex"),evidenceState:"supplied_pdf_initial_candidate_receipt_not_authenticated_or_publication" as const});
 }catch{throw fail();}
}
