import { publicIssueProjectionSchema, type PublicIssueProjection } from "./public-issue-projection.ts";
import { deriveCorrectionTarget, checkCorrectionDraft, type CorrectionDraftFields, type CheckedCorrectionDraft } from "./correction-target.ts";

export type CurrentIssueCorrectionContext = { edition: null; issue: PublicIssueProjection; key: string };

// A local draft for the closed issue already supplied by the current reader.
// Shape checks do not approve publication or intake. No saved fictional edition
// number, execution identity or observation timestamp is invented for this view.
export function currentIssueCorrectionContext(input: unknown): CurrentIssueCorrectionContext | null {
  try {
    const parsed = publicIssueProjectionSchema.safeParse(input);
    if (!parsed.success || deriveCorrectionTarget({ kind: "issue", issue: parsed.data }).kind !== "available") return null;
    const issue = parsed.data;
    return { edition: null, issue, key: JSON.stringify(["current-issue", issue.issueId,
      issue.publicationId, issue.revision, issue.jurisdictionSlug, issue.issueSlug]) };
  } catch { return null; }
}

export function previewCurrentIssueCorrection(context: CurrentIssueCorrectionContext, fields: CorrectionDraftFields, claimId: unknown):
  { draft: CheckedCorrectionDraft; edition: null } | null {
  const current = { kind: "issue" as const, issue: context.issue };
  const target = deriveCorrectionTarget(current, claimId);
  if (target.kind !== "available") return null;
  const checked = checkCorrectionDraft(current, { target: target.target, fields });
  return checked.kind === "preview" ? { draft: checked.draft, edition: null } : null;
}
