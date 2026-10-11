import type { PublicIssueProjection } from "./public-issue-projection.ts";
import { statementLabels, type StatementType } from "./issue-display-labels.ts";

// Describe the recorded statements, without synthesizing a political summary,
// chronology, effect, numerical measure or source-independence score.
export function issueReadingOverview(issue: PublicIssueProjection) {
  return (Object.keys(statementLabels) as StatementType[]).map(type => {
    const claims = issue.claims.filter(claim => claim.type === type);
    return { type, label: statementLabels[type], claims, referenceCount: claims.reduce((n, claim) => n + claim.evidence.length, 0),
      conflictingStatements: claims.filter(claim => claim.evidence.some(source => source.relation === "contradicts")).length,
      periods: [...new Set(claims.map(claim => claim.periodLabel))] };
  });
}
