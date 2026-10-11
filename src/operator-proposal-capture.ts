import { z } from "zod";
import { publicationReadEnvelopeSchema } from "./public-issue-projection.ts";
import { operatorAuditChoiceIdSchema as uuid } from "./operator-audit-choices.ts";
import { heldReasonCodes } from "./operator-held-decisions.ts";

// Private, syntactic review content. This shape cannot authorize publication,
// source reuse, conflict clearance or a translated assertion.
export const PROPOSAL_PAYLOAD_BYTES = 16_384;
const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine(value => !value.startsWith("0000-"));
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const language = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/);
const publication = publicationReadEnvelopeSchema.shape.publication;
export const proposalScopeSchema = z.strictObject({ runId: uuid, decisionId: uuid });
export type ProposalScope = z.infer<typeof proposalScopeSchema>;

export const proposalCapturePayloadSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal("review_only"),
  snapshot: publication.shape.snapshot,
  dependencyManifest: publication.shape.dependencyManifest,
  conflictCoverage: z.enum(["not_recorded", "recorded_partial"]),
  translation: z.strictObject({ displayLanguage: language,
    status: z.enum(["not_recorded", "unreviewed", "not_required"]) }),
}).superRefine((value, context) => {
  const listed = new Set(value.dependencyManifest.sourceVersionIds);
  const cited = new Set(value.snapshot.claims.flatMap(claim => claim.evidence.map(e => e.sourceVersionId)));
  if (listed.size !== value.dependencyManifest.sourceVersionIds.length ||
      listed.size !== cited.size || [...cited].some(id => !listed.has(id)) ||
      new Set(value.snapshot.claims.map(c => c.id)).size !== value.snapshot.claims.length) {
    context.addIssue({ code: "custom", message: "Proposal evidence identities inconsistent" });
  }
  if (value.conflictCoverage === "recorded_partial" &&
      !value.snapshot.claims.some(claim => claim.evidence.some(e => e.relation === "contradicts"))) {
    context.addIssue({ code: "custom", message: "Recorded conflict evidence is absent" });
  }
});
export type ProposalCapturePayload = z.infer<typeof proposalCapturePayloadSchema>;

export const capturedProposalEnvelopeSchema = z.union([
  z.strictObject({ schemaVersion: z.literal(1), status: z.literal("ok"),
    requested: proposalScopeSchema, observedAt: instant,
    decision: z.strictObject({ decisionId: uuid, decidedAt: instant, sourceVersionId: uuid,
      sourceSha256: sha, evidenceLocator: z.string().min(1).max(400),
      reasonCodes: z.array(z.enum(heldReasonCodes)).max(24),
      undisclosedReasonCount: z.number().int().min(0).max(24) }),
    target: z.strictObject({ issueId: uuid, jurisdictionId: z.string().min(1).max(80),
      jurisdictionSlug: publication.shape.snapshot.shape.jurisdictionSlug,
      issueSlug: publication.shape.snapshot.shape.issueSlug }),
    capture: z.strictObject({ captureId: uuid, capturedAt: instant,
      proposalJson: z.string().min(2).max(PROPOSAL_PAYLOAD_BYTES), proposalSha256: sha,
      basePublicationId: uuid.nullable(), baseHeadChangedAt: instant.nullable(),
      baseContentSha256: sha.nullable() }),
    sourceReceipts: z.array(z.strictObject({ sourceVersionId: uuid, contentSha256: sha,
      retrievedAt: instant, languageCode: language.nullable() })).min(1).max(120),
    base: z.strictObject({ publicationJson: z.string().min(2).max(24_576), publicationSha256: sha }).nullable(),
  }),
  z.strictObject({ schemaVersion: z.literal(1),
    status: z.enum(["not_found", "capture_missing", "changed"]), requested: proposalScopeSchema }),
]);
export type CapturedProposalEnvelope = z.infer<typeof capturedProposalEnvelopeSchema>;
export type CapturedProposalReport = Extract<CapturedProposalEnvelope, { status: "ok" }>;
export const recordedProposalBaseSchema = publication;

// UTC6 ordering is exact; Date alone would lose the microsecond boundary.
export function proposalMicros(value: string): bigint {
  return BigInt(Date.parse(value.slice(0, 19) + "Z")) * BigInt(1000) + BigInt(value.slice(20, 26));
}

// Display receipts allow offsets and up to six fractional digits, as PG17 does.
// Reject higher precision instead of rounding it into an earlier capture.
export function proposalEvidenceMicros(value: string): bigint {
  const millis = Date.parse(value);
  const fraction = /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/.exec(value)?.[1] ?? "";
  if (!Number.isFinite(millis) || fraction.length > 6) throw new Error("proposal_unavailable");
  return BigInt(millis) * BigInt(1000) + BigInt(fraction.slice(3).padEnd(3, "0"));
}

// Closed schemas have ASCII keys and bounded depth. Canonicalization is only
// applied to parsed plain JSON, never arbitrary objects/getters or model tools.
export function canonicalProposalJson(value: unknown): string {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) :
    v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sorted(value));
}
