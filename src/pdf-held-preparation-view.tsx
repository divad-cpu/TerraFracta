import { pdfHeldPreparation } from "./server/pdf-held-preparation.ts";

export function PdfHeldPreparationView({bundle,expected}:{bundle:unknown;expected:unknown}) {
  const result=pdfHeldPreparation(bundle,expected);
  if(!result)return <section><h2>PDF candidate preparation unavailable</h2><p>No partial assertion, source reference or private context is displayed.</p></section>;
  const {proof:p,payload,selection}=result,c=p.independent_context,claim=payload.snapshot.claims[0]!;
  return <section aria-labelledby="pdf-held-heading"><h2 id="pdf-held-heading">Detached PDF candidate</h2>
    <p>This is one unverified proposed claim, prepared for technical review. It has not been captured or connected durably to an issue. It is not a replacement issue edition.</p>
    <h3>Proposed wording</h3><h4><bdi>{payload.snapshot.title}</bdi></h4>
    <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}><bdi>{claim.assertion}</bdi></p>
    <dl><dt>Proposed statement type</dt><dd>{claim.type}</dd><dt>Separately supplied period</dt><dd><bdi>{claim.periodLabel}</bdi></dd>
      <dt>Target issue</dt><dd><bdi>{c.issue.jurisdiction_slug}</bdi> / <bdi>{c.issue.issue_slug}</bdi> / <code>{selection.issueId}</code></dd>
      <dt>Explicit publication basis</dt><dd>{c.issue.head.publication_id===null?"Explicit empty head; no publication basis was supplied.":<>Supplied publication <code>{c.issue.head.publication_id}</code> / <code>{c.issue.head.content_sha256}</code> / <time>{c.issue.head.changed_at}</time></>}</dd>
      <dt>Supplied held decision</dt><dd><code>{selection.decisionId}</code> / <time>{c.held.decided_at}</time>. Correspondence is checked; decision authenticity and current eligibility are not established.</dd>
      <dt>Independently supplied evidence review date</dt><dd><time>{c.content.last_evidence_review_on}</time>. This date is not inferred from the model output or source date.</dd>
      <dt>Uninterpreted source date text</dt><dd>{p.source_date_text===null?"None supplied.":<bdi>{p.source_date_text}</bdi>}</dd>
      <dt>Proposed support</dt><dd>Proposed only; factual support is not assessed.</dd>
      <dt>Translation</dt><dd>{payload.translation.displayLanguage} / {payload.translation.status}. No translation approval is supplied.</dd></dl>
    <h3>Physical PDF page correspondence</h3>
    <p>Physical positions start at one; they are not printed page labels. Hashes refer to derived UTF-8 whole-page text, not original PDF byte offsets. Reading order, visual layout, OCR and tables remain unqualified.</p>
    {(["current","previous"]as const).map(key=>{const source=p[key];return source===null?<p key={key}>Explicit first observation: no earlier original was supplied.</p>:<details key={key} open={key==="current"}>
      <summary>{key==="current"?"Current selected-page references":"Earlier selected-page references"}</summary>
      <p>Passive source address: <bdi>{source.source_url}</bdi></p>
      <p>Original SHA-256: <code>{source.content_sha256}</code></p>
      <ul>{source.selected_pages.map(page=><li key={page.locator}>Physical page {page.page_number} / <bdi>{page.locator}</bdi>{page.locator===c.support.locator?" / proposed claim locator":""} / <code>{page.page_text_sha256}</code></li>)}</ul>
    </details>;})}
    <h3>Separate historical times</h3><dl>
      <dt>Original inspection observation</dt><dd><time>{p.recorded_observed_at}</time></dd>
      <dt>Result prepared</dt><dd><time>{p.artifact_prepared_at}</time></dd>
      <dt>Result stored</dt><dd><time>{p.artifact_stored_at}</time></dd>
      <dt>Result reopened and candidate prepared</dt><dd><time>{p.prepared_at}</time>. Opening this view does not renew these observations.</dd></dl>
    <h3>Preserved four-part preparation</h3>
    <p>Payload, selection, distinct PDF provenance and exact original context remain together in the admitted bundle. Their separately expected hashes identify intended bytes; they do not authenticate the sender, storage, held decision or issue.</p>
    <dl><dt>Payload SHA-256</dt><dd><code>{result.expected.payloadSha256}</code></dd><dt>Selection SHA-256</dt><dd><code>{result.expected.selectionSha256}</code></dd>
      <dt>PDF provenance SHA-256</dt><dd><code>{result.expected.provenanceSha256}</code></dd><dt>Exact context SHA-256</dt><dd><code>{result.expected.contextSha256}</code></dd></dl>
    <p>Complete PDF, model request, raw output and original context spelling are not displayed. This reader checks supplied consistency; it does not repeat original inspection or establish source rights, factual support, current authorization, capture or publication eligibility.</p>
  </section>;
}
