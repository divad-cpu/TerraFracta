import { z } from "zod";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { detachedPreparationIntentSchema } from "./detached-preparation-report.ts";
import { htmlPreparationReviewReport } from "./html-preparation-review-report.ts";
import { parseHtmlAppendedCaptureLookup } from "./html-appended-capture-lookup.ts";
import { createSelectedHtmlAppendedCaptureReader } from "./html-appended-capture-selection.ts";
import { HTML_APPENDED_CAPTURE_READ_SQL } from "./html-appended-issue-capture.ts";
import { compareStoredHtmlAppendedIssueCapture } from "./html-appended-capture-comparison.ts";
import { OPERATOR_AUDIT_TIMEOUT_MS } from "./operator-audit-reader.ts";
import { recordDevelopmentError,type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// Fixed supplied records only: no target, provider option, connection or write.
// The independently retained expectations are required even for invented data.
// Selection metadata never manufactures an independent capture intent.
const uuid=detachedPreparationIntentSchema.shape.operation_id,instant=detachedPreparationIntentSchema.shape.prepared_at.refine(s=>!s.startsWith("0000-"));
const text=(maximum:number)=>z.string().refine(s=>s.length>0&&!/[\ud800-\udfff]/u.test(s)&&Buffer.byteLength(s,"utf8")<=maximum);
const expectedSchema=z.strictObject({reportSha256:z.string().regex(/^[a-f0-9]{64}$/),preparationIntentJson:text(4096)});
const recordSchema=z.strictObject({retainedIntentJson:text(4096),rawReceiptJson:text(131072),actualComparisonJson:text(65536)});
const inputKeys=["preparationId","captureId","preparationReportJson","preparationExpected","lookupRaw","observedAt","record"] as const;
function own(input:unknown,keys:readonly string[]){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw Error();
 const actual=Reflect.ownKeys(input);
 if(actual.length!==keys.length||actual.some(k=>typeof k!=="string"||!keys.includes(k))||Object.getOwnPropertySymbols(input).some(k=>Object.getOwnPropertyDescriptor(input,k)?.enumerable))throw Error();return input;
}
function capture(input:unknown,keys:readonly string[]){const object=own(input,keys),v=captureOwnEnumerableSelectors(object,keys);if(v===null)throw Error();own(object,keys);return v;}
function snapshot(input:unknown){
 const object=own(input,inputKeys),v=captureOwnEnumerableSelectors(object,inputKeys.filter(k=>k!=="record"));if(v===null)throw Error();own(object,inputKeys);
 const preparationId=uuid.parse(v.preparationId),captureId=v.captureId===null?null:uuid.parse(v.captureId),preparationReportJson=text(524288).parse(v.preparationReportJson);
 const preparationExpected=expectedSchema.parse(capture(v.preparationExpected,["reportSha256","preparationIntentJson"])),observedAt=instant.parse(v.observedAt);
 const lookup=new Uint8Array(4096),size=copyNativeByteChunk(lookup,0,v.lookupRaw);if(size<2)throw Error();
 own(object,inputKeys);
 return {object,preparationId,captureId,preparationReportJson,preparationExpected,lookupRaw:lookup.subarray(0,size),observedAt};
}
type Joined=ReturnType<typeof compareStoredHtmlAppendedIssueCapture>;
type Choices=ReturnType<typeof parseHtmlAppendedCaptureLookup>;
export type RecordedHtmlAppendedCaptureDecision=
 |{kind:"invalid_scope"|"not_found"|"unavailable"}
 |{kind:"choice_required";choices:Choices;preparationId:string}
 |{kind:"ok";choices:Choices;preparationId:string;captureId:string;joined:Joined;display:Readonly<z.infer<typeof recordSchema>>;observedAt:string;evidenceState:"invented_explicit_recorded_html_continuation_not_current_or_publication_qualified"};
export function createRecordedHtmlAppendedCaptureResolver(now=()=>performance.now(),record:DevelopmentErrorRecorder=recordDevelopmentError){
 return async(input:unknown,signal?:AbortSignal):Promise<RecordedHtmlAppendedCaptureDecision>=>{
  try{
   if(signal?.aborted)return {kind:"unavailable"};
   // Start before observing selectors: their work cannot renew this interval.
   const began=now();if(!Number.isFinite(began))return {kind:"unavailable"};const elapsed=createElapsedReadClock(now,began);
   let v:ReturnType<typeof snapshot>;try{v=snapshot(input);}catch{return {kind:"invalid_scope"};}
   const active=()=>{const age=elapsed();return !signal?.aborted&&Number.isFinite(age)&&age>=0&&age<OPERATOR_AUDIT_TIMEOUT_MS;};
   let nestedStarted=false;
   const sharedNow=()=>{
    const age=elapsed();if(!Number.isFinite(age)||age<0||age>=OPERATOR_AUDIT_TIMEOUT_MS)return NaN;
    if(!nestedStarted){nestedStarted=true;return began;}
    return began+age;
   };
   if(!active())return {kind:"unavailable"};
   const preparation=htmlPreparationReviewReport(v.preparationReportJson,v.preparationExpected);
   if(preparation===null||preparation.preparation.operation_id!==v.preparationId)return {kind:"invalid_scope"};
   const choices=parseHtmlAppendedCaptureLookup(v.lookupRaw,v.preparationReportJson,v.preparationExpected,v.observedAt);
   if(!active())return {kind:"unavailable"};
   if(v.captureId===null)return Object.freeze({kind:"choice_required",choices,preparationId:v.preparationId});
   if(!choices.matches.some(c=>c.captureId===v.captureId))return {kind:"not_found"};
   // Do not read a full-record selector before the user explicitly chooses a
   // member of the checked metadata. Snapshot strings before the first await.
   const selected=captureOwnEnumerableSelectors(v.object,["record"]);if(selected===null)throw Error();
   own(v.object,inputKeys);const sourceRecord=selected.record;
   const saved=Object.freeze(recordSchema.parse(capture(sourceRecord,["retainedIntentJson","rawReceiptJson","actualComparisonJson"])));own(v.object,inputKeys);
   const raw=new TextEncoder().encode(saved.rawReceiptJson);
   const read=createSelectedHtmlAppendedCaptureReader(async(command,child)=>{
    if(!active()||child.aborted||command.sql!==HTML_APPENDED_CAPTURE_READ_SQL||command.values.length!==1||command.values[0]!==v.captureId)throw Error();
    return raw.slice();
   },sharedNow,record);
   const decision=await read({preparationReportJson:v.preparationReportJson,preparationReportSha256:v.preparationExpected.reportSha256,
    preparationIntentJson:v.preparationExpected.preparationIntentJson,lookupRaw:v.lookupRaw,captureId:v.captureId,captureIntentJson:saved.retainedIntentJson,observedAt:v.observedAt},signal);
   if(!active())return {kind:"unavailable"};
   if(decision.kind!=="ok")return {kind:"unavailable"};
   const joined=compareStoredHtmlAppendedIssueCapture(raw,saved.retainedIntentJson,v.observedAt,JSON.parse(saved.actualComparisonJson));
   if(!active()||joined.stored.receiptSha256!==decision.stored.receiptSha256)return {kind:"unavailable"};
   return Object.freeze({kind:"ok",choices,preparationId:v.preparationId,captureId:v.captureId,joined,display:saved,observedAt:v.observedAt,
    evidenceState:"invented_explicit_recorded_html_continuation_not_current_or_publication_qualified"});
  }catch{return {kind:"unavailable"};}
 };
}
export const resolveRecordedHtmlAppendedCapture=createRecordedHtmlAppendedCaptureResolver();
