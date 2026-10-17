import { pdfPacketReopenReport } from "./server/pdf-packet-reopen-report.ts";
import { PdfInspectionView } from "./pdf-inspection-view.tsx";

export function PdfPacketReopenView({ input }: { input: unknown }) {
  const report = pdfPacketReopenReport(input);
  if (!report) return <section><h2>PDF reopening report unavailable</h2><p>No partial packet references, document references or page text are displayed.</p></section>;
  return <section aria-labelledby="pdf-reopening-heading"><h2 id="pdf-reopening-heading">Supplied PDF packet reopening report</h2>
    <p>This is a supplied unverified report. Opening this view reopens no bytes, parses no PDF and renews no source check.</p>
    <dl><dt>Original recorded inspection observation</dt><dd><time dateTime={report.recorded_observed_at}>{report.recorded_observed_at}</time>. This historical observation is retained.</dd>
      <dt>Separately supplied reopening time</dt><dd><time dateTime={report.reopened_at}>{report.reopened_at}</time>. This does not make the source newly verified or current.</dd>
      <dt>Supplied packet SHA-256 reference</dt><dd><code>{report.packet_sha256}</code></dd>
      <dt>Checked supplied inspection-report SHA-256</dt><dd><code>{report.inspection_sha256}</code></dd>
      <dt>Supplied derivation-manifest SHA-256 reference</dt><dd><code>{report.derivation_sha256}</code></dd></dl>
    <p>The original PDF, complete packet and derivation manifest are omitted. Packet and manifest hashes are supplied references and are not recomputed here. The inspection hash is checked against the fixed compact UTF-8 report profile including its final newline.</p>
    <p>A matching report does not prove that a PDF worker ran, that bytes were stored or that a principal authenticated them. No selected-page map is supplied here: inspected pages do not imply selected model coverage. No request, token proof or publication permission follows.</p>
    <PdfInspectionView input={report.inspection_report} />
  </section>;
}
