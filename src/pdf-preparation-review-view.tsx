import { pdfPreparationReviewReport } from "./server/pdf-preparation-review-report.ts";
import { PdfHeldPreparationView } from "./pdf-held-preparation-view.tsx";

export function PdfPreparationReviewView({reportJson,expected}:{reportJson:unknown;expected:unknown}) {
  const result=pdfPreparationReviewReport(reportJson,expected);
  if(result===null)return <section><h2>Saved PDF preparation unavailable</h2><p>No partial candidate, source reference or storage identity is displayed.</p></section>;
  const {report}=result,p=report.preparation;
  return <section aria-labelledby="saved-pdf-heading"><h2 id="saved-pdf-heading">Saved PDF preparation</h2>
    <p>This supplied historical record keeps a preparation and its PDF result together. It does not authenticate storage, the source or an operator. Saving a preparation does not capture it against an issue or authorize publication.</p>
    <dl><dt>Preparation operation</dt><dd><code>{p.operation_id}</code></dd>
      <dt>Supplied preparation artifact</dt><dd><code>{p.artifact_id}</code></dd>
      <dt>Associated result operation</dt><dd><code>{p.result_operation_id}</code></dd>
      <dt>Historical candidate prepared</dt><dd><time>{p.prepared_at}</time></dd>
      <dt>Supplied preparation stored</dt><dd><time>{p.stored_at}</time></dd>
      <dt>Later report observation</dt><dd><time>{report.observed_at}</time>. Reopening does not renew the old held decision, source rights, issue basis or evidence review.</dd>
      <dt>Full preparation receipt SHA-256</dt><dd><code>{p.receipt_sha256}</code></dd>
      <dt>Preparation intent SHA-256</dt><dd><code>{p.intent_sha256}</code></dd>
      <dt>Stored packet SHA-256</dt><dd><code>{p.packet_sha256}</code></dd></dl>
    <p>The complete originals and native receipts are omitted from this passive report. This reader checks the separately expected report, intent, artifact, stored time and observation; it does not repeat the original inspection or establish current eligibility.</p>
    <PdfHeldPreparationView bundle={result.bundle} expected={result.identity}/>
  </section>;
}
