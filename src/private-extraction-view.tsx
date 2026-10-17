import { glossaryTerms } from "./evidence-glossary.ts";
import { privateExtractionReport } from "./server/private-extraction-report.ts";

export function PrivateExtractionView({ input }: { input: unknown }) {
  const report = privateExtractionReport(input);
  const category = report === null ? undefined : glossaryTerms.find(term => term.slug === report.proposal.proposed_claim_type.replaceAll("_", "-"));
  if (report === null || category === undefined) return <section><h2>Extraction report unavailable</h2><p>No partial evidence or approval is displayed.</p></section>;
  const selectedIndex = report.selected_passages.findIndex(group => group.locators.includes(report.proposal.locator));
  return <section aria-labelledby="extraction-heading"><h2 id="extraction-heading">Unverified candidate and selected evidence</h2>
    <p>Entirely invented offline example. Text consistency does not prove factual support, source rights or authenticated storage. This view performs no source, database or model request.</p>
    <article><h3 id="extraction-candidate" tabIndex={-1}>Candidate assertion</h3><blockquote style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}><bdi>{report.proposal.proposed_assertion}</bdi></blockquote>
      <dl><dt>Proposed category / selected locator</dt><dd>{category.label} / <code>{report.proposal.locator}</code></dd>
        <dt>Supplied source and proposal language code</dt><dd><code>{report.current.language_code}</code>. Translation review is not recorded.</dd>
        <dt>Source date text, unparsed</dt><dd><bdi>{report.proposal.source_date_text ?? "Not supplied"}</bdi></dd>
        <dt>State</dt><dd>Unverified. Factual support has not been assessed.</dd></dl>
      <h4>Review question from the methodology</h4><p>{category.question}</p><p>This question is guidance, not a completed assessment or evidence of support.</p>
      <p><a href={`#extraction-selected-${selectedIndex+1}`}>Inspect selected evidence for this candidate</a></p></article>
    <h3>Exact selected text, with earlier text per locator</h3>
    {report.selected_passages.map((group, i) => <article key={i} id={`extraction-selected-${i+1}`} tabIndex={-1}><h4>Selected passage {i+1}</h4>
      <ul>{group.locators.map(locator => <li key={locator}><code>{locator}</code>: {locator === report.proposal.locator ? "Candidate’s selected occurrence" : "Another occurrence of this exact selected text"}</li>)}</ul>
      <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}><bdi>{group.text}</bdi></pre>
      <p>Selected text hash: <code>{group.text_sha256}</code></p>
      {group.earlier.map(old => <details key={old.locator}><summary>Earlier supplied document: <bdi>{old.locator}</bdi></summary>
        {old.text === null ? <p>No passage with this locator in the supplied earlier document. This does not mean no earlier document or newly published information.</p> : <><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}><bdi>{old.text}</bdi></pre><p>Earlier text hash: <code>{old.text_sha256}</code></p></>}
      </details>)}{i === selectedIndex && <p><a href="#extraction-candidate">Back to candidate assertion</a></p>}</article>)}
    <h3>Supplied custody references</h3>
    {[report.current, report.previous].map((s,i) => <details key={s.source_version_id}><summary>{i===0 ? "Current supplied document" : "Earlier supplied document"}</summary>
      <dl><dt>Source / item</dt><dd><bdi>{s.source_key}</bdi> / <bdi>{s.item_key}</bdi></dd><dt>Address, not opened</dt><dd><bdi>{s.source_url}</bdi></dd>
        <dt>Version / original-byte hash</dt><dd><code>{s.source_version_id}</code> / <code>{s.content_sha256}</code></dd><dt>Stored document / mapping hash</dt><dd><code>{s.artifact_id}</code> / <code>{s.mapping_sha256}</code></dd>
        <dt>Retrieved / stored</dt><dd><time dateTime={s.retrieved_at}>{s.retrieved_at}</time> / <time dateTime={s.stored_at}>{s.stored_at}</time></dd></dl></details>)}
    <details><summary>Private artifact and request references</summary><dl><dt>Artifact operation / identity</dt><dd><code>{report.artifact.operation_id}</code> / <code>{report.artifact.artifact_id}</code></dd>
      <dt>Request / selected-payload hash</dt><dd><code>{report.request.request_sha256}</code> / <code>{report.request.selected_payload_sha256}</code></dd>
      <dt>Output hash</dt><dd><code>{report.artifact.output_sha256}</code></dd><dt>Prepared / stored / observed</dt><dd>{report.prepared_at} / {report.artifact.stored_at} / {report.observed_at}</dd></dl></details>
    <p>The earlier document is a source vintage, not the current public page. Current publication, affected pages and held decision are not connected. Conflict and translation assessments are not recorded; provider usage and actual cost are not observed.</p>
    <p>The Python producer rechecks both complete original documents and the retained private receipt. This view checks selected text and report consistency; omitted original, request and output bytes are not independently verified here. No approval, publication or automated operation is available.</p>
  </section>;
}
