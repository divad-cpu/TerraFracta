import { createHash } from "node:crypto";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { OPERATOR_AUDIT_TIMEOUT_MS } from "./operator-audit-reader.ts";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { pdfPreparationReviewReport } from "./pdf-preparation-review-report.ts";
import { parsePdfInitialCandidateCaptureLookup } from "./pdf-initial-candidate-capture-lookup.ts";
import { preparePdfInitialCandidateReadScope } from "./pdf-initial-candidate-capture-scope.ts";
import { createPdfInitialCandidateCaptureReader, type PdfInitialCandidateCaptureProvider, type PdfInitialCandidateCaptureReadDecision } from "./pdf-initial-candidate-capture-reader.ts";
import { recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// Explicit owner-only choice adapted from the established HTML selected reader.
// Lookup metadata never generates the independent intent or five independent selectors. It is not a
// current comparison snapshot, work renewal, authorization or publication gate.
const keys=["preparationReportJson","preparationExpected","lookupRaw","captureId","captureIntentJson","captureExpected","observedAt"] as const;
const sha=(raw:string)=>createHash("sha256").update(raw,"utf8").digest("hex");
function capturedSelection(input:unknown){
 try{
  if(input===null||typeof input!=="object"||Array.isArray(input))return null;
  const closed=()=>{const proto=Object.getPrototypeOf(input),own=Reflect.ownKeys(input);return (proto===Object.prototype||proto===null)&&own.length===keys.length&&own.every(k=>typeof k==="string"&&keys.includes(k as typeof keys[number]));};
  if(!closed())return null;
  const captured:Record<string,unknown>={};
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(input,key);if(!d?.enumerable||!("value"in d))return null;captured[key]=d.value;}
  if(!closed()||typeof captured.preparationReportJson!=="string")return null;
  const scope=preparePdfInitialCandidateReadScope(captured.captureIntentJson,captured.captureExpected,captured.observedAt);
  const preparation=pdfPreparationReviewReport(captured.preparationReportJson,captured.preparationExpected);
  if(preparation===null||scope.command.values[0]!==captured.captureId)return null;
  const e=scope.expected,p=preparation.report.preparation;
  if(e.reportSha256!==preparation.expected.reportSha256||e.preparationIntentJson!==preparation.report.intent_json||e.preparationArtifactId!==p.artifact_id||e.preparationStoredAt!==p.stored_at||e.observedAt!==preparation.expected.observedAt)return null;
  const bytes=new Uint8Array(4096),size=copyNativeByteChunk(bytes,0,captured.lookupRaw);
  const lookup=parsePdfInitialCandidateCaptureLookup(bytes.subarray(0,size),captured.preparationReportJson,preparation.expected,scope.observedAt),intent=JSON.parse(scope.retainedIntentJson);
  if(intent.preparation_operation_id!==lookup.preparation.operationId||intent.preparation_artifact_id!==lookup.preparation.artifactId||p.stored_at!==lookup.preparation.storedAt||intent.preparation_full_receipt_sha256!==lookup.preparation.receiptSha256||intent.preparation_intent_sha256!==lookup.preparation.intentSha256)return null;
  const selected=lookup.matches.find(m=>m.captureId===captured.captureId);
  if(selected===undefined)return {kind:"not_found" as const};
  if(selected.intentSha256!==sha(scope.retainedIntentJson))return null;
  return Object.freeze({kind:"selected" as const,selected,scope,reportJson:captured.preparationReportJson});
 }catch{return null;}
}
export type SelectedPdfInitialCandidateCaptureDecision =
 | {kind:"ok";selected:ReturnType<typeof parsePdfInitialCandidateCaptureLookup>["matches"][number];stored:Extract<PdfInitialCandidateCaptureReadDecision,{kind:"ok"}>["stored"];evidenceState:"invented_explicit_historical_pdf_association_not_current_work_or_publication"}
 | {kind:"invalid_scope"|"not_found"|"unconfigured"|"unavailable"|"changed"};
export function createSelectedPdfInitialCandidateCaptureReader(provider?:PdfInitialCandidateCaptureProvider,now=()=>performance.now(),record:DevelopmentErrorRecorder=recordDevelopmentError){
 return async(input:unknown,signal?:AbortSignal):Promise<SelectedPdfInitialCandidateCaptureDecision>=>{
  // Start the original interval before descriptor traps can execute caller code.
  if(signal?.aborted)return {kind:"unavailable"};
  let began:number;try{began=now();}catch{return {kind:"unavailable"};}
  if(!Number.isFinite(began))return {kind:"unavailable"};
  const elapsed=createElapsedReadClock(now,began);
  const captured=capturedSelection(input);
  if(captured===null)return {kind:"invalid_scope"};
  if(captured.kind==="not_found")return captured;
  if(provider===undefined)return {kind:"unconfigured"};
  if(signal?.aborted)return {kind:"unavailable"};
  try{
   const active=()=>{const age=elapsed();return !signal?.aborted&&Number.isFinite(age)&&age>=0&&age<OPERATOR_AUDIT_TIMEOUT_MS;};
   let nestedStarted=false;
   const sharedNow=()=>{
    const age=elapsed();if(!Number.isFinite(age)||age<0||age>=OPERATOR_AUDIT_TIMEOUT_MS)return NaN;
    // The nested reader inherits the original start, including selector work.
    if(!nestedStarted){nestedStarted=true;return began;}
    return began+age;
   };
   if(!active())return {kind:"unavailable"};
   const result=await createPdfInitialCandidateCaptureReader(provider,sharedNow,record)({retainedIntentJson:captured.scope.retainedIntentJson,expected:captured.scope.expected,observedAt:captured.scope.observedAt},signal);
   if(!active())return {kind:"unavailable"};
   if(result.kind!=="ok")return result;
   const stored=result.stored;
   const matches=stored.capture.captureId===captured.selected.captureId&&stored.storedAt===captured.selected.storedAt&&sha(stored.intentJson as string)===captured.selected.intentSha256&&stored.reportJson===captured.reportJson;
   if(!active())return {kind:"unavailable"};
   return matches?{kind:"ok",selected:captured.selected,stored,evidenceState:"invented_explicit_historical_pdf_association_not_current_work_or_publication"}:{kind:"changed"};
  }catch{return {kind:"unavailable"};}
 };
}
// No backend, account, grant, route or implicit selection is configured.
export const readSelectedPdfInitialCandidateCapture=createSelectedPdfInitialCandidateCaptureReader();
