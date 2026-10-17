import { parseStoredHtmlInitialCandidateCapture } from "./html-initial-candidate-capture.ts";
import { parseCapturedProposalEnvelope } from "./proposal-capture.ts";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

// Two independently recorded historical observations. The capture's trusted
// after-read UTC remains its own input; the later reviewer record is not
// relabelled as having been observed at that earlier time. No fresh read/clock.
export function compareStoredHtmlInitialCandidateCapture(raw:unknown,intentJson:unknown,expected:unknown,captureObservedAt:unknown,actualReport:unknown){
 try{
  const stored=parseStoredHtmlInitialCandidateCapture(raw,intentJson,expected,captureObservedAt),report=parseCapturedProposalEnvelope(actualReport);
  if(report.status!=="ok")throw Error();
  const c=stored.capture,p=JSON.parse(stored.reportJson),context=JSON.parse(p.provenance_json).independent_context;
  if(report.requested.runId!==c.runId||report.requested.decisionId!==c.decisionId||report.target.issueId!==c.issueId||report.capture.captureId!==c.captureId||
   report.capture.proposalJson!==p.payload_json||report.capture.proposalSha256!==c.proposalSha256||report.capture.basePublicationId!==null||
   report.capture.baseHeadChangedAt!==null||report.capture.baseContentSha256!==null||report.capture.capturedAt!==c.capturedAt||report.base!==null||
   canonicalProposalJson(report.sourceReceipts)!==canonicalProposalJson(c.sourceReceipts)||micros(report.observedAt)<micros(stored.storedAt))throw Error();
  if(report.decision.decisionId!==c.decisionId||report.decision.sourceVersionId!==context.held.source_version_id||report.decision.sourceSha256!==context.held.content_sha256||report.decision.evidenceLocator!==context.held.locator||
   report.decision.decidedAt!==context.held.decided_at||report.target.jurisdictionId!==context.issue.jurisdiction_id||report.target.jurisdictionSlug!==context.issue.jurisdiction_slug||report.target.issueSlug!==context.issue.issue_slug)throw Error();
  return Object.freeze({stored,report,evidenceState:"invented_html_initial_capture_and_separate_historical_comparison_not_current_or_publication_qualified" as const});
 }catch{throw Error("html_initial_candidate_comparison_unavailable");}
}
