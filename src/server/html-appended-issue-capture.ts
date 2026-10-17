import { createHash } from "node:crypto";
import { z } from "zod";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { canonicalProposalJson as canonical,capturedProposalEnvelopeSchema,proposalEvidenceMicros } from "../operator-proposal-capture.ts";
import { admitHtmlAppendedIssueReview } from "./html-appended-issue-review.ts";
import { htmlPreparationReviewReport } from "./html-preparation-review-report.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";
import { decodeProposalCapture } from "./proposal-capture.ts";

// Pure trusted transport preparation/receipt admission only. No connection,
// backend default, invocation, role grant, worker lease or publication follows.
const uuid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),instant=z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s=>!s.startsWith("0000-"));
const hash=z.string().regex(/^[a-f0-9]{64}$/),sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const names=["candidateReportJson","baselineJson","canonicalBaselineJson","contextJson","proposalJson","compositionJson"] as const;
const limits=[524288,24576,24576,32768,16384,65536];
const intentSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_html_appended_issue_capture"),capture_id:uuid,run_id:uuid,decision_id:uuid,issue_id:uuid,
 base_publication_id:uuid,preparation_operation_id:uuid,preparation_artifact_id:uuid,part_sha256:z.array(hash).length(6),composition_observed_at:instant});
const sourceReceipts=capturedProposalEnvelopeSchema.options[0].shape.sourceReceipts;
const nativeSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_html_appended_issue_capture_stored"),capture_id:uuid,preparation_operation_id:uuid,stored_at:instant,
 intent_base64:z.string().max(5464),parts_base64:z.array(z.string().max(699052)).length(6),
 capture:z.strictObject({captureId:uuid,runId:uuid,decisionId:uuid,issueId:uuid,basePublicationId:uuid,baseHeadChangedAt:instant,baseContentSha256:hash,proposalSha256:hash,capturedAt:instant,sourceReceipts})});
export const HTML_APPENDED_CAPTURE_SQL="SELECT tf_html_review.capture_issue("+Array.from({length:7},(_,i)=>`decode($${i+1}::text,'base64')`).join(",")+")::text AS capture";
export const HTML_APPENDED_CAPTURE_READ_SQL="SELECT tf_html_review.capture_receipt($1::uuid)::text AS capture";
// Literal UTF-8 retained intent identifies expected association bytes; it is
// not storage authentication or current publication qualification.
function readIntent(raw:unknown){
 if(typeof raw!=="string"||Buffer.byteLength(raw)>4096)throw Error();const value=intentSchema.parse(JSON.parse(raw));if(canonical(value)!==raw)throw Error();return value;
}
function b64(raw:string){return Buffer.from(raw,"utf8").toString("base64");}
function unbase64(value:string,limit:number){
 if(value.length<4||value.length>4*Math.ceil(limit/3)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error();
 const bytes=Buffer.from(value,"base64");if(bytes.length<1||bytes.length>limit||bytes.toString("base64")!==value)throw Error();const text=new TextDecoder("utf8",{fatal:true,ignoreBOM:true}).decode(bytes);
 if(!Buffer.from(text,"utf8").equals(bytes))throw Error();return text;
}
export function prepareHtmlAppendedIssueCapture(bundle:unknown,expected:unknown){
 try{
  const admitted=admitHtmlAppendedIssueReview(bundle,expected),b=admitted.bundle,report=JSON.parse(b.candidateReportJson),proof=JSON.parse(b.compositionJson),s=admitted.capturePreparation.selection;
  const intentJson=canonical(intentSchema.parse({schema_version:1,kind:"invented_html_appended_issue_capture",capture_id:s.captureId,run_id:s.runId,decision_id:s.decisionId,issue_id:s.issueId,
   base_publication_id:s.basePublicationId,preparation_operation_id:report.preparation.operation_id,preparation_artifact_id:report.preparation.artifact_id,
   part_sha256:names.map(key=>sha(b[key])),composition_observed_at:proof.observed_at}));
  if(Buffer.byteLength(intentJson)>4096)throw Error();
  const parts=names.map(key=>b[key]),values=Object.freeze([b64(intentJson),...parts.map(b64)]);
  // Estimate the COMPLETE seven-part native envelope, including a worst-case
  // receipt per dependency. Native SQL repeats its actual encoded-output check
  // before COMMIT. This is conservative local capacity, not native acceptance.
  const dependencies: string[]=JSON.parse(b.proposalJson).dependencyManifest.sourceVersionIds;
  // Native UUID source receipts use lowercase spelling. Preserve historical
  // payload bytes and hold an incompatible uppercase reference before writing.
  if(dependencies.some(id=>id!==id.toLowerCase()))throw Error();
  const dependencyCount=dependencies.length;
  const receiptEstimate=Buffer.byteLength(canonical({intent_base64:values[0],parts_base64:values.slice(1)}))+8192+dependencyCount*320;
  if(receiptEstimate>131072)throw Error();
  return Object.freeze({sql:HTML_APPENDED_CAPTURE_SQL,values,intentJson,intentSha256:sha(intentJson),bundle:b,receiptEstimate,
   evidenceState:"invented_unexecuted_html_capture_and_composition_association" as const});
 }catch{throw Error("html_appended_issue_capture_unavailable");}
}
export function prepareHtmlAppendedIssueCaptureRead(retainedIntentJson:unknown){
 try{const i=readIntent(retainedIntentJson);return Object.freeze({sql:HTML_APPENDED_CAPTURE_READ_SQL,values:Object.freeze([i.capture_id])});}
 catch{throw Error("html_appended_issue_capture_unavailable");}
}
export function parseStoredHtmlAppendedIssueCapture(raw:unknown,retainedIntentJson:unknown,observedAt:unknown){
 try{
  const i=readIntent(retainedIntentJson),observed=instant.parse(observedAt),bytes=new Uint8Array(131072),size=copyNativeByteChunk(bytes,0,raw);
  const text=new TextDecoder("utf8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,size)),r=nativeSchema.parse(JSON.parse(text));
  // Reuse the existing fixed-receipt lexical key accounting, not a new generic
  // JSON parser. Every admitted value here is base64, UUID/hash/UTC or a bounded
  // language token; there is no free text/raw JSON string to mimic a key token.
  const keys=(text.match(/"(?:[^"\\]|\\.)*"\s*:/g)??[]).map(p=>JSON.parse(p.slice(0,p.lastIndexOf(":" )).trim()));
  if(keys.length!==18+4*r.capture.sourceReceipts.length||unbase64(r.intent_base64,4096)!==retainedIntentJson||
   r.capture_id!==i.capture_id||r.preparation_operation_id!==i.preparation_operation_id||micros(r.stored_at)>micros(observed)||micros(i.composition_observed_at)>micros(r.capture.capturedAt)||micros(r.capture.capturedAt)>micros(r.stored_at))throw Error();
  const parts=r.parts_base64.map((value,index)=>unbase64(value,limits[index]!));if(parts.some((part,index)=>sha(part)!==i.part_sha256[index]))throw Error();
  const b=Object.fromEntries(names.map((key,index)=>[key,parts[index]!])) as Record<typeof names[number],string>,candidate=JSON.parse(b.candidateReportJson);
  const admitted=admitHtmlAppendedIssueReview(b,{compositionSha256:i.part_sha256[5],candidateReportSha256:i.part_sha256[0],preparationIntentJson:candidate.intent_json,
   baselineSha256:i.part_sha256[1],contextSha256:i.part_sha256[3],observedAt:i.composition_observed_at});
  const selected=admitted.capturePreparation.selection;
  if(selected.captureId!==i.capture_id||selected.runId!==i.run_id||selected.decisionId!==i.decision_id||selected.issueId!==i.issue_id||selected.basePublicationId!==i.base_publication_id)throw Error();
  const p=decodeProposalCapture(b.proposalJson,admitted.capturePreparation.proposalSha256),c=r.capture,context=JSON.parse(b.contextJson),report=htmlPreparationReviewReport(b.candidateReportJson,{reportSha256:i.part_sha256[0],preparationIntentJson:candidate.intent_json});
  if(!report||report.preparation.operation_id!==i.preparation_operation_id||report.preparation.artifact_id!==i.preparation_artifact_id||c.captureId!==i.capture_id||c.runId!==i.run_id||c.decisionId!==i.decision_id||c.issueId!==i.issue_id||
   c.basePublicationId!==i.base_publication_id||c.proposalSha256!==admitted.capturePreparation.proposalSha256||c.baseContentSha256!==i.part_sha256[1]||c.baseHeadChangedAt!==context.baseline.head_changed_at)throw Error();
  const listed=p.dependencyManifest.sourceVersionIds;
  if(c.sourceReceipts.length!==listed.length||new Set(c.sourceReceipts.map(s=>s.sourceVersionId.toLowerCase())).size!==listed.length||c.sourceReceipts.some(s=>!listed.includes(s.sourceVersionId)||micros(s.retrievedAt)>micros(c.capturedAt)))throw Error();
  for(const claim of p.snapshot.claims)for(const e of claim.evidence){const source=c.sourceReceipts.find(s=>s.sourceVersionId===e.sourceVersionId);if(!source||proposalEvidenceMicros(e.retrievedAt)!==micros(source.retrievedAt))throw Error();}
  // The complete candidate's native source hash must agree too. Other source
  // receipt hashes are historical native metadata, not substantive support.
  const current=report.extraction.inspection.current,nativeCurrent=c.sourceReceipts.find(s=>s.sourceVersionId===current.source_version_id);
  if(nativeCurrent?.contentSha256!==current.content_sha256||nativeCurrent.languageCode!==current.language_code)throw Error();
  return Object.freeze({bundle:admitted.bundle,capture:Object.freeze(c),storedAt:r.stored_at,observedAt:observed,intentJson:retainedIntentJson,
   receiptSha256:createHash("sha256").update(bytes.subarray(0,size)).digest("hex"),evidenceState:"invented_html_historical_capture_with_composition_not_current_qualification_or_publication" as const});
 }catch{throw Error("html_appended_issue_capture_unavailable");}
}
