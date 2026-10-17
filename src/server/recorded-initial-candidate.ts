import { z } from "zod";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { compareStoredInitialCandidateCapture } from "./initial-candidate-comparison.ts";
const keys=["schemaVersion","kind","scope","id","rawReceiptJson","retainedIntentJson","preparationExpected","captureObservedAt","actualComparisonJson"] as const;
const text=(maximum:number)=>z.string().refine(s=>s.length>0&&!/[\ud800-\udfff]/u.test(s)&&Buffer.byteLength(s,"utf8")<=maximum);
function check(input:unknown,fields:readonly string[]){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw Error();
 const names=Object.keys(input);if(names.length!==fields.length||names.some(k=>!fields.includes(k))||Object.getOwnPropertySymbols(input).some(k=>Object.getOwnPropertyDescriptor(input,k)?.enumerable))throw Error();return input;
}
function own(input:unknown,fields:readonly string[]){const source=check(input,fields),v=captureOwnEnumerableSelectors(source,fields);if(v===null)throw Error();check(source,fields);return v;}
// Fixed saved records only. Failed consistency withholds every private body.
export function recordedInitialCandidateCapture(input:unknown){
 try{
  const v=own(input,keys);if(v===null||v.schemaVersion!==1||v.kind!=="fictional_initial_candidate_capture"||v.scope!=="invented_saved_initial_candidate_only")throw Error();
  const raw=text(131072).parse(v.rawReceiptJson),intent=text(4096).parse(v.retainedIntentJson),comparison=text(65536).parse(v.actualComparisonJson);
  const expected=own(v.preparationExpected,["reportSha256","preparationIntentJson"]);
  const joined=compareStoredInitialCandidateCapture(new TextEncoder().encode(raw),intent,expected,v.captureObservedAt,JSON.parse(comparison));
  if(v.id!==joined.stored.capture.captureId)throw Error();check(v.preparationExpected,["reportSha256","preparationIntentJson"]);check(input,keys);return joined;
 }catch{return null;}
}
