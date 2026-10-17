import { dossierProjectionV2Schema, dossierScopeLabels, dossierResponsibilityLabels,
  type DossierProjectionV2, type DossierContextFieldV2 } from "../src/dossier-context-v2.ts";
import { evidenceLabels } from "../src/issue-display-labels.ts";
import { issueReferenceAnchor, issueSourceIndex } from "../src/issue-source-index.ts";

// Presentation of the separately qualified local v2 candidate only. Shape and
// target checks here do not establish source rights or an accepted field review.
export function DossierContextNote({ issue: input }: { issue: DossierProjectionV2 }) {
  const issue = dossierProjectionV2Schema.parse(input);
  const claims = new Map(issue.claims.map((claim, index) => [claim.id, { claim, number: index + 1 }]));
  const numbers = new Map(issueSourceIndex(issue).groups.flatMap(group => group.references.map(reference => [reference.anchor, reference.referenceNumber])));
  function field(value: DossierContextFieldV2 | null) {
    if (value === null) return <>Unknown — no reviewed wording supplied.</>;
    return <><p>{value.wording}</p><ol>{value.references.map(reference => {
      const statement = claims.get(reference.claimId), source = statement?.claim.evidence[reference.referenceNumber - 1];
      if (!statement || !source) throw new Error("Dossier context reference unavailable");
      const anchor = issueReferenceAnchor(reference.claimId, reference.referenceNumber - 1);
      return <li key={`${reference.claimId}:${reference.referenceNumber}`}>
        <a href={`#${anchor}`}>Reference {numbers.get(anchor)} · Statement {statement.number}: {source.title} · {source.locator}</a>
        <p>Role for this context wording: {evidenceLabels[reference.relation]}. Recorded role for the original statement: {evidenceLabels[source.relation]}.</p>
      </li>;
    })}</ol></>;
  }
  return <>
    <section className="dossier-scope-note info-band" aria-label="Dossier scope">
      <h3>Population, period and selection context</h3>
      <dl>{Object.entries(dossierScopeLabels).map(([key, label]) => <div key={key}>
        <dt>{label}</dt><dd>{field(issue.dossierContext.scope[key as keyof typeof dossierScopeLabels])}</dd>
      </div>)}</dl>
      <p>These context words have their own reference roles and review bindings. Their roles need not match the role of the same occurrence in its original statement. Repeated references do not establish independent confirmation.</p>
    </section>
    <section className="dossier-responsibility-note info-band" aria-label="Responsibility context">
      <h3>Responsibility context</h3>
      {issue.dossierContext.responsibilities.length ? <ol>{issue.dossierContext.responsibilities.map((entry, index) => <li key={index}>
        <p>Context entry {index + 1} · <a href={`#claim-${entry.claimId}`}>Inspect the associated statement</a></p>
        <dl>{Object.entries(dossierResponsibilityLabels).map(([key, label]) => <div key={key}>
          <dt>{label}</dt><dd>{field(entry.fields[key as keyof typeof dossierResponsibilityLabels])}</dd>
        </div>)}</dl>
      </li>)}</ol> : <p>No reviewed responsibility entries are supplied. This does not establish that no authority is responsible.</p>}
      <p>Entries retain this snapshot's order, not chronology or importance. An institution, government level, role or period that remains unknown is not inferred from the source publisher or the current government.</p>
    </section>
  </>;
}
