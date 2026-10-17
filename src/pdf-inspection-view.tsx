import { pdfInspectionReport } from "./server/pdf-inspection-report.ts";

const wholeReasons = { pdf_encrypted: "Encrypted PDF held", pdf_parse_unavailable: "PDF parsing unavailable",
  pdf_page_limit: "PDF page limit exceeded", pdf_output_limit: "PDF report output limit exceeded" };
const pageReasons = { page_content_limit: "Page content limit exceeded", page_text_limit: "Page text limit exceeded",
  page_text_unusable: "Page text is unusable", page_extraction_unavailable: "Page text extraction unavailable" };

export function PdfInspectionView({ input }: { input: unknown }) {
  const report = pdfInspectionReport(input);
  if (!report) return <section><h2>PDF inspection unavailable</h2><p>No partial page text or document references are displayed.</p></section>;
  return <section aria-labelledby="pdf-inspection-heading"><h2 id="pdf-inspection-heading">Supplied native PDF text inspection</h2>
    <p>This checks a supplied unverified report. Original PDF bytes are omitted and are not parsed again by this view. Text hashes are checked; the supplied original-file hash is not independently verified here.</p>
    <dl><dt>Source / item / version receipt</dt><dd><bdi>{report.document.source_key}</bdi> / <bdi>{report.document.item_key}</bdi> / <code>{report.document.source_version_id}</code></dd>
      <dt>Source address, not opened</dt><dd><bdi>{report.document.source_url}</bdi></dd>
      <dt>Supplied original PDF bytes / SHA-256</dt><dd>{report.original_bytes} / <code>{report.document.content_sha256}</code></dd>
      <dt>Supplied retrieval time</dt><dd><time dateTime={report.document.retrieved_at}>{report.document.retrieved_at}</time>. This is not a source publication date.</dd>
      <dt>Inspection observation time</dt><dd><time dateTime={report.observed_at}>{report.observed_at}</time>. Opening this view does not renew this observation.</dd>
      <dt>Parser profile</dt><dd><code>{report.parser_identity}</code></dd></dl>
    {report.state === "held" ? <div className="info-band"><h3>{wholeReasons[report.reason_code!]}</h3><p>The whole document inspection is held. No page count or partial page text is available.</p></div> : <>
      <p>{report.page_count} physical pages inspected. Physical page indices are one-based positions, not printed PDF page labels or original byte offsets.</p>
      <nav aria-label="PDF physical pages"><ul>{report.pages.map(p => <li key={p.page_number}><a href={`#pdf-physical-page-${p.page_number}`}>Physical page {p.page_number}</a></li>)}</ul></nav>
      {report.pages.map(p => <article key={p.page_number} id={`pdf-physical-page-${p.page_number}`} tabIndex={-1}><h3>Physical page {p.page_number}</h3>
        {p.state === "text_extracted" ? <><h4>Exact derived native text</h4><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><bdi>{p.text}</bdi></pre>
          <p>Derived UTF-8 text SHA-256: <code>{p.text_sha256}</code>.</p></> : p.state === "no_native_text" ?
          <p>No native text was returned for this page. This does not establish an empty document, a scanned page or an absence of relevant evidence.</p> :
          <p>Page held: {pageReasons[p.reason_code]}. No text or unsafe parser details are displayed for this page.</p>}
        <p><a href="#pdf-inspection-heading">Back to inspection overview</a></p></article>)}
    </>}
    <p>This is not a rendered PDF. Reading order, tables, visual layout, OCR, factual support, source authority, permissions and publication eligibility are not verified. A page with text does not establish complete extraction; held or textless pages remain unresolved.</p>
    <p>Fixed profile: at most 65,536 input bytes, eight physical pages, 8,192 UTF-8 text bytes per page and 65,536 total text bytes. Declared worker limits are part of this supplied report, not proof that this view ran an isolated worker.</p>
  </section>;
}
