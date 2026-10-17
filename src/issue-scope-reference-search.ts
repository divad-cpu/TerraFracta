import { searchText } from "./search-text.ts";
import { checkedScopeDraftContext, scopeReferenceKey } from "./issue-scope-draft.ts";
import { statementLabels } from "./issue-display-labels.ts";

// Inspect only the already checked choice labels. Search never changes source
// identity, original occurrence positions, preparation wording or eligibility.
export function matchingScopeReferenceKeys(contextInput: unknown, queryInput: unknown): string[] | null {
  const context = checkedScopeDraftContext(contextInput), checked = searchText(queryInput);
  if (context === null || checked.kind === "invalid") return null;
  const words = checked.query.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  return context.context.claims.flatMap((claim, index) => claim.evidence.flatMap((reference, position) => {
    const labels = [`Proposed statement ${index + 1}`, statementLabels[claim.type], claim.periodLabel,
      `reference ${position + 1}`, reference.title, reference.locator, reference.relation];
    return words.every(word => labels.some(label => label.normalize("NFKC").toLocaleLowerCase("en").includes(word)))
      ? [scopeReferenceKey(claim.id, position + 1)] : [];
  }));
}
