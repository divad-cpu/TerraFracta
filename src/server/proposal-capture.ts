import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { proposalCapturePayloadSchema, capturedProposalEnvelopeSchema, recordedProposalBaseSchema,
  canonicalProposalJson, proposalMicros, proposalEvidenceMicros, PROPOSAL_PAYLOAD_BYTES,
  type CapturedProposalEnvelope, type ProposalCapturePayload } from "../operator-proposal-capture.ts";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const invalid = () => new Error("proposal_unavailable");

// Trusted writer preparation only. Produces review-only bytes, never an INSERT,
// check_trace, qualification, publication or translated approval.
export function encodeProposalCapture(input: unknown): Readonly<{ proposalJson: string; proposalSha256: string }> {
  const parsed = proposalCapturePayloadSchema.parse(input);
  const proposalJson = canonicalProposalJson(parsed);
  // Reused display bounds trim text. Reject any normalization rather than
  // silently changing the exact proposed assertion before hashing/display.
  if (canonicalProposalJson(input) !== proposalJson || Buffer.byteLength(proposalJson, "utf8") > PROPOSAL_PAYLOAD_BYTES) throw invalid();
  return Object.freeze({ proposalJson, proposalSha256: digest(proposalJson) });
}

export function decodeProposalCapture(json: string, sha256: string): ProposalCapturePayload {
  if (Buffer.byteLength(json, "utf8") > PROPOSAL_PAYLOAD_BYTES || digest(json) !== sha256) throw invalid();
  const value = JSON.parse(json), parsed = proposalCapturePayloadSchema.parse(value);
  if (canonicalProposalJson(parsed) !== json) throw invalid(); // Includes duplicate/escaped alias/noncanonical keys.
  return parsed;
}

export function parseCapturedProposalEnvelope(input: unknown): CapturedProposalEnvelope {
  const report = capturedProposalEnvelopeSchema.parse(input);
  if (report.status !== "ok") return report;
  const payload = decodeProposalCapture(report.capture.proposalJson, report.capture.proposalSha256);
  const c = report.capture, d = report.decision, t = report.target;
  if (d.decisionId !== report.requested.decisionId ||
      proposalMicros(d.decidedAt) > proposalMicros(c.capturedAt) ||
      proposalMicros(c.capturedAt) > proposalMicros(report.observedAt) ||
      c.baseHeadChangedAt !== null && proposalMicros(c.baseHeadChangedAt) > proposalMicros(c.capturedAt) ||
      d.reasonCodes.length + d.undisclosedReasonCount < 1 ||
      d.reasonCodes.length + d.undisclosedReasonCount > 24 ||
      payload.snapshot.jurisdictionSlug !== t.jurisdictionSlug || payload.snapshot.issueSlug !== t.issueSlug ||
      !payload.snapshot.claims.some(claim => claim.evidence.some(e => e.sourceVersionId === d.sourceVersionId && e.locator === d.evidenceLocator))) throw invalid();
  const listed = new Set(payload.dependencyManifest.sourceVersionIds);
  if (report.sourceReceipts.length !== listed.size ||
      new Set(report.sourceReceipts.map(e => e.sourceVersionId)).size !== listed.size ||
      report.sourceReceipts.some(e => !listed.has(e.sourceVersionId) || proposalMicros(e.retrievedAt) > proposalMicros(c.capturedAt)) ||
      report.sourceReceipts.find(e => e.sourceVersionId === d.sourceVersionId)?.contentSha256 !== d.sourceSha256 ||
      payload.translation.status === "not_required" && report.sourceReceipts.some(e => e.languageCode !== payload.translation.displayLanguage)) throw invalid();
  for (const claim of payload.snapshot.claims) for (const e of claim.evidence) {
    const receipt = report.sourceReceipts.find(r => r.sourceVersionId === e.sourceVersionId);
    if (!receipt || proposalEvidenceMicros(e.retrievedAt) !== proposalMicros(receipt.retrievedAt)) throw invalid();
  }
  if ((c.basePublicationId === null) !== (report.base === null) ||
      (c.baseContentSha256 === null) !== (report.base === null) ||
      (c.baseHeadChangedAt === null) !== (report.base === null)) throw invalid();
  if (report.base !== null) {
    if (Buffer.byteLength(report.base.publicationJson, "utf8") > 24_576 ||
        digest(report.base.publicationJson) !== report.base.publicationSha256 ||
        c.baseContentSha256 !== report.base.publicationSha256) throw invalid();
    const raw = JSON.parse(report.base.publicationJson), base = recordedProposalBaseSchema.parse(raw);
    if (canonicalProposalJson(raw) !== canonicalProposalJson(base) || base.id !== c.basePublicationId ||
        base.issueId !== t.issueId || base.snapshot.jurisdictionSlug !== t.jurisdictionSlug ||
        base.snapshot.issueSlug !== t.issueSlug) throw invalid();
    // Reuse syntactic manifest/unique-claim invariants without fabricating a
    // public current-head envelope or claiming present source eligibility.
    proposalCapturePayloadSchema.parse({ ...payload, conflictCoverage: "not_recorded", snapshot: base.snapshot, dependencyManifest: base.dependencyManifest });
  }
  return report;
}
