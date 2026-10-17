import { createHash } from "node:crypto";
import { z } from "zod";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { canonicalProposalJson as canonical,capturedProposalEnvelopeSchema,proposalEvidenceMicros } from "../operator-proposal-capture.ts";
import { proposalCaptureSelectionSchema } from "./proposal-capture-command.ts";
import { admitPdfAppendedIssueReview } from "./pdf-appended-issue-review.ts";
import type { pdfPreparationReviewReport } from "./pdf-preparation-review-report.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";
import { decodeProposalCapture } from "./proposal-capture.ts";

// Pure complete-companion contract. Fixed future SQL is UNINSTALLED: no
// connection, work fence/lease, writer, backend, capture or publication follows.
// Full independent eight-channel expectations remain mandatory on reopening;
// native rows cannot manufacture the preparation intent/artifact/time selector.
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),captureUuid=proposalCaptureSelectionSchema.shape.captureId;
const instant=z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s=>!s.startsWith("0000-")),sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const names=["candidateReportJson","baselineJson","canonicalBaselineJson","contextJson","proposalJson","compositionJson"] as const,limits=[262144,24576,24576,32768,16384,65536];
const expectedSchema=z.strictObject({compositionSha256:hash,candidateReportSha256:hash,preparationIntentJson:z.string().min(1).refine(s=>Buffer.byteLength(s)<=4096&&!/[\ud800-\udfff]/u.test(s)),baselineSha256:hash,contextSha256:hash,observedAt:instant,preparationArtifactId:uuid,preparationStoredAt:instant});
const expectedKeys=["compositionSha256","candidateReportSha256","preparationIntentJson","baselineSha256","contextSha256","observedAt","preparationArtifactId","preparationStoredAt"] as const;
const intentSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_pdf_appended_issue_capture"),snapshot_intent:z.literal("append_only_whole_issue_technical_review_not_publication"),
 capture_id:captureUuid,run_id:captureUuid,decision_id:captureUuid,issue_id:captureUuid,base_publication_id:captureUuid,preparation_operation_id:uuid,preparation_artifact_id:uuid,
 preparation_intent_sha256:hash,preparation_full_receipt_sha256:hash,preparation_stored_at:instant,part_sha256:z.array(hash).length(6),composition_observed_at:instant});
const nativeSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_pdf_appended_issue_capture_stored"),capture_id:captureUuid,preparation_operation_id:uuid,stored_at:instant,
 intent_base64:z.string().max(5464),parts_base64:z.array(z.string().max(349528)).length(6),
 capture:z.strictObject({captureId:captureUuid,runId:captureUuid,decisionId:captureUuid,issueId:captureUuid,basePublicationId:captureUuid,baseHeadChangedAt:instant,baseContentSha256:hash,proposalSha256:hash,capturedAt:instant,sourceReceipts:capturedProposalEnvelopeSchema.options[0].shape.sourceReceipts})});
export const PDF_APPENDED_CAPTURE_SQL="SELECT tf_pdf_review.capture_issue("+Array.from({length:7},(_,i)=>`decode($${i+1}::text,'base64')`).join(",")+")::text AS capture";
export const PDF_APPENDED_CAPTURE_READ_SQL="SELECT tf_pdf_review.capture_receipt($1::uuid)::text AS capture";
const fail=()=>Error("pdf_appended_issue_capture_unavailable");
type PdfReport=NonNullable<ReturnType<typeof pdfPreparationReviewReport>>["report"];
type PdfCurrent=NonNullable<ReturnType<typeof pdfPreparationReviewReport>>["candidate"]["proof"]["current"];
function expected(input:unknown){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw fail();
 const proto=Object.getPrototypeOf(input),keys=Reflect.ownKeys(input);if(proto!==Object.prototype&&proto!==null||keys.length!==expectedKeys.length||keys.some(k=>typeof k!=="string"||!expectedKeys.includes(k as typeof expectedKeys[number])))throw fail();
 const copy:Record<string,string>={};for(const key of expectedKeys){const d=Object.getOwnPropertyDescriptor(input,key);if(!d?.enumerable||!("value"in d)||typeof d.value!=="string")throw fail();copy[key]=d.value;}
 return Object.freeze(expectedSchema.parse(copy));
}
function intent(raw:unknown){if(typeof raw!=="string"||Buffer.byteLength(raw)>4096)throw fail();const i=intentSchema.parse(JSON.parse(raw));if(canonical(i)!==raw)throw fail();return i;}
function b64(raw:string){return Buffer.from(raw,"utf8").toString("base64");}
function unbase64(value:string,limit:number){
 if(value.length<4||value.length>4*Math.ceil(limit/3)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw fail();
 const bytes=Buffer.from(value,"base64");if(bytes.length<1||bytes.length>limit||bytes.toString("base64")!==value)throw fail();
 const text=new TextDecoder("utf8",{fatal:true,ignoreBOM:true}).decode(bytes);if(!Buffer.from(text,"utf8").equals(bytes))throw fail();return text;
}
function frozen<T>(value:T):Readonly<T>{if(value!==null&&typeof value==="object"){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
export function preparePdfAppendedIssueCapture(bundle:unknown,independentExpected:unknown){
 try{
  const e=expected(independentExpected),admitted=admitPdfAppendedIssueReview(bundle,e),b=admitted.bundle,s=admitted.selection,report=JSON.parse(b.candidateReportJson)as PdfReport;
  const intentJson=canonical(intentSchema.parse({schema_version:1,kind:"invented_pdf_appended_issue_capture",snapshot_intent:admitted.snapshotIntent,
   capture_id:s.captureId,run_id:s.runId,decision_id:s.decisionId,issue_id:s.issueId,base_publication_id:s.basePublicationId,
   preparation_operation_id:report.preparation.operation_id,preparation_artifact_id:e.preparationArtifactId,preparation_intent_sha256:sha(e.preparationIntentJson),preparation_full_receipt_sha256:report.preparation.receipt_sha256,
   preparation_stored_at:e.preparationStoredAt,part_sha256:names.map(key=>sha(b[key])),composition_observed_at:e.observedAt}));
  if(Buffer.byteLength(intentJson)>4096)throw fail();
  const p=decodeProposalCapture(admitted.encodedProposal.proposalJson,admitted.encodedProposal.proposalSha256),dependencies=p.dependencyManifest.sourceVersionIds;
  if(dependencies.some(id=>id!==id.toLowerCase()))throw fail();
  const values=Object.freeze([b64(intentJson),...names.map(key=>b64(b[key]))]),receiptEstimate=Buffer.byteLength(canonical({intent_base64:values[0],parts_base64:values.slice(1)}))+8192+dependencies.length*320;
  if(receiptEstimate>131072)throw fail();
  return Object.freeze({sql:PDF_APPENDED_CAPTURE_SQL,values,intentJson,intentSha256:sha(intentJson),bundle:b,expected:e,receiptEstimate,evidenceState:"invented_pdf_unexecuted_complete_companion_contract_not_work_or_publication" as const});
 }catch{throw fail();}
}
export function preparePdfAppendedIssueCaptureRead(retainedIntentJson:unknown){try{const i=intent(retainedIntentJson);return Object.freeze({sql:PDF_APPENDED_CAPTURE_READ_SQL,values:Object.freeze([i.capture_id])});}catch{throw fail();}}
export function parseStoredPdfAppendedIssueCapture(raw:unknown,retainedIntentJson:unknown,independentExpected:unknown,observedAt:unknown){
 try{
  const e=expected(independentExpected),i=intent(retainedIntentJson),observed=instant.parse(observedAt),bytes=new Uint8Array(131072),size=copyNativeByteChunk(bytes,0,raw);
  const text=new TextDecoder("utf8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,size)),r=nativeSchema.parse(JSON.parse(text));
  // Fixed receipt values contain no free text/JSON (only base64, UUID, digest,
  // UTC and bounded language tokens), so lexical key accounting is unambiguous.
  const keys=text.match(/"(?:[^"\\]|\\.)*"\s*:/g)??[];
  if(keys.length!==18+4*r.capture.sourceReceipts.length||keys.some(key=>{const spelling=key.slice(0,key.lastIndexOf(":" )).trim();return JSON.stringify(JSON.parse(spelling))!==spelling;})||! /"schema_version"\s*:\s*1\s*[,}]/.test(text))throw fail();
  if(unbase64(r.intent_base64,4096)!==retainedIntentJson||r.capture_id!==i.capture_id||r.preparation_operation_id!==i.preparation_operation_id||micros(i.composition_observed_at)>micros(r.capture.capturedAt)||micros(r.capture.capturedAt)>micros(r.stored_at)||micros(r.stored_at)>micros(observed))throw fail();
  const parts=r.parts_base64.map((value,index)=>unbase64(value,limits[index]!));if(parts.some((part,index)=>sha(part)!==i.part_sha256[index]))throw fail();
  const b=Object.fromEntries(names.map((key,index)=>[key,parts[index]!]))as Record<typeof names[number],string>,command=preparePdfAppendedIssueCapture(b,e);
  if(command.intentJson!==retainedIntentJson)throw fail();
  const p=decodeProposalCapture(b.proposalJson,JSON.parse(b.compositionJson).proposal_sha256),c=r.capture,context=JSON.parse(b.contextJson),report=JSON.parse(b.candidateReportJson)as PdfReport,current=JSON.parse(report.parts.provenance_json).current as PdfCurrent;
  if(c.captureId!==i.capture_id||c.runId!==i.run_id||c.decisionId!==i.decision_id||c.issueId!==i.issue_id||c.basePublicationId!==i.base_publication_id||c.baseContentSha256!==i.part_sha256[1]||c.baseHeadChangedAt!==context.baseline.head_changed_at||c.proposalSha256!==sha(b.proposalJson))throw fail();
  const listed=p.dependencyManifest.sourceVersionIds;
  if(c.sourceReceipts.length!==listed.length||new Set(c.sourceReceipts.map(s=>s.sourceVersionId.toLowerCase())).size!==listed.length||c.sourceReceipts.some(s=>!listed.includes(s.sourceVersionId)||micros(s.retrievedAt)>micros(c.capturedAt)))throw fail();
  for(const claim of p.snapshot.claims)for(const reference of claim.evidence){const source=c.sourceReceipts.find(s=>s.sourceVersionId===reference.sourceVersionId);if(!source||proposalEvidenceMicros(reference.retrievedAt)!==micros(source.retrievedAt))throw fail();}
  const nativeCurrent=c.sourceReceipts.find(s=>s.sourceVersionId===current.source_version_id);
  if(!nativeCurrent||nativeCurrent.contentSha256!==current.content_sha256||nativeCurrent.languageCode!==current.language_code||nativeCurrent.retrievedAt!==current.retrieved_at)throw fail();
  return frozen({bundle:command.bundle,expected:command.expected,capture:c,storedAt:r.stored_at,observedAt:observed,intentJson:retainedIntentJson,receiptSha256:createHash("sha256").update(bytes.subarray(0,size)).digest("hex"),evidenceState:"supplied_pdf_complete_capture_receipt_not_authenticated_current_qualification_or_publication" as const});
 }catch{throw fail();}
}
