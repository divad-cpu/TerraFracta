import { admitAppendedIssueReview } from "./server/appended-issue-review.ts";
import { recordedProposalBaseSchema } from "./operator-proposal-capture.ts";
import { decodeProposalCapture } from "./server/proposal-capture.ts";
import { compareRecordedProposalSnapshots } from "./recorded-proposal-changes.ts";
import { statementLabels } from "./issue-display-labels.ts";
import { DetachedPreparationView } from "./detached-preparation-view.tsx";

export function AppendedIssueReviewView({ bundle, expected }: { bundle: unknown; expected: unknown }) {
  let admitted: ReturnType<typeof admitAppendedIssueReview>;
  try { admitted=admitAppendedIssueReview(bundle,expected); }
  catch { return <section><h2>Whole-issue preparation unavailable</h2><p>No partial baseline, candidate or source text is displayed.</p></section>; }
  const { bundle:b,capturePreparation }=admitted;
  const base=recordedProposalBaseSchema.parse(JSON.parse(b.canonicalBaselineJson));
  const proposed=decodeProposalCapture(b.proposalJson,capturePreparation.proposalSha256);
  const changes=compareRecordedProposalSnapshots(base.snapshot,proposed.snapshot),added=proposed.snapshot.claims.at(-1)!;
  const proof=JSON.parse(b.compositionJson) as { observed_at:string;baseline_sha256:string;context_raw_sha256:string };
  const candidate=JSON.parse(b.candidateReportJson) as { intent_json:string };
  return <section aria-labelledby="appended-review-heading"><h2 id="appended-review-heading">Whole-issue preparation for review</h2>
    <p>Entirely invented, unverified example. Existing statements are preserved and one candidate is appended. This preparation is not saved as an actual held proposal and cannot publish a page.</p>
    <p>{changes.counts.unchanged} preserved statements; {changes.counts.added} proposed new statement; {changes.counts.changed} rewritten; {changes.counts.removed} removed. Existing statement order and all reference occurrences are preserved. Repeated uses of a source are not independent confirmation.</p>
    <p>Issue: <code>{base.snapshot.jurisdictionSlug}</code> / <code>{base.snapshot.issueSlug}</code>. Historical baseline revision {base.revision}, publication <code>{base.id}</code>. Its present head and source state have not been read.</p>
    <h3>Explicit whole-page wording</h3><p>These fields were supplied for the complete issue. Their factual and editorial consistency still require review. A supplied review date does not prove that a review occurred.</p>
    <dl><dt>Historical title</dt><dd><bdi>{base.snapshot.title}</bdi></dd><dt>Proposed title</dt><dd><bdi>{proposed.snapshot.title}</bdi></dd>
      <dt>Historical summary</dt><dd><bdi>{base.snapshot.summary}</bdi></dd><dt>Proposed summary</dt><dd><bdi>{proposed.snapshot.summary}</bdi></dd>
      <dt>Historical evidence-review date</dt><dd><time dateTime={base.snapshot.lastEvidenceReviewOn}>{base.snapshot.lastEvidenceReviewOn}</time></dd>
      <dt>Supplied whole-issue evidence-review date</dt><dd><time dateTime={proposed.snapshot.lastEvidenceReviewOn}>{proposed.snapshot.lastEvidenceReviewOn}</time></dd></dl>
    <p>Changed whole-page fields: {changes.snapshotFields.length ? changes.snapshotFields.join(", ") : "None"}. Display language: <bdi>{proposed.translation.displayLanguage}</bdi>; translation status: {proposed.translation.status}. Conflict assessment: not recorded.</p>
    <details><summary>Inspect all {base.snapshot.claims.length} preserved historical statements and references</summary><p>Preserved wording is historical supplied material, not a new factual endorsement.</p>
      <ol>{base.snapshot.claims.map((claim,index)=><li key={claim.id}><h4>Historical statement {index+1} · {statementLabels[claim.type]}</h4><p><bdi>{claim.assertion}</bdi></p><p>Data period: <bdi>{claim.periodLabel}</bdi>.</p>
        <ul>{claim.evidence.map((e,i)=><li key={i}><p>Reference {i+1} · {e.relation} · <bdi>{e.title}</bdi> · <bdi>{e.publisher}</bdi></p>
          <p>Location: <bdi>{e.locator}</bdi>. Source address: <code>{e.url}</code>.</p><p>Source version: <code>{e.sourceVersionId}</code>; published: {e.sourcePublishedOn??"Not recorded"}; retrieved: <time dateTime={e.retrievedAt}>{e.retrievedAt}</time>.</p></li>)}</ul></li>)}</ol></details>
    <article id="appended-proposed-statement" tabIndex={-1}><h3>Proposed appended statement {proposed.snapshot.claims.length} · {statementLabels[added.type]}</h3>
      <p><bdi>{added.assertion}</bdi></p><p>Proposed data period: <bdi>{added.periodLabel}</bdi>.</p><p><a href="#extraction-candidate">Inspect this candidate and its exact earlier and current passages</a></p></article>
    <details><summary>Complete proposal dependency manifest</summary><p>Every cited version is included exactly once. This is an identity check; current reuse rights, independent origins and factual support remain unchecked.</p>
      <ol>{proposed.dependencyManifest.sourceVersionIds.map(id=><li key={id}><code>{id}</code></li>)}</ol></details>
    <h3>Preparation identity and remaining gates</h3><p>Composition observed: <time dateTime={proof.observed_at}>{proof.observed_at}</time>. Opening this example performs no fresh storage read.</p>
    <details><summary>Exact baseline, context and composed payload fingerprints</summary><dl><dt>Original baseline</dt><dd><code>{proof.baseline_sha256}</code></dd>
      <dt>Explicit whole-issue context</dt><dd><code>{proof.context_raw_sha256}</code></dd><dt>Composed payload</dt><dd><code>{capturePreparation.proposalSha256}</code></dd><dt>Composition proof</dt><dd><code>{admitted.compositionSha256}</code></dd></dl>
      <p>The original baseline spelling is retained separately from its canonical counterpart. Python checks duplicate-free original JSON; this TypeScript view checks byte identities, canonical correspondence and the existing complete payload schema. Matching hashes are not authenticated provenance.</p></details>
    <p>The six-value capture command is prepared but never executed. Atomic linkage of the complete composition evidence to an actual held capture remains open. Current source, head, principal, work lease, translation, conflict and publication gates still apply. No editorial action is available.</p>
    <details><summary>Inspect the original single-candidate preparation without replacing its intent</summary><DetachedPreparationView raw={b.candidateReportJson}
      expected={{reportSha256:JSON.parse(b.compositionJson).candidate_report_sha256,preparationIntentJson:candidate.intent_json}} /></details>
    <p><a href="#appended-proposed-statement">Back to the proposed appended statement</a></p>
  </section>;
}
