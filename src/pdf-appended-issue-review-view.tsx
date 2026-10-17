import { admitPdfAppendedIssueReview } from "./server/pdf-appended-issue-review.ts";
import { recordedProposalBaseSchema } from "./operator-proposal-capture.ts";
import { decodeProposalCapture } from "./server/proposal-capture.ts";
import { compareRecordedProposalSnapshots } from "./recorded-proposal-changes.ts";
import { statementLabels } from "./issue-display-labels.ts";
import { PdfPreparationReviewView } from "./pdf-preparation-review-view.tsx";

export function PdfAppendedIssueReviewView({bundle,expected}:{bundle:unknown;expected:unknown}) {
  let admitted:ReturnType<typeof admitPdfAppendedIssueReview>;
  try { admitted=admitPdfAppendedIssueReview(bundle,expected); }
  catch { return <section><h2>PDF whole-issue preparation unavailable</h2><p>No partial baseline, candidate, source reference or storage identity is displayed.</p></section>; }
  const b=admitted.bundle,base=recordedProposalBaseSchema.parse(JSON.parse(b.canonicalBaselineJson)),
    proposed=decodeProposalCapture(b.proposalJson,admitted.encodedProposal.proposalSha256),
    changes=compareRecordedProposalSnapshots(base.snapshot,proposed.snapshot),proof=JSON.parse(b.compositionJson),report=JSON.parse(b.candidateReportJson);
  return <section aria-labelledby="pdf-appended-review-heading"><h2 id="pdf-appended-review-heading">PDF whole-issue preparation for review</h2>
    <p>Entirely invented and unverified. This complete proposal preserves the supplied historical statements and appends one PDF-derived candidate. It has not been captured against the issue and cannot publish a page.</p>
    <p>{changes.counts.unchanged} preserved statements; {changes.counts.added} proposed new statement; {changes.counts.changed} rewritten; {changes.counts.removed} removed. Historical order and every reference occurrence are preserved. Repeated uses of a source are not independent confirmation.</p>
    <p>Issue: <code>{base.snapshot.jurisdictionSlug}</code> / <code>{base.snapshot.issueSlug}</code>. Supplied historical revision {base.revision}, publication <code>{base.id}</code>. No current issue head has been read.</p>
    <h3>Explicit whole-page wording</h3><p>The complete issue title, summary, review date and translation were supplied separately. They are not inferred from the new candidate. A review date does not prove a review occurred.</p>
    <dl><dt>Historical title</dt><dd><bdi>{base.snapshot.title}</bdi></dd><dt>Proposed title</dt><dd><bdi>{proposed.snapshot.title}</bdi></dd>
      <dt>Historical summary</dt><dd><bdi>{base.snapshot.summary}</bdi></dd><dt>Proposed summary</dt><dd><bdi>{proposed.snapshot.summary}</bdi></dd>
      <dt>Historical evidence-review date</dt><dd><time>{base.snapshot.lastEvidenceReviewOn}</time></dd><dt>Supplied whole-issue evidence-review date</dt><dd><time>{proposed.snapshot.lastEvidenceReviewOn}</time></dd></dl>
    <p>Changed whole-page fields: {changes.snapshotFields.length?changes.snapshotFields.join(", "):"None"}. Display language: <bdi>{proposed.translation.displayLanguage}</bdi>; translation status: {proposed.translation.status}. Conflict assessment: not recorded.</p>
    <h3>Preserved statements and proposed addition</h3><p>Preserved wording is historical supplied material, not a new factual endorsement. The final statement is the proposed addition.</p>
    <ol>{proposed.snapshot.claims.map((claim,index)=><li key={claim.id} id={`pdf-composed-statement-${index+1}`}>
      <h4>{index<base.snapshot.claims.length?"Historical statement":"Proposed appended statement"} {index+1} · {statementLabels[claim.type]}</h4>
      <p><bdi>{claim.assertion}</bdi></p><p>Data period: <bdi>{claim.periodLabel}</bdi>.</p>
      <ul>{claim.evidence.map((e,i)=><li key={i}><p>Reference {i+1} · {e.relation} · <bdi>{e.title}</bdi> · <bdi>{e.publisher}</bdi></p>
        <p>Location: <bdi>{e.locator}</bdi>. Passive source address: <code>{e.url}</code>.</p>
        <p>Source version: <code>{e.sourceVersionId}</code>; published: {e.sourcePublishedOn??"Not recorded"}; retrieved: <time>{e.retrievedAt}</time>.</p></li>)}</ul>
      {index===base.snapshot.claims.length&&<p><a href="#saved-pdf-heading">Inspect this candidate’s earlier stored preparation and physical page correspondence</a></p>}
    </li>)}</ol>
    <details><summary>Complete proposal dependency manifest</summary><p>Every cited version is listed once. Identity does not establish reuse rights, independent origin or factual support.</p>
      <ol>{proposed.dependencyManifest.sourceVersionIds.map(id=><li key={id}><code>{id}</code></li>)}</ol></details>
    <details><summary>Composition identity and remaining gates</summary><dl>
      <dt>Composition observation</dt><dd><time>{proof.observed_at}</time></dd><dt>Original baseline SHA-256</dt><dd><code>{proof.baseline_sha256}</code></dd>
      <dt>Supplied whole-issue context SHA-256</dt><dd><code>{proof.context_raw_sha256}</code></dd><dt>Composed payload SHA-256</dt><dd><code>{admitted.encodedProposal.proposalSha256}</code></dd>
      <dt>Composition proof SHA-256</dt><dd><code>{admitted.compositionSha256}</code></dd></dl>
      <p>The six original parts stay together. Their matching hashes are supplied byte identities, not authenticated provenance. This passive view opens no PDF, reads no database and performs no capture. Atomic storage of the complete composition, current source rights, issue head, principal, work lease, factual support, translation, conflict and publication remain separate gates. No editorial action is available.</p></details>
    <details><summary>Inspect the separate original single-candidate preparation</summary><p>The exact older preparation below remains uncaptured; its wording and historical times are preserved. It is not the complete issue proposal displayed above.</p>
      <PdfPreparationReviewView reportJson={b.candidateReportJson} expected={{reportSha256:proof.candidate_report_sha256,preparationIntentJson:report.intent_json,preparationArtifactId:report.preparation.artifact_id,preparationStoredAt:report.preparation.stored_at,observedAt:proof.observed_at}}/>
    </details>
    <p><a href={`#pdf-composed-statement-${proposed.snapshot.claims.length}`}>Back to the proposed appended statement</a></p>
  </section>;
}
