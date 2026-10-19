import { createHash } from "node:crypto";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { detachedPreparationReport, detachedPreparationIntentSchema } from "./detached-preparation-report.ts";
import { parseInitialCandidateLookup } from "./initial-candidate-lookup.ts";
import { prepareInitialCandidateCaptureRead, parseStoredInitialCandidateCapture } from "./initial-candidate-capture.ts";
import { OPERATOR_AUDIT_TIMEOUT_MS } from "./operator-audit-reader.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// One explicitly selected initial historical association. Metadata supplies no
// capture intent, observation clock, current work, default connection or grant.
const keys=["preparationReportJson","preparationExpected","lookupRaw","lookupObservedAt","captureId","captureIntentJson","captureObservedAt"] as const;
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const instant=detachedPreparationIntentSchema.shape.prepared_at;
function own(input:unknown,names:readonly string[]){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw Error();
 const closed=()=>{const actual=Object.keys(input);return actual.length===names.length&&actual.every(k=>names.includes(k))&&!Object.getOwnPropertySymbols(input).some(k=>Object.getOwnPropertyDescriptor(input,k)?.enumerable);};
 if(!closed())throw Error();
 const captured=captureOwnEnumerableSelectors(input,names);if(captured===null||!closed())throw Error();return captured;
}
function captureSelection(input:unknown){
 try{
  const c=own(input,keys);
  if(keys.some(k=>k!=="preparationExpected"&&k!=="lookupRaw"&&typeof c[k]!=="string"))throw Error();
  const e=own(c.preparationExpected,["reportSha256","preparationIntentJson"]);
  if(typeof e.reportSha256!=="string"||typeof e.preparationIntentJson!=="string")throw Error();
  const expected=Object.freeze({reportSha256:e.reportSha256,preparationIntentJson:e.preparationIntentJson});
  const raw=c.preparationReportJson as string,lookupObservedAt=instant.parse(c.lookupObservedAt),captureObservedAt=instant.parse(c.captureObservedAt);
  if(micros(captureObservedAt)<micros(lookupObservedAt))throw Error();
  const bytes=new Uint8Array(4096),size=copyNativeByteChunk(bytes,0,c.lookupRaw);
  const lookup=parseInitialCandidateLookup(bytes.subarray(0,size),raw,expected,lookupObservedAt),report=detachedPreparationReport(raw,expected);
  if(report===null)throw Error();
  const intentJson=c.captureIntentJson as string,command=prepareInitialCandidateCaptureRead(intentJson),i=JSON.parse(intentJson),p=report.preparation,m=report.metadata,s=report.selection;
  if(command.values[0]!==c.captureId||i.preparation_operation_id!==lookup.preparation.operationId||i.preparation_artifact_id!==lookup.preparation.artifactId||
   i.capture_id!==s.captureId||i.run_id!==s.runId||i.decision_id!==s.decisionId||i.issue_id!==s.issueId||i.base_publication_id!==null||
   i.preparation_intent_sha256!==sha(expected.preparationIntentJson)||i.preparation_full_receipt_sha256!==p.full_receipt_sha256||i.report_sha256!==expected.reportSha256||
   i.preparation_observed_at!==report.observedAt||i.part_sha256.some((hash:string,index:number)=>hash!==[m.payload_sha256,m.selection_sha256,m.provenance_sha256,m.context_raw_sha256][index]))throw Error();
  const selected=lookup.matches.find(row=>row.captureId===c.captureId);
  if(selected===undefined)return {kind:"not_found" as const};
  if(selected.intentSha256!==sha(intentJson))throw Error();
  return Object.freeze({kind:"selected" as const,selected,rawReport:raw,expected,intentJson,command,captureObservedAt});
 }catch{return null;}
}
export type InitialCandidateCaptureReadCommand=ReturnType<typeof prepareInitialCandidateCaptureRead>;
export type InitialCandidateCaptureProvider=(command:InitialCandidateCaptureReadCommand,signal:AbortSignal)=>Promise<Uint8Array>;
export type SelectedInitialCandidateCaptureDecision=
 | {kind:"ok";selected:ReturnType<typeof parseInitialCandidateLookup>["matches"][number];stored:ReturnType<typeof parseStoredInitialCandidateCapture>;evidenceState:"invented_explicit_initial_historical_association_not_current_work_or_publication"}
 | {kind:"invalid_scope"|"not_found"|"unconfigured"|"unavailable"|"changed"};
export function createSelectedInitialCandidateCaptureReader(provider?:InitialCandidateCaptureProvider,now=()=>performance.now(),record:DevelopmentErrorRecorder=recordDevelopmentError){
 return async(input:unknown,parentSignal?:AbortSignal):Promise<SelectedInitialCandidateCaptureDecision>=>{
  // One original interval begins before selector descriptors execute caller code.
  if(parentSignal?.aborted)return {kind:"unavailable"};
  let began:number;try{began=now();}catch{return {kind:"unavailable"};}
  if(!Number.isFinite(began))return {kind:"unavailable"};
  const elapsed=createElapsedReadClock(now,began);
  const captured=captureSelection(input);
  if(captured===null)return {kind:"invalid_scope"};
  if(captured.kind==="not_found")return captured;
  if(provider===undefined)return {kind:"unconfigured"};
  let reported=false;
  const reportFailure=()=>{if(!parentSignal?.aborted&&!reported){reported=true;observeDevelopmentError("operator_audit_read",record);}};
  const unavailable=():SelectedInitialCandidateCaptureDecision=>{reportFailure();return {kind:"unavailable"};};
  if(parentSignal?.aborted)return unavailable();
  try{const age=elapsed();if(!Number.isFinite(age)||age<0||age>=OPERATOR_AUDIT_TIMEOUT_MS)return unavailable();}catch{return unavailable();}
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined,rejectCancelled=()=>{},retired=false,cancellationObserved=false,cleanupFailed=false;
  const cancelled=new Promise<never>((_resolve,reject)=>{rejectCancelled=()=>reject(Error("initial_capture_unavailable"));});
  void cancelled.catch(()=>{});
  const cancel=()=>{if(retired||cancellationObserved)return;cancellationObserved=true;rejectCancelled();try{controller.abort();}catch{/* Logical observation still retires. */}};
  const expired=()=>{const age=elapsed();return cancellationObserved||parentSignal?.aborted||(!retired&&controller.signal.aborted)||!Number.isFinite(age)||age<0||age>=OPERATOR_AUDIT_TIMEOUT_MS;};
  let decision:SelectedInitialCandidateCaptureDecision={kind:"unavailable"};
  try{
   parentSignal?.addEventListener("abort",cancel,{once:true});
   const remaining=OPERATOR_AUDIT_TIMEOUT_MS-elapsed();
   if(!Number.isFinite(remaining)||remaining<=0||remaining>OPERATOR_AUDIT_TIMEOUT_MS)throw Error();
   timer=setTimeout(cancel,remaining);
   const raw=await Promise.race([Promise.resolve().then(()=>{if(expired())throw Error();return provider(captured.command,controller.signal);}),cancelled]);
   if(expired())throw Error();
   const bytes=new Uint8Array(131072),size=copyNativeByteChunk(bytes,0,raw);
   const stored=parseStoredInitialCandidateCapture(bytes.subarray(0,size),captured.intentJson,captured.expected,captured.captureObservedAt);
   if(expired())throw Error();
   const matches=stored.capture.captureId===captured.selected.captureId&&stored.storedAt===captured.selected.storedAt&&sha(stored.intentJson)===captured.selected.intentSha256&&
    stored.preparation.preparation.operation_id===captured.selected.preparationOperationId&&stored.reportJson===captured.rawReport;
   if(expired())throw Error();
   decision=matches?Object.freeze({kind:"ok" as const,selected:captured.selected,stored,evidenceState:"invented_explicit_initial_historical_association_not_current_work_or_publication" as const}):{kind:"changed"};
  }catch{decision=unavailable();}
  finally{
   retired=true;
   // Attempt every retirement independently. No cleanup exception or clock
   // side effect can expose a candidate after this original interval retires.
   try{if(timer!==undefined)clearTimeout(timer);}catch{cleanupFailed=true;reportFailure();}
   try{parentSignal?.removeEventListener("abort",cancel);}catch{cleanupFailed=true;reportFailure();}
   try{controller.abort();}catch{cleanupFailed=true;reportFailure();}
  }
  try{if(cleanupFailed||expired())return unavailable();}catch{return unavailable();}
  return decision;
 };
}
// Owner/principal/clock/backend acceptance remains independently required.
export const readSelectedInitialCandidateCapture=createSelectedInitialCandidateCaptureReader();
