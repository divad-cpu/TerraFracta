import { recordedInitialCandidateCapture } from "./server/recorded-initial-candidate.ts";
import { DetachedPreparationView } from "./detached-preparation-view.tsx";

export function InitialCandidateCaptureView({record}:{record:unknown}){
 const joined=recordedInitialCandidateCapture(record);
 if(joined===null)return <section role="status"><h2>Saved initial candidate unavailable</h2><p>The complete preparation, saved capture and separate recorded comparison could not be matched. All private candidate, context and passage details are withheld.</p></section>;
 const {stored,report}=joined,p=stored.preparation,c=stored.capture;
 return <section aria-labelledby="initial-capture-heading"><h2 id="initial-capture-heading" tabIndex={-1}>Saved initial candidate and provenance</h2>
  <p>Entirely invented historical example. One existing four-part preparation and one review-only candidate are linked in the saved record. This is a technical single-claim preparation, not an accepted replacement for the whole issue.</p>
  <nav aria-label="Sections of this saved initial candidate"><a href="#initial-capture-context">Observed empty head</a>{" · "}<a href="#initial-capture-observations">Separate original times</a>{" · "}<a href="#initial-capture-preparation">Original preparation and passages</a></nav>
  <section id="initial-capture-context" tabIndex={-1}><h3>Observed empty current head</h3><p>The existing publication-head row had no current publication at the recorded capture and comparison. No historical baseline was invented. This does not mean the issue has never had a publication and does not establish its present state.</p>
   <dl><dt>Capture / preparation</dt><dd><code>{c.captureId}</code> / <code>{p.preparation.operation_id}</code></dd>
    <dt>Run / held decision / issue</dt><dd><code>{c.runId}</code> / <code>{c.decisionId}</code> / <code>{c.issueId}</code></dd>
    <dt>Source receipt</dt><dd><code>{c.sourceReceipts[0]!.sourceVersionId}</code> / <code>{c.sourceReceipts[0]!.contentSha256}</code></dd></dl>
   <p>Matching source and target identities do not approve factual support, source rights, conflict or translation review.</p></section>
  <section id="initial-capture-observations" tabIndex={-1}><h3>Separate original observations</h3><ol>
   <li>Preparation created: <time dateTime={p.preparation.prepared_at}>{p.preparation.prepared_at}</time>.</li>
   <li>Preparation stored: <time dateTime={p.preparation.stored_at}>{p.preparation.stored_at}</time>.</li>
   <li>Preparation report observed: <time dateTime={p.observedAt}>{p.observedAt}</time>.</li>
   <li>Candidate captured: <time dateTime={c.capturedAt}>{c.capturedAt}</time>.</li>
   <li>Complete association stored: <time dateTime={stored.storedAt}>{stored.storedAt}</time>.</li></ol>
   <dl><dt>Original trusted capture-receipt observation</dt><dd><time dateTime={stored.observedAt}>{stored.observedAt}</time></dd>
    <dt>Separate reviewer-record observation</dt><dd><time dateTime={report.observedAt}>{report.observedAt}</time></dd></dl>
   <p>These are two separately retained observations. The reviewer record is not relabelled as observed at the earlier capture-receipt time. Opening this page performs no request or new clock observation and renews neither record.</p></section>
  <details><summary>Saved identity and original review scope</summary><dl><dt>Complete association fingerprint</dt><dd><code>{stored.receiptSha256}</code></dd>
   <dt>Payload fingerprint</dt><dd><code>{c.proposalSha256}</code></dd></dl>
   <p>Recorded hold reasons: {report.decision.reasonCodes.join(", ")||"No disclosed reason"}. {report.decision.undisclosedReasonCount} additional reason entries are withheld. This historical explanation is not an approval.</p></details>
  <section id="initial-capture-preparation" tabIndex={-1}><h3>Original single-candidate preparation</h3><p>The panel below describes the earlier preparation stage. Its notices about unconnected capture or held-decision records refer to that stage; the saved association and separate historical comparison are checked above.</p>
   <DetachedPreparationView raw={stored.reportJson} expected={{reportSha256:JSON.parse(stored.intentJson).report_sha256,preparationIntentJson:JSON.parse(stored.reportJson).intent_json}}/></section>
  <p><a href="#initial-capture-heading">Back to the saved initial candidate</a></p><p>No editorial action is available. Actual authenticated operation, current work, source and rights clearance, recovery and publication acceptance remain separate.</p>
 </section>;
}
