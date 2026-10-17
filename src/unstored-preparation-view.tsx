import { recordedUnstoredPreparation } from "./server/recorded-unstored-preparation.ts";

export function UnstoredPreparationView({record}:{record:unknown}){
 const report=recordedUnstoredPreparation(record);
 if(report===null)return <section role="status"><h2>Unstored preparation unavailable</h2><p>No partial candidate, context or evidence is displayed.</p></section>;
 const {snapshot,selection,metadata,context}=report,claim=snapshot.claims[0]!,evidence=claim.evidence[0]!;
 return <section aria-labelledby="unstored-preparation-heading"><h2 id="unstored-preparation-heading">Prepared candidate before storage</h2>
  <p>Entirely invented recorded example. This pure preparation is not stored and has not been captured. The existing stored-preparation and whole-issue views describe different records.</p>
  <article id="unstored-candidate" tabIndex={-1}><h3><bdi>{snapshot.title}</bdi></h3><p><bdi>{snapshot.summary}</bdi></p>
   <blockquote style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}><bdi>{claim.assertion}</bdi></blockquote>
   <dl><dt>Proposed category / period</dt><dd><bdi>{claim.type}</bdi> / <bdi>{claim.periodLabel}</bdi></dd>
    <dt>Supplied jurisdiction / issue</dt><dd><code>{snapshot.jurisdictionSlug}</code> / <code>{snapshot.issueSlug}</code></dd>
    <dt>Independently supplied evidence-review date</dt><dd><time dateTime={snapshot.lastEvidenceReviewOn}>{snapshot.lastEvidenceReviewOn}</time>. This date does not establish a completed review.</dd></dl>
   <p><a href="#unstored-source">Inspect the proposed source reference</a></p></article>
  <h3>Observed empty current head</h3><p>The existing publication-head row had both current fields empty at its original observation. This does not mean the issue has never had a publication. No baseline was selected or fabricated.</p>
  <dl><dt>Observed run / held decision / issue</dt><dd><code>{selection.runId}</code> / <code>{selection.decisionId}</code> / <code>{selection.issueId}</code></dd>
   <dt>Original context observation</dt><dd><time dateTime={context.observedAt}>{context.observedAt}</time></dd>
   <dt>Retained after-read UTC observation</dt><dd><time dateTime={context.trustedObservedAt}>{context.trustedObservedAt}</time></dd>
   <dt>Pure preparation time</dt><dd><time dateTime={metadata.prepared_at}>{metadata.prepared_at}</time></dd>
   <dt>Planned preparation / planned capture identities</dt><dd><code>{metadata.operation_id}</code> / <code>{selection.captureId}</code>. These identities are not storage receipts.</dd></dl>
  <p>This is one unverified claim with technical single-claim intent. It is not an accepted replacement for the whole issue. Historical context is not renewed by viewing this page and does not authenticate an operator or establish current work.</p>
  <article id="unstored-source" tabIndex={-1}><h3>Proposed source reference</h3><p>Support is proposed only. The original documents and model output are not replayed or independently reverified by this view.</p>
   <dl><dt>Source title / publisher</dt><dd><bdi>{evidence.title}</bdi> / <bdi>{evidence.publisher}</bdi></dd>
    <dt>Selected source version / locator</dt><dd><code>{evidence.sourceVersionId}</code> / <bdi>{evidence.locator}</bdi></dd>
    <dt>Source address, not opened</dt><dd><bdi>{evidence.url}</bdi></dd>
    <dt>Source publication / retrieval</dt><dd>{evidence.sourcePublishedOn??"Not supplied"} / <time dateTime={evidence.retrievedAt}>{evidence.retrievedAt}</time></dd></dl>
   <p><a href="#unstored-candidate">Back to the prepared candidate</a></p></article>
  <details><summary>Exact four-part and intent fingerprints</summary><dl>
   <dt>Payload / selection</dt><dd><code>{metadata.payload_sha256}</code> / <code>{metadata.selection_sha256}</code></dd>
   <dt>Companion / original context</dt><dd><code>{metadata.provenance_sha256}</code> / <code>{metadata.context_raw_sha256}</code></dd>
   <dt>Original pure preparation intent</dt><dd><code>{report.intentSha256}</code></dd></dl><p>These fingerprints identify supplied historical bytes. No preparation-store receipt, stored-at time or capture receipt is invented.</p></details>
  <p>Source rights, factual support, conflict and translation review, current assignment and publication remain unqualified. No storage, capture or editorial action is available.</p>
 </section>;
}
