import { captureOwnEnumerableSelectors } from "./own-enumerable-selectors.ts";
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type RecordedCaptureQuery={kind:"none"|"invalid"}|{kind:"selected";preparationId:string;captureId:string|null};
// Two explicit selectors; a capture cannot supply a missing preparation. Query
// metadata is navigation only and is never authorization to reopen a record.
export function parseRecordedCaptureQuery(input:unknown,rethrow?:(error:unknown)=>void):RecordedCaptureQuery{
 if(input===null||typeof input!=="object"||Array.isArray(input))return {kind:"invalid"};
 const keys=Object.keys(input);if(keys.some(k=>k!=="preparation"&&k!=="capture"))return {kind:"invalid"};
 if(keys.length===0)return {kind:"none"};
 const v=captureOwnEnumerableSelectors(input,keys,true,rethrow);
 if(v===null||typeof v.preparation!=="string"||!uuid.test(v.preparation))return {kind:"invalid"};
 if(keys.includes("capture")&&(!v.capture||!uuid.test(v.capture)))return {kind:"invalid"};
 return Object.freeze({kind:"selected",preparationId:v.preparation,captureId:v.capture??null});
}
export function recordedCaptureHref(preparationId:string,captureId:string|null=null){
 if(!uuid.test(preparationId)||captureId!==null&&!uuid.test(captureId))throw Error("recorded_capture_selection_unavailable");
 const query=new URLSearchParams({preparation:preparationId});if(captureId!==null)query.set("capture",captureId);
 return "/editorial-preview/capture-history?"+query.toString();
}
