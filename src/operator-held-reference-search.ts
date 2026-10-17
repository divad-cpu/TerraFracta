import { searchText } from "./search-text.ts";
import type { HeldDecisionsReport } from "./operator-held-decisions.ts";

export function heldReferenceQuery(value: unknown): string | null {
  const checked = searchText(value === undefined ? "" : value);
  return checked.kind === "valid" ? checked.query : null;
}

// Displayed checked identities only. All words must match the same returned
// decision; the query never selects a private provider or extends its page.
export function matchingHeldReferences(decisions: HeldDecisionsReport["decisions"], query: string) {
  const checked = heldReferenceQuery(query);
  if (checked === null) return [];
  const words = checked.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  return decisions.filter(row => {
    const fields = [row.sourceKey, row.decisionId, row.sourceVersionId, row.qualificationId];
    return words.every(word => fields.some(value => value.toLocaleLowerCase("en").includes(word)));
  });
}
