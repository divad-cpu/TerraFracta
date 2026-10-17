import { detachedPreparationReport } from "./server/detached-preparation-report.ts";
import { PrivateExtractionView } from "./private-extraction-view.tsx";

export function DetachedPreparationView({ raw, expected }: { raw: unknown; expected: unknown }) {
  const report = detachedPreparationReport(raw,expected);
  if (report === null) return <section><h2>Historical preparation unavailable</h2><p>No partial candidate, context or evidence is displayed.</p></section>;
  const { preparation:p,metadata:m,snapshot,selection,history,extraction } = report;
  return <section aria-labelledby="detached-preparation-heading">
    <h2 id="detached-preparation-heading">Historical private preparation</h2>
    <p>Entirely invented example. This is one unverified claim prepared for technical review. It is not an accepted replacement for the whole issue.</p>
    <article id="detached-prepared-candidate" tabIndex={-1}><h3><bdi>{snapshot.title}</bdi></h3><p><bdi>{snapshot.summary}</bdi></p>
      <p>Supplied issue: <code>{snapshot.jurisdictionSlug}</code> / <code>{snapshot.issueSlug}</code>. Proposed period: <bdi>{snapshot.claims[0]!.periodLabel}</bdi>.</p>
      <p><a href="#extraction-candidate">Inspect the unverified assertion and exact source passages</a></p></article>
    <h3>Supplied historical review context</h3>
    <p>The context was supplied independently to the local preparation exercise. Matching identifiers do not authenticate the issuer or establish an actual held decision, current issue head or factual support.</p>
    <dl><dt>Supplied run / decision</dt><dd><code>{selection.runId}</code> / <code>{selection.decisionId}</code></dd>
      <dt>Supplied held-decision time</dt><dd><time dateTime={history.held.decided_at}>{history.held.decided_at}</time></dd>
      <dt>Supplied issue / head observation</dt><dd><code>{selection.issueId}</code> / <time dateTime={history.issue.observed_at}>{history.issue.observed_at}</time></dd>
      <dt>Supplied historical base</dt><dd>{selection.basePublicationId === null ? "Explicitly supplied as empty at that observation. The current public head is not checked." : <>Publication <code>{selection.basePublicationId}</code>, changed <time dateTime={history.issue.head.changed_at!}>{history.issue.head.changed_at}</time>. Its present state is not checked.</>}</dd>
      <dt>Supplied evidence-review date</dt><dd><time dateTime={snapshot.lastEvidenceReviewOn}>{snapshot.lastEvidenceReviewOn}</time>. Independently supplied; this preparation does not perform that review.</dd></dl>
    <h3>Different times, different meanings</h3>
    <ol><li>Private artifact observed for the original preparation: <time dateTime={p.historical_artifact_observed_at}>{p.historical_artifact_observed_at}</time>.</li>
      <li>Preparation created: <time dateTime={p.prepared_at}>{p.prepared_at}</time>.</li>
      <li>Preparation stored: <time dateTime={p.stored_at}>{p.stored_at}</time>.</li>
      <li>Complete private artifact reobserved: <time dateTime={extraction.observed_at}>{extraction.observed_at}</time>.</li>
      <li>Preparation read for this report: <time dateTime={report.observedAt}>{report.observedAt}</time>.</li></ol>
    <p>A later read preserves historical bytes. It does not renew source rights, support, translation, a held decision or the current publication head.</p>
    <details><summary>Preparation identity and exact-part fingerprints</summary><dl>
      <dt>Preparation operation / stored artifact</dt><dd><code>{p.operation_id}</code> / <code>{p.artifact_id}</code></dd>
      <dt>Payload / selection hashes</dt><dd><code>{m.payload_sha256}</code> / <code>{m.selection_sha256}</code></dd>
      <dt>Companion / original context hashes</dt><dd><code>{m.provenance_sha256}</code> / <code>{m.context_raw_sha256}</code></dd>
      <dt>Full stored receipt / report hashes</dt><dd><code>{p.full_receipt_sha256}</code> / <code>{report.reportSha256}</code></dd></dl>
      <p>The four original parts include the original context spelling. These fingerprints identify supplied bytes; they do not authenticate storage or prove the omitted full originals and model output here. The Python producer rechecks full custody.</p></details>
    <h3>What still needs review</h3><p>Support is proposed only. Conflict and translation assessments are not recorded. No actual held capture, work lease, current-head check, source-rights clearance or publication is connected. No editorial action is available.</p>
    <PrivateExtractionView input={extraction} />
    <p><a href="#detached-prepared-candidate">Back to the historical preparation</a></p>
  </section>;
}
