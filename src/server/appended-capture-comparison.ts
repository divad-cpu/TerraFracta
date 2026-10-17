import { parseStoredAppendedIssueCapture } from "./appended-issue-capture.ts";
import { parseCapturedProposalEnvelope } from "./proposal-capture.ts";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

// Pure consistency join for the fixed historical custody read and the existing
// separate current reviewer read. Neither supplied JSON nor hashes authenticate
// the caller/backend or approve source support, rights or publication.
export function compareStoredAppendedIssueCapture(raw:unknown,retainedIntentJson:unknown,observedAt:unknown,actualReport:unknown){
 try{
  const stored=parseStoredAppendedIssueCapture(raw,retainedIntentJson,observedAt),report=parseCapturedProposalEnvelope(actualReport);
  if(report.status!=="ok")throw Error();
  const c=stored.capture,b=stored.bundle,context=JSON.parse(JSON.parse(b.candidateReportJson).parts.context_json);
  if(report.requested.runId!==c.runId||report.requested.decisionId!==c.decisionId||report.target.issueId!==c.issueId||report.capture.captureId!==c.captureId||
   report.capture.proposalJson!==b.proposalJson||report.capture.proposalSha256!==c.proposalSha256||report.capture.basePublicationId!==c.basePublicationId||
   report.capture.baseHeadChangedAt!==c.baseHeadChangedAt||report.capture.baseContentSha256!==c.baseContentSha256||report.capture.capturedAt!==c.capturedAt||
   report.base===null||report.base.publicationJson!==b.baselineJson||report.base.publicationSha256!==c.baseContentSha256||
   canonicalProposalJson(report.sourceReceipts)!==canonicalProposalJson(c.sourceReceipts)||micros(report.observedAt)<micros(stored.storedAt)||micros(report.observedAt)>micros(stored.observedAt))throw Error();
  if(report.decision.sourceVersionId!==context.held.source_version_id||report.decision.sourceSha256!==context.held.content_sha256||report.decision.evidenceLocator!==context.held.locator||
   report.decision.decidedAt!==context.held.decided_at||report.target.jurisdictionId!==context.issue.jurisdiction_id||report.target.jurisdictionSlug!==context.issue.jurisdiction_slug||report.target.issueSlug!==context.issue.issue_slug)throw Error();
  return Object.freeze({stored,report,evidenceState:"invented_capture_and_recorded_comparison_consistent_not_source_or_publication_qualified" as const});
 }catch{throw Error("appended_capture_comparison_unavailable");}
}
