import { searchText } from "./search-text.ts";
import type { OperatorAuditChoices } from "./operator-audit-choices.ts";

export function recordedIssueQuery(value: unknown): string | null {
  const checked = searchText(value === undefined ? "" : value);
  return checked.kind === "valid" ? checked.query : null;
}

// Already checked bounded choices only. Match stored keys/labels and exact
// references, preserving their order; no provider selection or wider coverage.
export function matchingRecordedIssueChoices(issues: OperatorAuditChoices["issues"], query: string) {
  const checked = recordedIssueQuery(query);
  if (checked === null) return [];
  const words = checked.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  return issues.filter(issue => {
    const values = [issue.issueKey, issue.issueKey.replaceAll("-", " "), issue.issueId];
    return words.every(word => values.some(value => value.toLocaleLowerCase("en").includes(word)));
  });
}
