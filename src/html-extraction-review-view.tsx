import { htmlExtractionReviewReport } from "./server/html-extraction-review-report.ts";
import { HtmlInspectionView } from "./html-inspection-view.tsx";

export function HtmlExtractionReviewView({ input }: { input: unknown }) {
  const report = htmlExtractionReviewReport(input);
  if (!report) return <section><h2>HTML extraction review unavailable</h2><p>No partial private source text, proposal or artifact reference is displayed.</p></section>;
  const proposal = report.proposal;
  return <section aria-labelledby="html-extraction-review-heading"><h2 id="html-extraction-review-heading">Stored HTML extraction review example</h2>
    <p>Entirely invented illustrative receipts. This fixed example is generated from synthetic full receipts; it is not evidence of an actual database write or server authentication.</p>
    <div className="info-band"><h3>Unverified proposed assertion</h3><p>The supplied output remains a proposal. Stored bytes and matching references do not establish factual support, translation quality or permission to publish.</p>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><bdi>{proposal.proposed_assertion}</bdi></p>
      <dl><dt>Proposed statement type / source locator</dt><dd><code>{proposal.proposed_claim_type}</code> / <code>{proposal.locator}</code></dd>
        <dt>Supplied language</dt><dd><code>{proposal.language_code}</code>. Language qualification is not established.</dd>
        <dt>Source date text, not interpreted</dt><dd>{proposal.source_date_text === null ? "No source date text was supplied." : <bdi>{proposal.source_date_text}</bdi>}</dd></dl>
      <p><a href="#html-inspection-heading">Inspect the selected source text and earlier wording</a></p></div>
    <h3>Historical artifact references</h3><p>The producer reopens all three full receipts and regenerates the request before projecting the report. This view checks report joins; omitted original, request and output bytes are not reverified here.</p>
    <dl><dt>Result operation / artifact</dt><dd><code>{report.artifact.operation_id}</code> / <code>{report.artifact.artifact_id}</code></dd>
      <dt>Immutable preparation time</dt><dd><time dateTime={report.prepared_at}>{report.prepared_at}</time></dd>
      <dt>Reported storage time</dt><dd><time dateTime={report.artifact.stored_at}>{report.artifact.stored_at}</time></dd>
      <dt>Report observation time</dt><dd><time dateTime={report.observed_at}>{report.observed_at}</time>. This is not an editorial review date.</dd>
      <dt>Result metadata / full receipt hashes</dt><dd><code>{report.artifact.metadata_sha256}</code> / <code>{report.artifact.receipt_sha256}</code></dd>
      <dt>Complete request bytes / hash</dt><dd>{report.artifact.request_bytes} / <code>{report.artifact.request_sha256}</code></dd>
      <dt>Untrusted output bytes / hash</dt><dd>{report.artifact.output_bytes} / <code>{report.artifact.output_sha256}</code></dd></dl>
    {(["current", "previous"] as const).map(key => { const ref = report.originals[key]; return <details key={key}><summary>{key === "current" ? "Current original custody references" : "Earlier original custody references"}</summary><dl>
      <dt>Operation / artifact</dt><dd><code>{ref.operation_id}</code> / <code>{ref.artifact_id}</code></dd>
      <dt>Reported storage time</dt><dd><time dateTime={ref.stored_at}>{ref.stored_at}</time></dd>
      <dt>Metadata / full receipt hashes</dt><dd><code>{ref.metadata_sha256}</code> / <code>{ref.receipt_sha256}</code></dd></dl></details>; })}
    <HtmlInspectionView input={report.inspection} />
    <h3>What remains unqualified</h3><p>The embedded parsed-text comparison reports supplied-input storage as not observed; the separate references above describe illustrative custody only. Neither establishes an authenticated server.</p>
    <p>No current publication, affected page or held decision is connected. Conflict and translation assessments are not recorded; factual support is not assessed. Source qualification and rights are not established. Provider usage and actual cost are not observed. No review decision or publication authority is included.</p>
    <p>Original HTML, complete request and raw output bodies are omitted. There is no execution, approval or publication action.</p>
  </section>;
}
