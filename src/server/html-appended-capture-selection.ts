import { createHash } from "node:crypto";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { OPERATOR_AUDIT_TIMEOUT_MS } from "./operator-audit-reader.ts";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { htmlPreparationReviewReport } from "./html-preparation-review-report.ts";
import { parseHtmlAppendedCaptureLookup } from "./html-appended-capture-lookup.ts";
import { prepareHtmlAppendedIssueCaptureRead } from "./html-appended-issue-capture.ts";
import { createHtmlAppendedCaptureReader, type HtmlAppendedCaptureProvider, type HtmlAppendedCaptureReadDecision } from "./html-appended-capture-reader.ts";
import { recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// Explicit owner-only continuation. Stored metadata cannot manufacture the
// independent capture intent, choose a candidate, or authorize any connection.
const keys = ["preparationReportJson","preparationReportSha256","preparationIntentJson","lookupRaw","captureId","captureIntentJson","observedAt"] as const;
const sha = (s:string) => createHash("sha256").update(s,"utf8").digest("hex");
function capturedSelection(input:unknown) {
  try {
    if(input===null||typeof input!=="object"||Array.isArray(input))return null;
    const actual=Reflect.ownKeys(input);
    if(actual.length!==keys.length||actual.some(k=>!keys.includes(k as typeof keys[number])))return null;
    const c=captureOwnEnumerableSelectors(input,keys);
    if(c===null||Reflect.ownKeys(input).length!==keys.length||Reflect.ownKeys(input).some(k=>!keys.includes(k as typeof keys[number]))||keys.some(k=>k!=="lookupRaw"&&typeof c[k]!=="string"))return null;
    const raw=c.preparationReportJson as string,expected={reportSha256:c.preparationReportSha256 as string,preparationIntentJson:c.preparationIntentJson as string};
    const bytes=new Uint8Array(4096),size=copyNativeByteChunk(bytes,0,c.lookupRaw);
    const lookup=parseHtmlAppendedCaptureLookup(bytes.subarray(0,size),raw,expected,c.observedAt);
    const preparation=htmlPreparationReviewReport(raw,expected);
    if(preparation===null)return null;
    const intentJson=c.captureIntentJson as string,command=prepareHtmlAppendedIssueCaptureRead(intentJson),intent=JSON.parse(intentJson);
    if(command.values[0]!==c.captureId||intent.preparation_operation_id!==lookup.preparation.operationId||intent.preparation_artifact_id!==lookup.preparation.artifactId)return null;
    const selected=lookup.matches.find(m=>m.captureId===c.captureId);
    if(selected===undefined)return {kind:"not_found" as const};
    if(selected.intentSha256!==sha(intentJson))return null;
    return Object.freeze({kind:"selected" as const,selected,preparation,preparationIntentJson:expected.preparationIntentJson,intentJson,observedAt:c.observedAt as string});
  }catch{return null;}
}
export type SelectedHtmlAppendedCaptureDecision =
  | {kind:"ok"; selected:ReturnType<typeof parseHtmlAppendedCaptureLookup>["matches"][number]; stored:Extract<HtmlAppendedCaptureReadDecision,{kind:"ok"}>["stored"]; evidenceState:"invented_explicit_historical_association_read_not_current_work_or_publication"}
  | {kind:"invalid_scope"|"not_found"|"unconfigured"|"unavailable"|"changed"};
export function createSelectedHtmlAppendedCaptureReader(provider?:HtmlAppendedCaptureProvider,now=()=>performance.now(),record:DevelopmentErrorRecorder=recordDevelopmentError) {
  return async(input:unknown,signal?:AbortSignal):Promise<SelectedHtmlAppendedCaptureDecision> => {
    const captured=capturedSelection(input);
    if(captured===null)return {kind:"invalid_scope"};
    if(captured.kind==="not_found")return captured;
    try {
      // One original interval spans the inner read and final selection checks.
      // Every inner observation advances the same nonrenewing clock history.
      const began=now();
      if(!Number.isFinite(began))return {kind:"unavailable"};
      const elapsed=createElapsedReadClock(now,began);
      const active=()=>{const age=elapsed();return !signal?.aborted&&Number.isFinite(age)&&age>=0&&age<OPERATOR_AUDIT_TIMEOUT_MS;};
      const sharedNow=()=>{const age=elapsed();return Number.isFinite(age)&&age>=0&&age<OPERATOR_AUDIT_TIMEOUT_MS?began+age:NaN;};
      if(!active())return {kind:"unavailable"};
      const read=createHtmlAppendedCaptureReader(provider,sharedNow,record);
      const result=await read({retainedIntentJson:captured.intentJson,observedAt:captured.observedAt},signal);
      if(!active())return {kind:"unavailable"};
      if(result.kind!=="ok")return result;
      const stored=result.stored,candidate=JSON.parse(stored.bundle.candidateReportJson),p=captured.preparation.preparation;
      const matches=stored.capture.captureId===captured.selected.captureId&&stored.storedAt===captured.selected.storedAt&&sha(stored.intentJson as string)===captured.selected.intentSha256&&
        candidate.intent_json===captured.preparationIntentJson&&candidate.preparation.operation_id===p.operation_id&&candidate.preparation.artifact_id===p.artifact_id&&
        candidate.preparation.stored_at===p.stored_at&&candidate.preparation.receipt_sha256===p.receipt_sha256&&candidate.preparation.metadata_sha256===p.metadata_sha256&&
        candidate.preparation.prepared_at===p.prepared_at&&candidate.preparation.historical_artifact_observed_at===p.historical_artifact_observed_at;
      if(!active())return {kind:"unavailable"};
      return matches?{kind:"ok",selected:captured.selected,stored,evidenceState:"invented_explicit_historical_association_read_not_current_work_or_publication"}:{kind:"changed"};
    }catch{return {kind:"unavailable"};}
  };
}
// No backend or default owner account is configured by this module.
export const readSelectedHtmlAppendedCapture=createSelectedHtmlAppendedCaptureReader();
