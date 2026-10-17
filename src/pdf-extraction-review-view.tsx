import { pdfExtractionReviewReport } from "./server/pdf-extraction-review-report.ts";

export function PdfExtractionReviewView({ input }: { input: unknown }) {
  const report = pdfExtractionReviewReport(input);
  if (!report) return <section><h2>PDF extraction review unavailable</h2><p>No partial proposal, page text or private artifact reference is displayed.</p></section>;
  const proposal = report.proposal;
  return <section aria-labelledby="pdf-result-review-heading"><h2 id="pdf-result-review-heading">Supplied PDF extraction review</h2>
    <p>This is an unverified supplied report. Opening this view does not reopen a packet, parse a PDF, authenticate storage or renew a source check.</p>
    <div className="info-band"><h3>Unverified proposed assertion</h3>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><bdi>{proposal.proposed_assertion}</bdi></p>
      <dl><dt>Proposed statement type</dt><dd><code>{proposal.proposed_claim_type}</code></dd>
        <dt>Exact source locator</dt><dd><code>{proposal.locator}</code></dd>
        <dt>Supplied language</dt><dd><code>{proposal.language_code}</code>. Language and translation quality are not established.</dd>
        <dt>Uninterpreted source date text</dt><dd>{proposal.source_date_text === null ? "No source date text supplied." : <bdi>{proposal.source_date_text}</bdi>}</dd></dl>
      <p><a href="#pdf-result-selected-pages">Inspect the changed selected text and earlier wording</a></p></div>
    <h3>Separate historical observations</h3><dl>
      <dt>Original recorded inspection observation</dt><dd><time dateTime={report.recorded_observed_at}>{report.recorded_observed_at}</time></dd>
      <dt>Original result preparation</dt><dd><time dateTime={report.prepared_at}>{report.prepared_at}</time></dd>
      <dt>Separately supplied result reopening</dt><dd><time dateTime={report.reopened_at}>{report.reopened_at}</time>. This is not an editorial review or current-source verification date.</dd></dl>
    <h3 id="pdf-result-selected-pages">Changed selected whole-page text</h3>
    <p>Page numbers are physical positions starting at one, not printed page labels. Text offsets belong to derived UTF-8 page text, not the original PDF. Reading order, visual layout, OCR and tables remain unqualified.</p>
    {report.selected_passages.map((group, index) => <article key={index}>
      <h4>Selected text group {index + 1}</h4>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><bdi>{group.text}</bdi></p>
      <p>Whole derived-page text SHA-256: <code>{group.text_sha256}</code></p>
      {group.locators.map((locator, i) => <details key={locator} open={locator === proposal.locator}>
        <summary>Physical page {group.page_numbers[i]} / <bdi>{locator}</bdi>{locator === proposal.locator ? " / proposed assertion locator" : ""}</summary>
        {group.earlier[i] === null ? <p>Explicit first observation: no earlier original was supplied.</p> : <>
          <p>Earlier wording at the same locator, physical page {group.earlier[i].page_number}:</p>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><bdi>{group.earlier[i].text}</bdi></p>
          <p>Earlier derived-page text SHA-256: <code>{group.earlier[i].text_sha256}</code></p></>}
      </details>)}
    </article>)}
    <p>Unselected and unchanged page text is omitted. A whole-page match does not establish that the proposed assertion is supported.</p>
    <h3>Supplied artifact and request references</h3><dl>
      <dt>Result operation</dt><dd><code>{report.artifact.operation_id}</code></dd>
      <dt>Complete result packet bytes / SHA-256</dt><dd>{report.artifact.packet_bytes} / <code>{report.artifact.packet_sha256}</code></dd>
      <dt>Complete request bytes / SHA-256</dt><dd>{report.request.request_bytes} / <code>{report.request.request_sha256}</code></dd>
      <dt>Selected payload SHA-256 checked from report text</dt><dd><code>{report.request.selected_payload_sha256}</code></dd>
      <dt>Untrusted output bytes / SHA-256</dt><dd>{report.artifact.output_bytes} / <code>{report.artifact.output_sha256}</code></dd>
      <dt>Supplied output token bound</dt><dd>{report.request.maximum_output_tokens}. This is not measured usage.</dd></dl>
    {(["current", "previous"] as const).map(key => {
      const source = report[key];
      return source === null ? <p key={key}>No earlier original: explicit first observation.</p> : <details key={key}>
        <summary>{key === "current" ? "Current original and selected-page references" : "Earlier original and selected-page references"}</summary>
        <dl><dt>Source / item / version</dt><dd><bdi>{source.source_key}</bdi> / <bdi>{source.item_key}</bdi> / <code>{source.source_version_id}</code></dd>
          <dt>Passive source address</dt><dd style={{ overflowWrap: "anywhere" }}><bdi>{source.source_url}</bdi></dd>
          <dt>Source retrieval, separate from inspection</dt><dd><time dateTime={source.retrieved_at}>{source.retrieved_at}</time></dd>
          <dt>Original PDF SHA-256</dt><dd><code>{source.content_sha256}</code></dd>
          <dt>Original packet / inspection / derivation SHA-256</dt><dd><code>{source.packet_sha256}</code> / <code>{source.inspection_sha256}</code> / <code>{source.derivation_sha256}</code></dd>
          <dt>Independent mapping SHA-256</dt><dd><code>{source.mapping_sha256}</code></dd></dl>
        <ul>{source.selected_pages.map(page => <li key={page.locator}>Physical page {page.page_number} / <bdi>{page.locator}</bdi> / <code>{page.page_text_sha256}</code></li>)}</ul>
      </details>;
    })}
    <h3>What remains unqualified</h3>
    <p>The producer rederives each supplied complete original and the exact historical request before parsing the raw output. This view checks only report consistency and the selected-payload hash. Omitted original, packet, inspection, derivation, complete request and output bytes are not reverified here.</p>
    <p>Storage and provider usage are not observed; actual cost is not observed. Source qualification and rights are not established. Factual support is not assessed. Conflict and translation assessments are not recorded. No review decision or publication authority is included.</p>
  </section>;
}
