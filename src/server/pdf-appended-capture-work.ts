import { Buffer } from "node:buffer";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { prepareWorkProposalCapture } from "./proposal-work-command.ts";
import { preparePdfAppendedIssueCapture } from "./pdf-appended-issue-capture.ts";

// Pure complete PDF companion preparation only. Fixed SQL remains unexecuted;
// identifiers do not authenticate a principal or establish a current work lease.
export const PDF_APPENDED_WORK_CAPTURE_SQL="SELECT tf_pdf_review.capture_issue_for_work($1::uuid,$2::text,$3::uuid,"+
 Array.from({length:7},(_,i)=>`decode($${i+4}::text,'base64')`).join(",")+")::text AS capture";
const keys=["runId","requestFingerprint","workClaimId"] as const;
const fail=()=>Error("pdf_appended_capture_work_unavailable");
function capturedWork(input:unknown){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw fail();
 const closed=()=>{
  const proto=Object.getPrototypeOf(input),own=Reflect.ownKeys(input);
  return(proto===Object.prototype||proto===null)&&own.length===keys.length&&own.every(k=>typeof k==="string"&&keys.includes(k as typeof keys[number]));
 };
 if(!closed())throw fail();
 const values={}as Record<typeof keys[number],string>;
 for(const key of keys){
  const descriptor=Object.getOwnPropertyDescriptor(input,key);
  if(!descriptor?.enumerable||!("value"in descriptor)||typeof descriptor.value!=="string"||descriptor.value.length!==(key==="requestFingerprint"?64:36))throw fail();
  values[key]=descriptor.value;
 }
 if(!closed())throw fail();
 return Object.freeze(values);
}
export function preparePdfAppendedCaptureForWork(work:unknown,bundle:unknown,independentExpected:unknown){
 try{
  // Copy the whole closed primitive work record before delegating to any
  // accepted format input. No caller work getter is evaluated or retained.
  const originalWork=capturedWork(work),capture=preparePdfAppendedIssueCapture(bundle,independentExpected),i=JSON.parse(capture.intentJson);
  const checked=prepareWorkProposalCapture(originalWork,{captureId:i.capture_id,runId:i.run_id,decisionId:i.decision_id,issueId:i.issue_id,basePublicationId:i.base_publication_id},JSON.parse(capture.bundle.proposalJson));
  const values=Object.freeze([checked.work.runId,checked.work.requestFingerprint,checked.work.workClaimId,...capture.values]);
  if(Buffer.byteLength(canonicalProposalJson({sql:PDF_APPENDED_WORK_CAPTURE_SQL,values}),"utf8")>294912)throw fail();
  // Discard both internal generic/inner-seven command objects. Every exposed
  // command carries all six parts and the independent eight-channel selectors.
  return Object.freeze({sql:PDF_APPENDED_WORK_CAPTURE_SQL,values,work:checked.work,bundle:capture.bundle,expected:capture.expected,
   intentJson:capture.intentJson,intentSha256:capture.intentSha256,receiptEstimate:capture.receiptEstimate,
   evidenceState:"invented_pdf_unexecuted_complete_association_requires_current_outer_work_fence" as const});
 }catch{throw fail();}
}
