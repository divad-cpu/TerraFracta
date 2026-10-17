import { searchText } from "./search-text.ts";
import type { OperatorAuditReport } from "./operator-audit-report.ts";

export function auditSourceQuery(value: unknown): string | null {
  const checked = searchText(value === undefined ? "" : value);
  return checked.kind === "valid" ? checked.query : null;
}

// Checked bounded source metadata only; no new source discovery or health test.
export function matchingAuditSourceRows(sources: OperatorAuditReport["sources"], query: string) {
  const checked = auditSourceQuery(query);
  if (checked === null) return [];
  const words = checked.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  return sources.filter(source => {
    const fields = [source.sourceKey, source.registrationId, ...(source.sourceVersionId === null ? [] : [source.sourceVersionId])];
    return words.every(word => fields.some(value => value.toLocaleLowerCase("en").includes(word)));
  });
}
