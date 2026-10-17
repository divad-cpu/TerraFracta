import { htmlPreparationReviewReport } from "./server/html-preparation-review-report.ts";
import { HtmlExtractionReviewView } from "./html-extraction-review-view.tsx";

export function HtmlPreparationReviewView({raw,expected}:{raw:unknown;expected:unknown}) {
  const report=htmlPreparationReviewReport(raw,expected);
  if (!report) return <section><h2>Historical HTML preparation unavailable</h2><p>No partial candidate, context or source text is displayed.</p></section>;
  const {preparation:p,metadata:m,selection,snapshot,history}=report;
  return <section aria-labelledby="html-preparation-heading"><h2 id="html-preparation-heading">Historical HTML preparation</h2>
    <p>This illustrative preparation contains one unverified claim for technical review. Its context and byte receipts are synthetic; they establish no authenticated storage, actual held decision or accepted issue replacement.</p>
    <article id="html-prepared-candidate" tabIndex={-1}><h3><bdi>{snapshot.title}</bdi></h3><p><bdi>{snapshot.summary}</bdi></p>
      <p>Supplied issue: <code>{snapshot.jurisdictionSlug}</code> / <code>{snapshot.issueSlug}</code>. Independently supplied period: <bdi>{snapshot.claims[0]!.periodLabel}</bdi>.</p>
      <p><a href="#html-extraction-review-heading">Inspect the unverified assertion beside its source text</a></p></article>
    <h3>Supplied historical context</h3><dl><dt>Run / held decision</dt><dd><code>{selection.runId}</code> / <code>{selection.decisionId}</code></dd>
      <dt>Decision time</dt><dd><time dateTime={history.held.decided_at}>{history.held.decided_at}</time></dd>
      <dt>Issue / head observation</dt><dd><code>{selection.issueId}</code> / <time dateTime={history.issue.observed_at}>{history.issue.observed_at}</time></dd>
      <dt>Historical publication reference</dt><dd>{selection.basePublicationId===null ? "Explicitly supplied as empty at that observation. The current head is not checked." : <>Publication <code>{selection.basePublicationId}</code>, changed <time dateTime={history.issue.head.changed_at!}>{history.issue.head.changed_at}</time>. Its present state is not checked.</>}</dd>
      <dt>Evidence-review date</dt><dd><time dateTime={snapshot.lastEvidenceReviewOn}>{snapshot.lastEvidenceReviewOn}</time>. Supplied independently; preparing or reopening these bytes does not perform that review.</dd></dl>
    <h3>Historical bytes and later observation</h3><ol>
      <li>Extraction originally observed for this preparation: <time dateTime={p.historical_artifact_observed_at}>{p.historical_artifact_observed_at}</time>.</li>
      <li>Preparation created: <time dateTime={p.prepared_at}>{p.prepared_at}</time>.</li>
      <li>Preparation stored: <time dateTime={p.stored_at}>{p.stored_at}</time>.</li>
      <li>All four full receipts rechecked for this report: <time dateTime={report.observedAt}>{report.observedAt}</time>.</li></ol>
    <p>A later read preserves the original context. It does not renew source rights, support, translation, conflict checks, work or publication authority.</p>
    <details><summary>Exact preparation and part references</summary><dl>
      <dt>Operation / artifact</dt><dd><code>{p.operation_id}</code> / <code>{p.artifact_id}</code></dd>
      <dt>Intent / full receipt fingerprints</dt><dd><code>{p.metadata_sha256}</code> / <code>{p.receipt_sha256}</code></dd>
      <dt>Payload / selection fingerprints</dt><dd><code>{m.payload_sha256}</code> / <code>{m.selection_sha256}</code></dd>
      <dt>Provenance / original context fingerprints</dt><dd><code>{m.provenance_sha256}</code> / <code>{m.context_raw_sha256}</code></dd></dl>
      <p>Selected supplied context values are shown here. Its original byte spelling, original HTML and complete model request/output are omitted. This passive consumer cannot authenticate or rederive those omitted bytes; the Python producer requires all four complete receipts.</p></details>
    <p>No actual held capture or publication is connected. Support remains proposed, and translation and conflict assessments remain unreviewed.</p>
    <HtmlExtractionReviewView input={report.extraction}/><p><a href="#html-prepared-candidate">Back to the historical preparation</a></p>
  </section>;
}
