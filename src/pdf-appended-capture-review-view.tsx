import { parseStoredPdfAppendedIssueCapture } from "./server/pdf-appended-issue-capture.ts";
import { PdfAppendedIssueReviewView } from "./pdf-appended-issue-review-view.tsx";

export function PdfAppendedCaptureReviewView({receipt,intentJson,expected,observedAt}:{receipt:unknown;intentJson:unknown;expected:unknown;observedAt:unknown}) {
  let saved:ReturnType<typeof parseStoredPdfAppendedIssueCapture>;
  try { saved=parseStoredPdfAppendedIssueCapture(receipt,intentJson,expected,observedAt); }
  catch { return <section><h2>Captured PDF whole-issue review unavailable</h2><p>No partial baseline, candidate, source reference or storage identity is displayed.</p></section>; }
  const c=saved.capture,p=JSON.parse(saved.bundle.candidateReportJson).preparation;
  return <section aria-labelledby="pdf-whole-capture-heading"><h2 id="pdf-whole-capture-heading">Captured PDF whole-issue proposal</h2>
    <p>This supplied historical receipt keeps a complete issue proposal and its six original composition parts together. It is a private technical review record, not an accepted issue edition. The receipt does not authenticate storage, a source or an operator, establish current work or authorize publication.</p>
    <dl><dt>Supplied whole-issue capture</dt><dd><code>{c.captureId}</code></dd><dt>Held decision</dt><dd><code>{c.decisionId}</code></dd>
      <dt>Issue</dt><dd><code>{c.issueId}</code></dd><dt>Historical publication basis</dt><dd><code>{c.basePublicationId}</code></dd>
      <dt>Historical basis SHA-256</dt><dd><code>{c.baseContentSha256}</code></dd><dt>Historical head changed</dt><dd><time>{c.baseHeadChangedAt}</time></dd>
      <dt>Whole proposal captured</dt><dd><time>{c.capturedAt}</time></dd><dt>Complete composition companion stored</dt><dd><time>{saved.storedAt}</time></dd>
      <dt>Later receipt observation</dt><dd><time>{saved.observedAt}</time></dd><dt>Earlier PDF preparation artifact</dt><dd><code>{p.artifact_id}</code></dd>
      <dt>Earlier PDF preparation stored</dt><dd><time>{p.stored_at}</time></dd><dt>Complete supplied receipt SHA-256</dt><dd><code>{saved.receiptSha256}</code></dd></dl>
    <p>The separate receipt above records a later association. The exact earlier composition below keeps its original uncaptured wording and observation, including the still earlier single-candidate preparation. Neither is rewritten into current authorization or a new evidence review.</p>
    <p>The reader checks the complete supplied receipt, all six parts, the retained prewrite intent and all eight independent expectations. It opens no PDF, reads no database and checks no present issue head or work lease. A historical complete capture does not establish source rights, factual support, conflict coverage, translation approval or publication eligibility. No editorial action is available.</p>
    <PdfAppendedIssueReviewView bundle={saved.bundle} expected={saved.expected}/>
  </section>;
}
