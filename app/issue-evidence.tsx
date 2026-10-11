import { glossaryDefinitionHref, type GlossaryTermSlug } from "../src/evidence-glossary.ts";
import { readingGuideHref } from "../src/current-reading-guide.ts";
import { issueReadingOverview } from "../src/issue-reading-overview.ts";
import type { PublicIssueProjection } from "../src/public-issue-projection";
import { evidenceLabels, statementLabels, type StatementType, type EvidenceRelation } from "../src/issue-display-labels.ts";
import { issueSourceIndex, issueReferenceAnchor } from "../src/issue-source-index.ts";

const statementDefinitions = {
  condition: "condition", policy_action: "policy-action", funding: "funding",
  delivery: "delivery", attributed_finding: "attributed-finding", evaluation: "evaluation",
} as const satisfies Record<StatementType, GlossaryTermSlug>;
const relationDefinitions = { supports: "supports", contradicts: "conflict", context: "context" } as const satisfies Record<EvidenceRelation, GlossaryTermSlug>;
const dateDefinitions = [["data-period", "Data period"], ["source-published", "Source publication date"], ["retrieved", "Retrieved"], ["evidence-review", "Last evidence review"]] as const satisfies readonly (readonly [GlossaryTermSlug, string])[];

// Presentation only. The caller must supply an eligible, current projection;
// this component cannot grant source rights or publication authority.
export function IssueEvidence({ issue, readingGuideReturn }: { issue: PublicIssueProjection; readingGuideReturn?: unknown }) {
  const sources = issueSourceIndex(issue);
  const stages = issueReadingOverview(issue);
  const referenceNumbers = new Map(sources.groups.flatMap(group => group.references.map(
    ({ anchor, referenceNumber }) => [anchor, referenceNumber] as const,
  )));
  return (
    <section className="evidence-preview" aria-labelledby="issue-evidence-title">
      <p className="eyebrow">Publication revision {issue.revision} · Last evidence review <time dateTime={issue.lastEvidenceReviewOn}>{issue.lastEvidenceReviewOn}</time></p>
      <h2 id="issue-evidence-title">{issue.title}</h2>
      <p>{issue.summary}</p>
      <section className="dossier-reading-overview" aria-labelledby="dossier-reading-overview-title">
        <h3 id="dossier-reading-overview-title">What this dossier contains</h3>
        <p>These are recorded statement types, not a progress score. They do not establish that a response caused an outcome. Dates and periods remain attached to each statement.</p>
        <div className="dossier-stage-grid">{stages.map(stage => <article key={stage.type}>
          <h4>{stage.label}</h4>
          <p className="dossier-term-definition"><a href={glossaryDefinitionHref(statementDefinitions[stage.type], readingGuideReturn)}>Definition: {stage.label}</a></p>
          {stage.claims.length ? <><p>{stage.claims.length} recorded {stage.claims.length === 1 ? "statement" : "statements"} · {stage.referenceCount} exact source {stage.referenceCount === 1 ? "reference" : "references"}</p>
            <ul>{stage.claims.map(claim => <li key={claim.id}><a href={`#claim-${claim.id}`}>{claim.assertion}</a><span>Data period: {claim.periodLabel}</span></li>)}</ul>
            {stage.conflictingStatements > 0 && <p className="evidence-conflict">Conflicting evidence accompanies {stage.conflictingStatements} {stage.conflictingStatements === 1 ? "statement" : "statements"}. Inspect all its references.</p>}
          </> : <p>No statement of this type in this publication. This does not establish absence of action or evidence elsewhere.</p>}
        </article>)}</div>
      </section>
      <nav className="evidence-outline" aria-label="Statements in this dossier">
        <p><strong>{issue.claims.length} {issue.claims.length === 1 ? "statement" : "statements"} in this dossier</strong></p>
        <ol>{issue.claims.map((claim, index) => <li key={claim.id}>
          <a href={`#claim-${claim.id}`}><span>{index + 1}. {statementLabels[claim.type]}</span><span>{claim.periodLabel}</span></a>
        </li>)}</ol>
      </nav>
      <details className="evidence-reading-guide">
        <summary>How to read statements and source dates</summary>
        <p>A condition describes an observation. A policy or action describes a documented response. Funding, delivery, attributed findings and evaluation remain separate; none alone proves an effect.</p>
        <p>The statements shown are the scope of this dossier. A missing type of statement is not evidence of inaction or the absence of research.</p>
        <p>Original language was not supplied in this publication. An English display title does not identify the source's language.</p>
        <p><a href={readingGuideHref(readingGuideReturn)}>Look up statement, source and date terms in the reading guide</a></p>
        <dl className="source-date-guide">
          <div><dt>Data period</dt><dd>The time covered by the statement, shown beside its type.</dd></div>
          <div><dt>Source published</dt><dd>The source's publication date, where supplied.</dd></div>
          <div><dt>Retrieved</dt><dd>When this particular source version was obtained.</dd></div>
          <div><dt>Last evidence review</dt><dd>The dossier's recorded evidence-review date. It is not the time you opened this page.</dd></div>
        </dl>
        <p className="dossier-date-definitions">Date definitions: {dateDefinitions.map(([slug, label], index) => <span key={slug}>{index > 0 && " · "}<a href={glossaryDefinitionHref(slug, readingGuideReturn)}>{label}</a></span>)}</p>
      </details>
      <details className="dossier-source-index">
        <summary>Source reuse in this dossier</summary>
        <p>{sources.referenceCount} exact {sources.referenceCount === 1 ? "reference" : "references"} · {sources.groups.length} recorded source {sources.groups.length === 1 ? "version" : "versions"}.</p>
        <p>Reference numbers identify occurrences in statement and reference order within this publication. They do not identify independent sources.</p>
        <p>Several references may use the same source version. Different versions may come from the same origin. These counts do not establish independent confirmation.</p>
        <ol>{sources.groups.map((group, index) => <li key={group.sourceVersionId}>
          <h3>Recorded source version {index + 1}</h3>
          <p>{group.references.length} {group.references.length === 1 ? "reference" : "references"} across {group.statementCount} {group.statementCount === 1 ? "statement" : "statements"}.</p>
          <ul>{group.references.map(({ claim, source, anchor, referenceNumber }) => <li key={anchor}>
            <a href={`#${anchor}`}>Reference {referenceNumber}: {source.title} · {source.locator}</a>
            <p>{evidenceLabels[source.relation]} · {statementLabels[claim.type]}: {claim.assertion}</p>
          </li>)}</ul>
        </li>)}</ol>
        <p>Open each exact reference for its publisher, dates and wording. Grouping does not replace those details.</p>
      </details>
      <ol className="evidence-preview__claims">
        {issue.claims.map((claim) => {
          const headingId = `claim-${claim.id}`;
          return (
            <li className="evidence-preview__claim" key={claim.id}>
              <article aria-labelledby={headingId}>
                <p className="eyebrow">{statementLabels[claim.type]} · Data period: {claim.periodLabel}</p>
                <h3 id={headingId}>{claim.assertion}</h3>
                {claim.evidence.some(item => item.relation === "contradicts") && <p className="evidence-conflict"><strong>Conflicting evidence is included.</strong> Inspect the references before drawing a conclusion.</p>}
                <details className="claim-sources" open>
                  <summary>{claim.evidence.length} exact source {claim.evidence.length === 1 ? "reference" : "references"} for this statement</summary>
                <ul className="citation-grid" aria-label={`Source references for claim: ${claim.assertion}`}>
                  {claim.evidence.map((item, index) => (
                    <li id={issueReferenceAnchor(claim.id, index)} className={`citation-card citation-card--${item.relation}`} key={issueReferenceAnchor(claim.id, index)}>
                      <p className="citation-card__relation">Reference {referenceNumbers.get(issueReferenceAnchor(claim.id, index))} · {evidenceLabels[item.relation]} · {index + 1} of {claim.evidence.length} for this statement</p>
                      <h4>{item.title}</h4>
                      <p className="dossier-relation-definition"><a href={glossaryDefinitionHref(relationDefinitions[item.relation], readingGuideReturn)}>Definition: {evidenceLabels[item.relation]}</a></p>
                      <dl>
                        <div><dt>Publisher</dt><dd>{item.publisher}</dd></div>
                        <div><dt>Original language</dt><dd>Not supplied in this publication</dd></div>
                        <div><dt>Exact location</dt><dd>{item.locator}</dd></div>
                        <div><dt>Source published</dt><dd>{item.sourcePublishedOn === null ? "No verified source publication date supplied" : <time dateTime={item.sourcePublishedOn}>{item.sourcePublishedOn}</time>}</dd></div>
                        <div><dt>Retrieved</dt><dd><time dateTime={item.retrievedAt}>{item.retrievedAt}</time></dd></div>
                      </dl>
                      <p className="citation-card__url">Source URL: {item.url}</p>
                    </li>
                  ))}
                </ul>
                </details>
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
