import { parseConnectedReaderSnapshot } from "./connected-fictional-reader.ts";
import { connectedStatusIdentity, type ConnectedStatusIdentity } from "./connected-reader-status.ts";
import { deriveCorrectionTarget, checkCorrectionDraft, type CorrectionDraftFields, type CheckedCorrectionDraft } from "./correction-target.ts";
import type { PublicIssueProjection } from "./public-issue-projection.ts";

export type ConnectedCorrectionContext = { edition: ConnectedStatusIdentity; issue: PublicIssueProjection; key: string };

// Only the existing closed invented-reader contract may enter the local editor.
// This is a snapshot observation, not a current-health or public-authority seal.
export function connectedCorrectionContext(input: unknown): ConnectedCorrectionContext | null {
  try {
    const snapshot = parseConnectedReaderSnapshot(input);
    if (snapshot.state !== "active" || deriveCorrectionTarget({ kind: "issue", issue: snapshot.issue }).kind !== "available") return null;
    const edition = connectedStatusIdentity(snapshot);
    return { edition, issue: snapshot.issue,
      key: JSON.stringify([edition.generation, edition.executionId, edition.observedAt, snapshot.issue.issueId,
        snapshot.issue.publicationId, snapshot.issue.revision, snapshot.issue.jurisdictionSlug, snapshot.issue.issueSlug]) };
  } catch { return null; }
}

export function previewConnectedCorrection(context: ConnectedCorrectionContext, fields: CorrectionDraftFields, claimId: unknown):
  { draft: CheckedCorrectionDraft; edition: ConnectedStatusIdentity } | null {
  const current = { kind: "issue" as const, issue: context.issue };
  const target = deriveCorrectionTarget(current, claimId);
  if (target.kind !== "available") return null;
  const checked = checkCorrectionDraft(current, { target: target.target, fields });
  return checked.kind === "preview" ? { draft: checked.draft, edition: context.edition } : null;
}
