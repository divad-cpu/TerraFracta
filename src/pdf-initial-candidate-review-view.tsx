import { parseStoredPdfInitialCandidateCapture } from "./server/pdf-initial-candidate-capture.ts";
import { PdfHeldPreparationView } from "./pdf-held-preparation-view.tsx";

export function PdfInitialCandidateReviewView({receipt,intentJson,expected,observedAt}:{receipt:unknown;intentJson:unknown;expected:unknown;observedAt:unknown}) {
  let saved:ReturnType<typeof parseStoredPdfInitialCandidateCapture>;
  try { saved=parseStoredPdfInitialCandidateCapture(receipt,intentJson,expected,observedAt); }
  catch { return <section><h2>PDF candidate capture unavailable</h2><p>No partial candidate, source reference or storage identity is displayed.</p></section>; }
  const c=saved.capture,p=saved.preparation.report.preparation;
  return <section aria-labelledby="pdf-candidate-capture-heading"><h2 id="pdf-candidate-capture-heading">PDF candidate capture</h2>
    <p>This supplied historical receipt associates one candidate and its complete PDF preparation with an initially empty issue head. It is a review record; it does not authenticate a source, storage or an operator, establish current work or authorize publication.</p>
    <dl><dt>Supplied candidate capture</dt><dd><code>{c.captureId}</code></dd>
      <dt>Held decision</dt><dd><code>{c.decisionId}</code></dd>
      <dt>Issue</dt><dd><code>{c.issueId}</code></dd>
      <dt>Historical candidate captured</dt><dd><time>{c.capturedAt}</time></dd>
      <dt>PDF companion stored</dt><dd><time>{saved.storedAt}</time></dd>
      <dt>Later receipt observation</dt><dd><time>{saved.observedAt}</time></dd>
      <dt>Preparation operation</dt><dd><code>{p.operation_id}</code></dd>
      <dt>Preparation artifact</dt><dd><code>{p.artifact_id}</code></dd>
      <dt>Earlier preparation stored</dt><dd><time>{p.stored_at}</time></dd>
      <dt>Complete supplied capture receipt SHA-256</dt><dd><code>{saved.receiptSha256}</code></dd></dl>
    <p>The detached preparation below remains the exact earlier, uncaptured record. Its wording and times are preserved. The separate supplied receipt above records the later association; neither record establishes the issue’s current publication head or permits replacing a complete issue with this single claim.</p>
    <p>The reader checks the full supplied receipt against its separately retained intent, report, preparation identity and times. It does not open the original PDF, contact a database or renew source rights, translation, factual support, review or work eligibility.</p>
    <PdfHeldPreparationView bundle={saved.preparation.bundle} expected={saved.preparation.identity}/>
  </section>;
}
