import { glossaryDefinitionHref, type GlossaryTermSlug } from "../src/evidence-glossary.ts";
import { readingGuideHref } from "../src/current-reading-guide.ts";
import { issueReadingOverview } from "../src/issue-reading-overview.ts";
import type { PublicIssueProjection } from "../src/public-issue-projection";
import { evidenceLabels, statementLabels, type StatementType, type EvidenceRelation } from "../src/issue-display-labels.ts";
import { issueSourceIndex, issueReferenceAnchor, issueSourceGroupAnchor } from "../src/issue-source-index.ts";
import type { DossierProjectionV2 } from "../src/dossier-context-v2.ts";
import { DossierContextNote } from "./dossier-context-note.tsx";

const statementDefinitions = {
  condition: "condition", policy_action: "policy-action", funding: "funding",
  delivery: "delivery", attributed_finding: "attributed-finding", evaluation: "evaluation",
} as const satisfies Record<StatementType, GlossaryTermSlug>;
const relationDefinitions = { supports: "supports", contradicts: "conflict", context: "context" } as const satisfies Record<EvidenceRelation, GlossaryTermSlug>;
const dateDefinitions = [["data-period", "Data period"], ["source-published", "Source publication date"], ["retrieved", "Retrieved"], ["evidence-review", "Last evidence review"]] as const satisfies readonly (readonly [GlossaryTermSlug, string])[];

// The closed public projection has no separately reviewed population, dossier
// period or selection-rationale fields. Never substitute private dossier or demo values.
// Call only beside the caller's already checked current publication.
export function DossierScopeNote({ readingGuideReturn }: { readingGuideReturn?: unknown }) {
  return <><section className="dossier-scope-note info-band" aria-label="Dossier scope">
    <p><strong>Population, period and selection context</strong></p>
    <dl>
      <div><dt>Affected population</dt><dd>Not supplied in this publication.</dd></div>
      <div><dt>Dossier period</dt><dd>Not supplied in this publication.</dd></div>
      <div><dt>Why this issue was selected</dt><dd>Not supplied in this publication.</dd></div>
    </dl>
    <p>Statement counts and periods describe this publication's records. They do not establish how many people are affected or why the issue was selected. Individual statement periods and the last evidence-review date do not define the whole dossier period. Read each statement's wording and exact references; do not infer its coverage from the country or issue title.</p>
    <p><a href={glossaryDefinitionHref("affected-population", readingGuideReturn)}>Definition: Affected population</a>
      {" · "}<a href={glossaryDefinitionHref("data-period", readingGuideReturn)}>Definition: Statement data period</a>
      {" · "}<a href={glossaryDefinitionHref("issue-selection", readingGuideReturn)}>Definition: Issue selection rationale</a></p>
  </section>
  <section className="dossier-responsibility-note info-band" aria-label="Responsibility context">
    <p><strong>Responsibility context</strong></p>
    <dl>
      <div><dt>Responsible institution and level</dt><dd>Not supplied as separate reviewed fields in this publication.</dd></div>
      <div><dt>Government term or responsibility period</dt><dd>Not supplied as separate reviewed fields in this publication.</dd></div>
      <div><dt>Introduction, amendment, funding and delivery roles</dt><dd>Not supplied as separate reviewed fields in this publication.</dd></div>
    </dl>
    <p>Statements may name authorities. Read their exact wording, periods and references to establish the documented role. A source publisher is not necessarily the responsible authority. Do not assign earlier measures automatically to the current government.</p>
    <p><a href={glossaryDefinitionHref("responsibility", readingGuideReturn)}>Definition: Responsibility</a></p>
  </section></>;
}

// Presentation only. The caller must supply an eligible, current projection;
// this component cannot grant source rights or publication authority.
export function IssueEvidence({ issue, readingGuideReturn }: { issue: PublicIssueProjection | DossierProjectionV2; readingGuideReturn?: unknown }) {
  const extended = "schemaVersion" in issue && issue.schemaVersion === 2 ? issue : null;
  const sources = issueSourceIndex(issue);
  const stages = issueReadingOverview(issue);
  const statementNumbers = new Map(issue.claims.map((claim, index) => [claim.id, index + 1]));
  const sourceGroups = new Map(sources.groups.map((group, index) => [group.sourceVersionId.toLowerCase(),
    { ...group, number: index + 1, anchor: issueSourceGroupAnchor(index) }] as const));
  const referenceNumbers = new Map(sources.groups.flatMap(group => group.references.map(
    ({ anchor, referenceNumber }) => [anchor, referenceNumber] as const,
  )));
  const conflictingStatements = issue.claims.filter(claim => claim.evidence.some(source => source.relation === "contradicts"));
  const missingDateReferences = sources.groups.flatMap(group => group.references.filter(reference => reference.source.sourcePublishedOn === null))
    .sort((a, b) => a.referenceNumber - b.referenceNumber);
  const absentTypes = stages.filter(stage => stage.claims.length === 0);
  return (
    <section className="evidence-preview" aria-labelledby="issue-evidence-title">
      <p className="eyebrow">Publication revision {issue.revision} · Last evidence review <time dateTime={issue.lastEvidenceReviewOn}>{issue.lastEvidenceReviewOn}</time></p>
      <h2 id="issue-evidence-title">{issue.title}</h2>
      <p>{issue.summary}</p>
      {extended ? <DossierContextNote issue={extended} /> : <DossierScopeNote readingGuideReturn={readingGuideReturn} />}
      <section className="dossier-reading-overview" aria-labelledby="dossier-reading-overview-title">
        <h3 id="dossier-reading-overview-title">What this dossier contains</h3>
        <p>These are recorded statement types, not a progress score. They do not establish that a response caused an outcome. Dates and periods remain attached to each statement.</p>
        <div className="dossier-stage-grid">{stages.map(stage => <article key={stage.type}>
          <h4>{stage.label}</h4>
          <p className="dossier-term-definition"><a href={glossaryDefinitionHref(statementDefinitions[stage.type], readingGuideReturn)}>Definition: {stage.label}</a></p>
          {stage.claims.length ? <><p>{stage.claims.length} recorded {stage.claims.length === 1 ? "statement" : "statements"} · {stage.referenceCount} exact source {stage.referenceCount === 1 ? "reference" : "references"}</p>
            <ul>{stage.claims.map(claim => <li key={claim.id}><a href={`#claim-${claim.id}`}>Statement {statementNumbers.get(claim.id)}: {claim.assertion}</a><span>Data period: {claim.periodLabel}</span></li>)}</ul>
            {stage.conflictingStatements > 0 && <p className="evidence-conflict">Conflicting evidence accompanies {stage.conflictingStatements} {stage.conflictingStatements === 1 ? "statement" : "statements"}. Inspect all its references.</p>}
          </> : <p>No statement of this type in this publication. This does not establish absence of action or evidence elsewhere.</p>}
        </article>)}</div>
      </section>
      <nav className="evidence-outline" id="issue-statement-outline" tabIndex={-1} aria-label="Statements in this dossier">
        <p><strong>{issue.claims.length} {issue.claims.length === 1 ? "statement" : "statements"} in this dossier</strong></p>
        <p>Statement numbers follow this publication's record order. They are not a ranking or a timeline.</p>
        <ol>{issue.claims.map((claim, index) => <li key={claim.id}>
          <a href={`#claim-${claim.id}`}><span>{index + 1}. {statementLabels[claim.type]}</span><span>{claim.periodLabel}</span></a>
        </li>)}</ol>
        <p><a href="#issue-publication-limits">Read what remains uncertain in this publication</a></p>
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
        <p>These references identify recorded source versions; they do not establish independent origin or current source availability.</p>
        <ol>{sources.groups.map((group, index) => <li key={group.sourceVersionId}>
          <h3 id={issueSourceGroupAnchor(index)} tabIndex={-1}>Recorded source version {index + 1}</h3>
          <dl><div><dt>Recorded source version reference</dt><dd><code>{group.sourceVersionId}</code></dd></div></dl>
          <p>{group.references.length} {group.references.length === 1 ? "reference" : "references"} across {group.statementCount} {group.statementCount === 1 ? "statement" : "statements"}.</p>
          <ul>{group.references.map(({ claim, source, anchor, referenceNumber }) => <li key={anchor}>
            <a href={`#${anchor}`}>Reference {referenceNumber}: {source.title} · {source.locator}</a>
            <p>{evidenceLabels[source.relation]} · Statement {statementNumbers.get(claim.id)} · {statementLabels[claim.type]}: {claim.assertion}</p>
          </li>)}</ul>
        </li>)}</ol>
        <p>Open each exact reference for its publisher, dates and wording. Grouping does not replace those details.</p>
      </details>
      <ol className="evidence-preview__claims">
        {issue.claims.map((claim, index) => {
          const headingId = `claim-${claim.id}`;
          return (
            <li className="evidence-preview__claim" key={claim.id}>
              <article aria-labelledby={headingId}>
                <p className="eyebrow">Statement {index + 1} · {statementLabels[claim.type]} · Data period: {claim.periodLabel}</p>
                <h3 id={headingId} tabIndex={-1}>{claim.assertion}</h3>
                {claim.evidence.some(item => item.relation === "contradicts") && <p className="evidence-conflict"><strong>Conflicting evidence is included.</strong> Inspect the references before drawing a conclusion.</p>}
                <details className="claim-sources" open>
                  <summary>{claim.evidence.length} exact source {claim.evidence.length === 1 ? "reference" : "references"} for this statement</summary>
                <ul className="citation-grid" aria-label={`Source references for claim: ${claim.assertion}`}>
                  {claim.evidence.map((item, index) => {
                    const sourceGroup = sourceGroups.get(item.sourceVersionId.toLowerCase());
                    return <li id={issueReferenceAnchor(claim.id, index)} className={`citation-card citation-card--${item.relation}`} tabIndex={-1} key={issueReferenceAnchor(claim.id, index)}>
                      <p className="citation-card__relation">Reference {referenceNumbers.get(issueReferenceAnchor(claim.id, index))} · {evidenceLabels[item.relation]} · {index + 1} of {claim.evidence.length} for this statement</p>
                      <h4>{item.title}</h4>
                      <p className="dossier-relation-definition"><a href={glossaryDefinitionHref(relationDefinitions[item.relation], readingGuideReturn, issueReferenceAnchor(claim.id, index))}>Definition: {evidenceLabels[item.relation]}</a></p>
                      <dl>
                        <div><dt>Publisher</dt><dd>{item.publisher}</dd></div>
                        <div><dt>Original language</dt><dd>Not supplied in this publication</dd></div>
                        <div><dt>Exact location</dt><dd>{item.locator}</dd></div>
                        <div><dt>Source published</dt><dd>{item.sourcePublishedOn === null ? "No verified source publication date supplied" : <time dateTime={item.sourcePublishedOn}>{item.sourcePublishedOn}</time>}</dd></div>
                        <div><dt>Retrieved</dt><dd><time dateTime={item.retrievedAt}>{item.retrievedAt}</time></dd></div>
                      </dl>
                      <p className="citation-card__url">Source URL: {item.url}</p>
                      {sourceGroup && sourceGroup.references.length > 1 && <p className="small-note">
                        Recorded source version {sourceGroup.number}: {sourceGroup.references.length} exact references across {sourceGroup.statementCount} {sourceGroup.statementCount === 1 ? "statement" : "statements"}.
                        {" "}<a href={`#${sourceGroup.anchor}`}>Inspect all references to this recorded source version</a> in the source reuse index.
                        {" "}Repeated use does not establish independent confirmation.
                      </p>}
                    </li>;
                  })}
                </ul>
                </details>
                <p><a href="#issue-statement-outline">Back to statements in this dossier</a></p>
              </article>
            </li>
          );
        })}
      </ol>
      <section className="publication-limits info-band" aria-labelledby="issue-publication-limits">
        <h3 id="issue-publication-limits" tabIndex={-1}>What remains uncertain in this publication</h3>
        <p>This describes the records displayed above, not the completeness of research or the current state of the world.</p>
        {conflictingStatements.length ? <>
          <p>{conflictingStatements.length} {conflictingStatements.length === 1 ? "statement includes" : "statements include"} references labelled as conflicting. Read each statement and all its references; the label alone does not resolve the disagreement.</p>
          <ul>{conflictingStatements.map(claim => <li key={claim.id}><a href={`#claim-${claim.id}`}>Statement {statementNumbers.get(claim.id)} · {statementLabels[claim.type]}</a></li>)}</ul>
        </> : <p>No reference is labelled as conflicting in this publication. This does not establish agreement or absence of contrary evidence elsewhere.</p>}
        {missingDateReferences.length ? <>
          <p>{missingDateReferences.length} {missingDateReferences.length === 1 ? "reference has" : "references have"} no verified source publication date supplied. Retrieval dates do not fill these gaps.</p>
          <details><summary>Inspect references with missing source publication dates</summary>
            <ul>{missingDateReferences.map(reference => <li key={reference.anchor}><a href={`#${reference.anchor}`}>Reference {reference.referenceNumber} · Statement {statementNumbers.get(reference.claim.id)}</a></li>)}</ul>
          </details>
        </> : <p>Every displayed reference supplies a source publication date. This does not establish currency or current source availability.</p>}
        {absentTypes.length ? <><p>No statement of these types is included: {absentTypes.map(stage => stage.label).join(", ")}. This does not establish absence of action or evidence elsewhere.</p></>
          : <p>All six statement types are represented. This does not establish a chronology, completed delivery or causal effect.</p>}
        {extended ? <p>Read the supplied population, dossier period, selection and responsibility context with its own references. Fields labelled unknown remain unknown; context does not establish a complete chronology, source independence or a policy effect. Original source languages and separately reviewed upcoming milestones are not supplied.</p>
          : <p>Population, dossier period, selection rationale and structured responsibility are not supplied as separately reviewed fields in this publication. Original source languages and separately reviewed upcoming milestones are not supplied. Read exact wording, periods and references; do not fill these gaps from titles, source publishers or retrieval times.</p>}
        <p>Repeated use of a source version does not establish independent confirmation. A recorded statement or supporting label does not by itself establish a policy effect.</p>
        <p><a href="#issue-statement-outline">Back to statements in this dossier</a></p>
      </section>
    </section>
  );
}
