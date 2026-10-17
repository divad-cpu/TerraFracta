import type { DossierContextComparison } from "../src/server/dossier-context-comparison.ts";
import { dossierScopeLabels, dossierResponsibilityLabels, type DossierContextFieldV2, type DossierProjectionV2 } from "../src/dossier-context-v2.ts";
import { issueSourceIndex, issueReferenceAnchor } from "../src/issue-source-index.ts";
import { evidenceLabels, statementLabels } from "../src/issue-display-labels.ts";

function ComparisonSide({ issue, side }: { issue: DossierProjectionV2; side: "earlier" | "later" }) {
  const prefix = `context-comparison-${side}`, sources = issueSourceIndex(issue);
  const references = new Map(sources.groups.flatMap(group => group.references.map(reference => [reference.anchor, reference])));
  function field(value: DossierContextFieldV2 | null) {
    if (value === null) return <p>Unknown — no reviewed wording supplied.</p>;
    return <><p>{value.wording}</p><ul>{value.references.map(reference => {
      const anchor = issueReferenceAnchor(reference.claimId, reference.referenceNumber - 1), target = references.get(anchor)!;
      return <li key={anchor}><a href={`#${prefix}-${anchor}`}>Reference {target.referenceNumber} in the {side} snapshot</a>
        <p>Role for this context wording: {evidenceLabels[reference.relation]}. Original statement role: {evidenceLabels[target.source.relation]}.</p></li>;
    })}</ul></>;
  }
  return <section aria-labelledby={`${prefix}-heading`}>
    <h3 id={`${prefix}-heading`} tabIndex={-1}>{side === "earlier" ? "Earlier supplied snapshot" : "Later supplied snapshot"}</h3>
    <p>Publication <code>{issue.publicationId}</code> · Revision {issue.revision}. These supplied records do not prove current database state.</p>
    <h4>Scope context</h4><dl>{Object.entries(dossierScopeLabels).map(([key, label]) => <div key={key}>
      <dt>{label}</dt><dd>{field(issue.dossierContext.scope[key as keyof typeof dossierScopeLabels])}</dd>
    </div>)}</dl>
    <h4>Ordered responsibility entries</h4>
    {issue.dossierContext.responsibilities.length ? <ol>{issue.dossierContext.responsibilities.map((entry, index) => <li key={index}>
      <p>Entry {index + 1} · <a href={`#${prefix}-claim-${entry.claimId}`}>Associated statement in the {side} snapshot</a></p>
      <dl>{Object.entries(dossierResponsibilityLabels).map(([key, label]) => <div key={key}>
        <dt>{label}</dt><dd>{field(entry.fields[key as keyof typeof dossierResponsibilityLabels])}</dd>
      </div>)}</dl>
    </li>)}</ol> : <p>No reviewed responsibility entries supplied. No conclusion about absence of responsibility follows.</p>}
    <details open><summary>Inspect original statements and exact references in the {side} snapshot</summary>
      <ol>{issue.claims.map((claim, statementIndex) => <li key={claim.id}>
        <h4 id={`${prefix}-claim-${claim.id}`} tabIndex={-1}>Statement {statementIndex + 1} · {statementLabels[claim.type]}</h4>
        <p>{claim.assertion}</p><p>Data period: {claim.periodLabel}</p>
        <ol>{claim.evidence.map((source, index) => {
          const anchor = issueReferenceAnchor(claim.id, index), reference = references.get(anchor)!;
          return <li key={anchor} id={`${prefix}-${anchor}`} tabIndex={-1}>
            <h5>Reference {reference.referenceNumber} · {source.title}</h5>
            <p>Exact location: {source.locator} · Original statement role: {evidenceLabels[source.relation]}</p>
            <dl><div><dt>Recorded source version</dt><dd><code>{source.sourceVersionId}</code></dd></div>
              <div><dt>Publisher</dt><dd>{source.publisher}</dd></div><div><dt>Original source language</dt><dd>Not supplied in this display contract</dd></div>
              <div><dt>Source published</dt><dd>{source.sourcePublishedOn ?? "No verified source publication date supplied"}</dd></div>
              <div><dt>Retrieved</dt><dd>{source.retrievedAt}</dd></div><div><dt>Source address, shown as text</dt><dd>{source.url}</dd></div></dl>
          </li>;
        })}</ol>
      </li>)}</ol>
    </details>
  </section>;
}
const states = { supplied: "Reviewed wording supplied where unknown before", withheld: "Previously supplied wording is now unknown",
  changed: "Wording, reference selection or common cited basis changed", unchanged: "No displayed field or common cited-basis change" };
export function DossierContextComparisonView({ comparison: value }: { comparison: DossierContextComparison }) {
  return <section aria-label="Local dossier-context comparison">
    <h2>Inspect the supplied snapshots side by side</h2>
    <p>Both supplied candidates passed local consistency and context-review checks. This creates no review decision, publication or current-rights observation. Changed text or evidence requires its own review.</p>
    <p>{value.consecutiveRevisions ? "The supplied revision numbers are consecutive." : "Intermediate revisions are not shown."} Neither numbering nor list order proves an event chronology, authority continuity or a policy effect.</p>
    <dl>{value.scope.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{states[row.state]}
      {row.wordingChanged && <p>Exact wording or its known/unknown state changed.</p>}
      {row.referencesChanged && <p>Exact reference selection or context role changed.</p>}
      {row.referenceBasisChanged && <p>Statement or source data at a reference target selected on both sides changed; inspect both sides even when context wording is identical.</p>}
    </dd></div>)}</dl>
    <p>Responsibility entries: {value.responsibilityChanged ? "ordered content changed" : "ordered content unchanged"}. Data at responsibility reference targets selected on both sides: {value.responsibilityBasisChanged ? "changed" : "unchanged"}. Entries are not matched as the same institution, tenure or event across snapshots.</p>
    <p>The common-target data check covers only exact statement/reference occurrences selected on both sides. Added, removed, reordered or differently labelled references are selection changes; a field becoming unknown does not itself establish changed source data.</p>
    <p>Other dossier display data: {value.baseDisplayChanged ? "changed" : "unchanged"}. Repeated source use is not independent confirmation. A source title or publisher does not establish its original language or a translation review.</p>
    <nav aria-label="Comparison snapshots"><a href="#context-comparison-earlier-heading">Earlier supplied snapshot</a>{" · "}<a href="#context-comparison-later-heading">Later supplied snapshot</a></nav>
    <div className="dossier-context-comparison-sides"><ComparisonSide issue={value.earlier} side="earlier" /><ComparisonSide issue={value.later} side="later" /></div>
  </section>;
}
