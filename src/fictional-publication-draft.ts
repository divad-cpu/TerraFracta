import { z } from "zod";
import { publicationReadEnvelopeSchema, publicSourceUrl } from "./public-issue-projection.ts";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const snapshot = publicationReadEnvelopeSchema.shape.publication.shape.snapshot;
const manifest = publicationReadEnvelopeSchema.shape.publication.shape.dependencyManifest;

// Reuses the display payload bounds, while retaining literal DRAFT state.
// This object can never pass the accepted public read envelope.
export const fictionalPublicationDraftSchema = z.strictObject({
  schemaVersion: z.literal(1),
  candidateKind: z.literal("fictional_structured_draft"),
  itemKey: z.string().min(1).max(160),
  observation: z.strictObject({
    seriesId: z.literal("fictional-share"), geography: z.literal("fictional-country"),
    period: z.string().regex(/^20[0-9]{2}$/), unit: z.literal("percent"),
    value: z.string().regex(/^(?:0|[1-9][0-9]?|100)(?:\.[0-9])?$/).refine((value) => Number(value) <= 100),
    semanticContractSha256: hash,
  }),
  decision: z.strictObject({
    disposition: z.literal("shadow_only"), policyId: z.literal("fictional-policy-v1"),
    qualificationId: z.literal("fictional-qualification-v1"), sourceVersionId: z.uuid(),
    contentSha256: hash, semanticContractSha256: hash,
    publicCitationUrl: publicSourceUrl, locator: z.string().min(1).max(300),
  }),
  publication: z.strictObject({
    id: z.uuid(), issueId: z.uuid(), revision: z.literal(1), kind: z.literal("draft"),
    previousPublicationId: z.null(), snapshot, dependencyManifest: manifest,
  }),
}).superRefine(({ observation, decision, publication }, context) => {
  const claims = publication.snapshot.claims;
  const claim = claims[0];
  const evidence = claim?.evidence[0];
  if (claims.length !== 1 || claim.evidence.length !== 1 ||
      claim.type !== "condition" || claim.periodLabel !== observation.period ||
      claim.assertion !== `In ${observation.period}, the fictional share was ${observation.value}%.` ||
      decision.semanticContractSha256 !== observation.semanticContractSha256 ||
      publication.snapshot.jurisdictionSlug !== "fictional-country" ||
      publication.snapshot.issueSlug !== "fictional-share" ||
      evidence.sourceVersionId !== decision.sourceVersionId || evidence.relation !== "supports" ||
      evidence.url !== decision.publicCitationUrl || evidence.locator !== decision.locator ||
      !["https://example.org/fictional-table", "https://example.org/fictional-table/data?format=json"].includes(evidence.url) ||
      publication.dependencyManifest.sourceVersionIds.length !== 1 ||
      publication.dependencyManifest.sourceVersionIds[0] !== decision.sourceVersionId) {
    context.addIssue({ code: "custom", message: "Fictional draft differs from its checked observation" });
  }
});

export type FictionalPublicationDraft = z.infer<typeof fictionalPublicationDraftSchema>;
