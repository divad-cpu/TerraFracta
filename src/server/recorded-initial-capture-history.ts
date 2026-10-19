import { z } from "zod";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { detachedPreparationIntentSchema } from "./detached-preparation-report.ts";
import { parseInitialCandidateLookup } from "./initial-candidate-lookup.ts";
import { createSelectedInitialCandidateCaptureReader } from "./initial-candidate-capture-selection.ts";
import { INITIAL_CANDIDATE_CAPTURE_READ_SQL } from "./initial-candidate-capture.ts";
import { compareStoredInitialCandidateCapture } from "./initial-candidate-comparison.ts";
import { OPERATOR_AUDIT_TIMEOUT_MS } from "./operator-audit-reader.ts";
import { recordDevelopmentError,type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// Fixed supplied records only. Actual historical metadata does not authorize
// a connection, select its only match, or manufacture an independent intent.
const uuid=detachedPreparationIntentSchema.shape.operation_id,instant=detachedPreparationIntentSchema.shape.prepared_at;
const text=(max:number)=>z.string().refine(s=>s.length>0&&!/[\ud800-\udfff]/u.test(s)&&Buffer.byteLength(s,"utf8")<=max);
const expectedSchema=z.strictObject({reportSha256:z.string().regex(/^[a-f0-9]{64}$/),preparationIntentJson:text(4096)});
const recordSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal("fictional_initial_candidate_capture"),scope:z.literal("invented_saved_initial_candidate_only"),id:uuid,rawReceiptJson:text(131072),retainedIntentJson:text(4096),preparationExpected:expectedSchema,captureObservedAt:instant,actualComparisonJson:text(65536)});
const inputKeys=["preparationId","captureId","preparationReportJson","preparationExpected","lookupRaw","lookupObservedAt","captureObservedAt","record"] as const;
const recordKeys=["schemaVersion","kind","scope","id","rawReceiptJson","retainedIntentJson","preparationExpected","captureObservedAt","actualComparisonJson"] as const;
function own(input:unknown,keys:readonly string[]){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw Error();
 const actual=Object.keys(input);
 if(actual.length!==keys.length||actual.some(k=>!keys.includes(k))||Object.getOwnPropertySymbols(input).some(k=>Object.getOwnPropertyDescriptor(input,k)?.enumerable))throw Error();return input;
}
function capture(input:unknown,keys:readonly string[]){const object=own(input,keys),v=captureOwnEnumerableSelectors(object,keys);if(v===null)throw Error();own(object,keys);return v;}
function expected(input:unknown){return Object.freeze(expectedSchema.parse(capture(input,["reportSha256","preparationIntentJson"])));}
function snapshot(input:unknown){
 const object=own(input,inputKeys),v=captureOwnEnumerableSelectors(object,inputKeys.filter(k=>k!=="record"&&k!=="captureObservedAt"));if(v===null)throw Error();own(object,inputKeys);
 const preparationId=uuid.parse(v.preparationId),captureId=v.captureId===null?null:uuid.parse(v.captureId),preparationReportJson=text(65536).parse(v.preparationReportJson),preparationExpected=expected(v.preparationExpected),lookupObservedAt=instant.parse(v.lookupObservedAt),bytes=new Uint8Array(4096),size=copyNativeByteChunk(bytes,0,v.lookupRaw);if(size<2)throw Error();
 own(object,inputKeys);
 return {object,preparationId,captureId,preparationReportJson,preparationExpected,lookupObservedAt,lookupRaw:bytes.subarray(0,size)};
}
type Choices=ReturnType<typeof parseInitialCandidateLookup>;
export type RecordedInitialCaptureHistoryDecision=
 |{kind:"invalid_scope"|"not_found"|"unavailable"}
 |{kind:"choice_required";choices:Choices;preparationId:string}
 |{kind:"ok";choices:Choices;preparationId:string;captureId:string;joined:ReturnType<typeof compareStoredInitialCandidateCapture>;display:Readonly<z.infer<typeof recordSchema>>;lookupObservedAt:string;captureObservedAt:string;evidenceState:"invented_native_metadata_explicit_recorded_initial_continuation_not_current_or_publication"};
export function createRecordedInitialCaptureHistoryResolver(now=()=>performance.now(),record:DevelopmentErrorRecorder=recordDevelopmentError){
 return async(input:unknown,signal?:AbortSignal):Promise<RecordedInitialCaptureHistoryDecision>=>{
  try{
   if(signal?.aborted)return {kind:"unavailable"};const began=now();if(!Number.isFinite(began))return {kind:"unavailable"};const elapsed=createElapsedReadClock(now,began);
   // Selector observation uses the same original interval as the full read.
   let v:ReturnType<typeof snapshot>;try{v=snapshot(input);}catch{return {kind:"invalid_scope"};}
   const active=()=>{const age=elapsed();return !signal?.aborted&&Number.isFinite(age)&&age>=0&&age<OPERATOR_AUDIT_TIMEOUT_MS;};
   let nestedStarted=false;
   const sharedNow=()=>{
    const age=elapsed();if(!Number.isFinite(age)||age<0||age>=OPERATOR_AUDIT_TIMEOUT_MS)return NaN;
    if(!nestedStarted){nestedStarted=true;return began;}
    return began+age;
   };
   if(!active())return {kind:"unavailable"};
   const choices=parseInitialCandidateLookup(v.lookupRaw,v.preparationReportJson,v.preparationExpected,v.lookupObservedAt);
   if(choices.preparation.operationId!==v.preparationId)return {kind:"invalid_scope"};if(!active())return {kind:"unavailable"};
   if(v.captureId===null)return Object.freeze({kind:"choice_required",choices,preparationId:v.preparationId});
   if(!choices.matches.some(c=>c.captureId===v.captureId))return {kind:"not_found"};
   // Only an explicitly chosen checked member may touch the full record getter.
   const clock=captureOwnEnumerableSelectors(v.object,["captureObservedAt"]);if(clock===null)throw Error();const captureObservedAt=instant.parse(clock.captureObservedAt);own(v.object,inputKeys);if(!active())return {kind:"unavailable"};
   const selected=captureOwnEnumerableSelectors(v.object,["record"]);if(selected===null)throw Error();own(v.object,inputKeys);const sourceRecord=selected.record,captured=capture(sourceRecord,recordKeys),e=expected(captured.preparationExpected);own(sourceRecord,recordKeys);own(v.object,inputKeys);
   const saved=Object.freeze(recordSchema.parse({...captured,preparationExpected:e}));Object.freeze(saved.preparationExpected);
   if(saved.id!==v.captureId||saved.captureObservedAt!==captureObservedAt||saved.preparationExpected.reportSha256!==v.preparationExpected.reportSha256||saved.preparationExpected.preparationIntentJson!==v.preparationExpected.preparationIntentJson)throw Error();
   const raw=new TextEncoder().encode(saved.rawReceiptJson),read=createSelectedInitialCandidateCaptureReader(async(command,child)=>{
    if(!active()||child.aborted||command.sql!==INITIAL_CANDIDATE_CAPTURE_READ_SQL||command.values.length!==1||command.values[0]!==v.captureId)throw Error();return raw.slice();
   },sharedNow,record);
   const decision=await read({preparationReportJson:v.preparationReportJson,preparationExpected:v.preparationExpected,lookupRaw:v.lookupRaw,lookupObservedAt:v.lookupObservedAt,captureId:v.captureId,captureIntentJson:saved.retainedIntentJson,captureObservedAt:captureObservedAt},signal);
   if(!active()||decision.kind!=="ok")return {kind:"unavailable"};
   const joined=compareStoredInitialCandidateCapture(raw,saved.retainedIntentJson,v.preparationExpected,captureObservedAt,JSON.parse(saved.actualComparisonJson));
   if(!active()||joined.stored.receiptSha256!==decision.stored.receiptSha256)return {kind:"unavailable"};
   return Object.freeze({kind:"ok",choices,preparationId:v.preparationId,captureId:v.captureId,joined,display:saved,lookupObservedAt:v.lookupObservedAt,captureObservedAt:captureObservedAt,evidenceState:"invented_native_metadata_explicit_recorded_initial_continuation_not_current_or_publication"});
  }catch{return {kind:"unavailable"};}
 };
}
export const resolveRecordedInitialCaptureHistory=createRecordedInitialCaptureHistoryResolver();
