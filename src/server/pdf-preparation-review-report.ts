import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { pdfHeldPreparation } from "./pdf-held-preparation.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

// Passive supplied correspondence only. The separately expected report hash,
// intent and native artifact/time are mandatory; none authenticate a sender or
// replay the omitted full originals, native receipt or Python cold opening.
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const instant=z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s=>!s.startsWith("0000-"));
const text=(max:number)=>z.string().refine(s=>!/[\ud800-\udfff]/u.test(s)&&Buffer.byteLength(s,"utf8")>0&&Buffer.byteLength(s,"utf8")<=max);
const metadataSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_detached_pdf_proposal_preparation"),operation_id:uuid,
 extraction_operation_id:uuid,extraction_artifact_id:uuid,extraction_request_sha256:hash,extraction_output_sha256:hash,
 payload_sha256:hash,selection_sha256:hash,provenance_sha256:hash,context_raw_sha256:hash,prepared_at:instant});
const partsSchema=z.strictObject({payload_json:text(16384),selection_json:text(2048),provenance_json:text(65536),context_json:text(32768)});
const preparationSchema=z.strictObject({operation_id:uuid,artifact_id:uuid,result_operation_id:uuid,prepared_at:instant,stored_at:instant,
 receipt_sha256:hash,intent_sha256:hash,packet_sha256:hash});
const reportSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("private_stored_pdf_preparation_review_report"),scope:z.literal("invented_supplied_pdf_custody_only"),review_state:z.literal("unverified"),
 observed_at:instant,preparation:preparationSchema,intent_json:text(4096),parts:partsSchema,
 limits:z.strictObject({original_pdf_included:z.literal(false),request_body_included:z.literal(false),output_body_included:z.literal(false),
 full_result_receipt_included:z.literal(false),full_preparation_receipt_included:z.literal(false),source_authenticated:z.literal(false),current_qualification_established:z.literal(false),
 held_capture_observed:z.literal(false),current_publication_observed:z.literal(false),publication_authorized:z.literal(false)})});
const expectedSchema=z.strictObject({reportSha256:hash,preparationIntentJson:text(4096),preparationArtifactId:uuid,preparationStoredAt:instant,observedAt:instant});
const sha=(raw:string)=>createHash("sha256").update(raw,"utf8").digest("hex");
function ownStrings(value:unknown):Record<string,string>{
 if(value===null||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error();
 const copy:Record<string,string>={};
 for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=="string"||!d?.enumerable||!("value"in d)||typeof d.value!=="string")throw Error();Object.defineProperty(copy,key,{value:d.value,enumerable:true});}
 return copy;
}
function canonical(raw:string):unknown{const value:unknown=JSON.parse(raw);if(canonicalProposalJson(value)!==raw)throw Error();return value;}
export function pdfPreparationReviewReport(raw:unknown,expected:unknown){
 try{
  if(typeof raw!=="string"||Buffer.byteLength(raw,"utf8")<1||Buffer.byteLength(raw,"utf8")>262144||/[\ud800-\udfff]/u.test(raw))throw Error();
  const e=expectedSchema.parse(ownStrings(expected));if(sha(raw)!==e.reportSha256)throw Error();
  const report=reportSchema.parse(canonical(raw)),metadata=metadataSchema.parse(canonical(e.preparationIntentJson)),p=report.preparation;
  if(report.intent_json!==e.preparationIntentJson||p.intent_sha256!==sha(e.preparationIntentJson)||p.operation_id!==metadata.operation_id||
   p.result_operation_id!==metadata.extraction_operation_id||p.artifact_id!==e.preparationArtifactId||p.stored_at!==e.preparationStoredAt||report.observed_at!==e.observedAt||
   p.prepared_at!==metadata.prepared_at||micros(p.prepared_at)>micros(p.stored_at)||micros(p.stored_at)>micros(report.observed_at))throw Error();
  const bundle={payloadJson:report.parts.payload_json,selectionJson:report.parts.selection_json,provenanceJson:report.parts.provenance_json,contextJson:report.parts.context_json};
  const identity={payloadSha256:metadata.payload_sha256,selectionSha256:metadata.selection_sha256,provenanceSha256:metadata.provenance_sha256,contextSha256:metadata.context_raw_sha256};
  const candidate=pdfHeldPreparation(bundle,identity);if(candidate===null)throw Error();
  const a=candidate.proof.artifact;
  if(a.operation_id!==metadata.extraction_operation_id||a.artifact_id!==metadata.extraction_artifact_id||a.request_sha256!==metadata.extraction_request_sha256||a.output_sha256!==metadata.extraction_output_sha256||candidate.proof.prepared_at!==metadata.prepared_at)throw Error();
  return Object.freeze({report:Object.freeze({...report,preparation:Object.freeze(p),parts:Object.freeze(report.parts),limits:Object.freeze(report.limits)}),
   candidate,expected:Object.freeze(e),bundle:Object.freeze(bundle),identity:Object.freeze(identity),
   evidenceState:"supplied_historical_pdf_preparation_not_current_qualification_or_capture" as const});
 }catch{return null;}
}
