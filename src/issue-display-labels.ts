import type { PublicIssueProjection } from "./public-issue-projection.ts";

export type StatementType = PublicIssueProjection["claims"][number]["type"];
export type EvidenceRelation = PublicIssueProjection["claims"][number]["evidence"][number]["relation"];
export const statementLabels: Record<StatementType, string> = {
  condition: "Observed condition", policy_action: "Policy or action", funding: "Funding",
  delivery: "Delivery", attributed_finding: "Attributed finding", evaluation: "Evaluation",
};
export const evidenceLabels: Record<EvidenceRelation, string> = {
  supports: "Supports this wording", contradicts: "Points to a conflict", context: "Adds context",
};
