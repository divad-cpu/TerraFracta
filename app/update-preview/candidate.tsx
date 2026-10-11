import { useId } from "react";
import type { FictionalPublicationDraft } from "../../src/fictional-publication-draft";

export function FictionalCandidate({ candidate }: { candidate: FictionalPublicationDraft }) {
  const heading = useId();
  const claim = candidate.publication.snapshot.claims[0];
  const evidence = claim.evidence[0];
  return (
    <section className="update-candidate" aria-labelledby={heading}>
      <div className="section-heading"><div><p className="eyebrow">From source bytes to a page draft</p><h2 id={heading}>Inspect the proposed fact</h2></div><span className="tag tag--caution">Fictional draft · not published</span></div>
      <article className="update-candidate__page">
        <p className="eyebrow">{candidate.publication.snapshot.title}</p>
        <h3>{claim.assertion}</h3>
        <p>{candidate.publication.snapshot.summary}</p>
        <dl className="update-candidate__facts">
          <div><dt>Period</dt><dd>{candidate.observation.period}</dd></div>
          <div><dt>Exact source value</dt><dd>{candidate.observation.value}%</dd></div>
          <div><dt>Fixture check date</dt><dd>{candidate.publication.snapshot.lastEvidenceReviewOn}</dd></div>
        </dl>
        <div className="update-report__source"><strong>{evidence.title}</strong><span>{evidence.publisher}</span><a href={evidence.url}>Illustrative source address</a><span>Exact location: <code>{evidence.locator}</code></span><span>Fixture retrieval: <time dateTime={evidence.retrievedAt}>{evidence.retrievedAt}</time></span></div>
        <details><summary>How the draft is bound to the source</summary><p>The source version, content fingerprint, data mapping and location match the checked item. The sentence is built from the exact parsed value; no model wrote it.</p><dl><dt>Source version</dt><dd><code>{candidate.decision.sourceVersionId}</code></dd><dt>Content fingerprint</dt><dd><code>{candidate.decision.contentSha256}</code></dd><dt>Draft reference</dt><dd><code>{candidate.publication.id}</code></dd></dl></details>
      </article>
      <p className="update-candidate__limit">This proposed reading remains a draft. A real page needs a qualified source, an authorized publication transaction and verification of the visible revision. The other held findings are excluded.</p>
    </section>
  );
}
