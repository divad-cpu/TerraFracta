import { parseRecordedCaptureQuery,recordedCaptureHref,type RecordedCaptureQuery } from "./recorded-capture-navigation.ts";

// Reuse the established two-selector grammar. HTTP query observations are own
// data fields only; no getter, hidden/symbol alias or inherited selector runs.
export function parseHtmlRecordedCaptureQuery(input:unknown,rethrow?:(error:unknown)=>void):RecordedCaptureQuery{
 try{
  if(input===null||typeof input!=="object"||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return {kind:"invalid"};
  const captured:Record<string,string>={};
  for(const key of Reflect.ownKeys(input)){
   if(key!=="preparation"&&key!=="capture")return {kind:"invalid"};
   const d=Object.getOwnPropertyDescriptor(input,key);
   if(!d?.enumerable||!("value"in d)||typeof d.value!=="string")return {kind:"invalid"};
   captured[key]=d.value;
  }
  return parseRecordedCaptureQuery(captured,rethrow);
 }catch(error){rethrow?.(error);return {kind:"invalid"};}
}
export function htmlRecordedCaptureHref(preparationId:string,captureId:string|null=null){
 const old=recordedCaptureHref(preparationId,captureId),prefix="/editorial-preview/capture-history?";
 if(!old.startsWith(prefix))throw Error("html_recorded_capture_selection_unavailable");
 return "/editorial-preview/html-capture-history?"+old.slice(prefix.length);
}
