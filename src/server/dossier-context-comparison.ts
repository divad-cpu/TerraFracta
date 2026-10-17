import { createHash } from "node:crypto";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { dossierScopeLabels, type DossierContextFieldV2, type DossierProjectionV2 } from "../dossier-context-v2.ts";
import { checkDossierContextV2Consistency } from "./dossier-context-v2.ts";

// Inspection of two supplied, fully checked local candidates. Neither input is
// asserted to be a current database observation; no review or write is created.
function same(a: unknown, b: unknown) { return canonicalProposalJson(a) === canonicalProposalJson(b); }
function referencedBasis(issue: DossierProjectionV2, fields: Array<DossierContextFieldV2 | null>) {
  const claims = new Map(issue.claims.map(claim => [claim.id, claim]));
  return new Map(fields.flatMap(field => field?.references.map(reference => {
    const claim = claims.get(reference.claimId)!;
    return [JSON.stringify([reference.claimId, reference.referenceNumber]),
      { statementType: claim.type, assertion: claim.assertion, periodLabel: claim.periodLabel,
        source: claim.evidence[reference.referenceNumber - 1] }] as const;
  }) ?? []));
}
// Compare underlying data only for occurrence targets selected on both sides.
// A new/removed target or changed context role is a selection change, not proof
// that the referenced statement/source data itself changed.
function commonBasisChanged(earlier: DossierProjectionV2, before: Array<DossierContextFieldV2 | null>,
  later: DossierProjectionV2, after: Array<DossierContextFieldV2 | null>) {
  const left = referencedBasis(earlier, before), right = referencedBasis(later, after);
  return [...left].some(([key, data]) => right.has(key) && !same(data, right.get(key)));
}
function scopeChange(earlier: DossierProjectionV2, later: DossierProjectionV2, key: keyof typeof dossierScopeLabels) {
  const before = earlier.dossierContext.scope[key], after = later.dossierContext.scope[key];
  const wordingChanged = before?.wording !== after?.wording;
  const referencesChanged = !same(before?.references ?? null, after?.references ?? null);
  const referenceBasisChanged = commonBasisChanged(earlier, [before], later, [after]);
  const state = before === null && after !== null ? "supplied" : before !== null && after === null ? "withheld" :
    wordingChanged || referencesChanged || referenceBasisChanged ? "changed" : "unchanged";
  return { key, label: dossierScopeLabels[key], state, wordingChanged, referencesChanged, referenceBasisChanged } as const;
}
function roleFields(issue: DossierProjectionV2) {
  return issue.dossierContext.responsibilities.flatMap(entry => Object.values(entry.fields));
}
function baseDisplay(issue: DossierProjectionV2) {
  const { publicationId: _id, revision: _revision, dossierContext: _context, schemaVersion: _schema, ...base } = issue;
  return base;
}
function displaySha256(issue: DossierProjectionV2) {
  return createHash("sha256").update(canonicalProposalJson(issue), "utf8").digest("hex");
}
export function compareDossierContextV2Candidates(earlierInput: unknown, laterInput: unknown) {
  const earlier = checkDossierContextV2Consistency(earlierInput), later = checkDossierContextV2Consistency(laterInput);
  if (earlier.issueId !== later.issueId || earlier.jurisdictionSlug !== later.jurisdictionSlug || earlier.issueSlug !== later.issueSlug ||
      earlier.publicationId === later.publicationId || later.revision <= earlier.revision) {
    throw new Error("Dossier comparison requires distinct increasing revisions of the same issue and route");
  }
  const scope = (Object.keys(dossierScopeLabels) as Array<keyof typeof dossierScopeLabels>).map(key => scopeChange(earlier, later, key));
  const responsibilityChanged = !same(earlier.dossierContext.responsibilities, later.dossierContext.responsibilities);
  const responsibilityBasisChanged = commonBasisChanged(earlier, roleFields(earlier), later, roleFields(later));
  return { earlier, later, earlierDisplaySha256: displaySha256(earlier), laterDisplaySha256: displaySha256(later), scope,
    responsibilityChanged, responsibilityBasisChanged, baseDisplayChanged: !same(baseDisplay(earlier), baseDisplay(later)),
    consecutiveRevisions: later.revision === earlier.revision + 1 };
}
export type DossierContextComparison = ReturnType<typeof compareDossierContextV2Candidates>;
