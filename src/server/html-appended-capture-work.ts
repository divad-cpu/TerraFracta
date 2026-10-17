import { prepareHtmlAppendedIssueCapture,parseStoredHtmlAppendedIssueCapture } from "./html-appended-issue-capture.ts";
import { prepareWorkProposalCapture } from "./proposal-work-command.ts";

// Pure late binding of already admitted complete association bytes to the
// established work shape. Identifiers are not credentials or a live lease.
export const HTML_APPENDED_WORK_CAPTURE_SQL="SELECT tf_html_review.capture_issue_for_work($1::uuid,$2::text,$3::uuid,"+
 Array.from({length:7},(_,i)=>`decode($${i+4}::text,'base64')`).join(",")+")::text AS capture";
export function prepareHtmlAppendedIssueCaptureForWork(work:unknown,bundle:unknown,expected:unknown){
 try{
  const capture=prepareHtmlAppendedIssueCapture(bundle,expected),i=JSON.parse(capture.intentJson);
  const checked=prepareWorkProposalCapture(work,{captureId:i.capture_id,runId:i.run_id,decisionId:i.decision_id,issueId:i.issue_id,basePublicationId:i.base_publication_id},JSON.parse(capture.bundle.proposalJson));
  return Object.freeze({sql:HTML_APPENDED_WORK_CAPTURE_SQL,values:Object.freeze([checked.work.runId,checked.work.requestFingerprint,checked.work.workClaimId,...capture.values]),
   work:checked.work,capture,evidenceState:"invented_html_unexecuted_complete_association_requires_current_outer_work_fence" as const});
 }catch{throw Error("html_appended_capture_work_unavailable");}
}
export function recoverHtmlAppendedIssueCaptureForWork(work:unknown,raw:unknown,retainedIntentJson:unknown,observedAt:unknown){
 try{
  const stored=parseStoredHtmlAppendedIssueCapture(raw,retainedIntentJson,observedAt),i=JSON.parse(stored.intentJson as string),candidate=JSON.parse(stored.bundle.candidateReportJson);
  const prepared=prepareHtmlAppendedIssueCaptureForWork(work,stored.bundle,{compositionSha256:i.part_sha256[5],candidateReportSha256:i.part_sha256[0],preparationIntentJson:candidate.intent_json,
   baselineSha256:i.part_sha256[1],contextSha256:i.part_sha256[3],observedAt:i.composition_observed_at});
  if(prepared.capture.intentJson!==retainedIntentJson)throw Error();
  return prepared;
 }catch{throw Error("html_appended_capture_work_unavailable");}
}
