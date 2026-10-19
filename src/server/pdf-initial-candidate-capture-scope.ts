import { createHash } from "node:crypto";
import { z } from "zod";
import { preparePdfInitialCandidateCaptureRead } from "./pdf-initial-candidate-capture.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";
// Independent single-candidate PDF read/recovery selectors. This fixed scope
// neither authenticates a principal nor supplies a current work lease.
const keys=["reportSha256","preparationIntentJson","preparationArtifactId","preparationStoredAt","observedAt"] as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const instant=z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s=>!s.startsWith("0000-"));
const expectedSchema=z.strictObject({reportSha256:hash,preparationIntentJson:z.string().min(1).refine(s=>Buffer.byteLength(s)<=4096&&!/[\ud800-\udfff]/u.test(s)),preparationArtifactId:uuid,preparationStoredAt:instant,observedAt:instant});
const fail=()=>Error("pdf_initial_candidate_capture_unavailable");
function expected(input:unknown){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw fail();
 const closed=()=>{const proto=Object.getPrototypeOf(input),own=Reflect.ownKeys(input);return (proto===Object.prototype||proto===null)&&own.length===keys.length&&own.every(k=>typeof k==="string"&&keys.includes(k as typeof keys[number]));};
 if(!closed())throw fail();const copy:Record<string,string>={};
 for(const key of keys){const d=Object.getOwnPropertyDescriptor(input,key);if(!d?.enumerable||!("value"in d)||typeof d.value!=="string")throw fail();copy[key]=d.value;}
 if(!closed())throw fail();return Object.freeze(expectedSchema.parse(copy));
}
export function preparePdfInitialCandidateReadScope(retainedIntentJson:unknown,independentExpected:unknown,historicalObservedAt:unknown){
 try{
  const e=expected(independentExpected),command=preparePdfInitialCandidateCaptureRead(retainedIntentJson),i=JSON.parse(retainedIntentJson as string),at=instant.parse(historicalObservedAt);
  if(i.report_sha256!==e.reportSha256||i.preparation_intent_sha256!==createHash("sha256").update(e.preparationIntentJson,"utf8").digest("hex")||i.preparation_artifact_id!==e.preparationArtifactId||i.preparation_observed_at!==e.observedAt||micros(e.preparationStoredAt)>micros(e.observedAt)||micros(e.observedAt)>micros(at))throw fail();
  // Preparation storedAt is independently supplied; the full native report
  // must still match it after reading. No selector is inferred from native rows.
  return Object.freeze({retainedIntentJson:retainedIntentJson as string,expected:e,observedAt:at,command});
 }catch{throw fail();}
}
