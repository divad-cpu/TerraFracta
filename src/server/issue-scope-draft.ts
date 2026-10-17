import { createHash } from "node:crypto";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { checkedScopeDraftContext, type ScopeDraftContext } from "../issue-scope-draft.ts";
import { parseCapturedProposalEnvelope, decodeProposalCapture } from "./proposal-capture.ts";

// Reuse the full captured-comparison gate. No private issue_dossiers value,
// source lookup, writer, credential or publication-read fallback is available.
export function capturedScopeDraftContext(input: unknown): ScopeDraftContext | null {
  try {
    const report = parseCapturedProposalEnvelope(input);
    if (report.status !== "ok") return null;
    const payload = decodeProposalCapture(report.capture.proposalJson, report.capture.proposalSha256);
    // Every captured comparison/evidence value participates. A fresh observation
    // of identical material does not itself alter the preparation identity.
    const { observedAt: _observedAt, ...comparison } = report;
    const comparisonSha256 = createHash("sha256").update(canonicalProposalJson(comparison), "utf8").digest("hex");
    return checkedScopeDraftContext({ binding: { ...report.requested, captureId: report.capture.captureId,
      issueId: report.target.issueId, comparisonSha256, proposalSha256: report.capture.proposalSha256 }, claims: payload.snapshot.claims.map(({ id, type, periodLabel, evidence }) => ({ id, type, periodLabel,
        evidence: evidence.map(({ title, locator, relation }) => ({ title, locator, relation })) })) })?.context ?? null;
  } catch { return null; }
}
