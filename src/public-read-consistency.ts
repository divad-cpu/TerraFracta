import { z } from "zod";
import { parsePublicIssueProjection, publicationReadEnvelopeSchema, publicSourceUrl } from "./public-issue-projection.ts";
import type { PublicIssueProjection } from "./public-issue-projection.ts";

// Future server readers must obtain these rows in one consistent database read.
// This function rejects disagreement; it cannot prove its caller fetched current rows.
const uuid = z.uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const machineBinding = z.strictObject({
  decisionId: uuid, qualificationId: uuid, disposition: z.literal("eligible"),
  sourceVersionId: uuid, contentSha256: hash,
  semanticContractSha256: hash, qualificationSemanticContractSha256: hash,
  publicCitationUrl: publicSourceUrl, qualificationPublicCitationUrl: publicSourceUrl,
  qualifiedRetrievalUrl: publicSourceUrl,
  evidenceLocator: z.string().trim().min(1).max(300),
});
const readInput = z.strictObject({
  envelope: publicationReadEnvelopeSchema,
  publicationReview: z.strictObject({
    publicationId: uuid,
    revision: z.number().int().positive(),
    decision: z.literal("accepted"),
    displayTitle: z.string().trim().min(1).max(240),
    displaySummary: z.string().trim().min(1).max(1600),
    reviewedAt: z.iso.datetime({ offset: true }),
  }),
  jurisdiction: z.strictObject({
    id: z.string().trim().min(1),
    publicSlug: z.string().trim().min(1),
    coverageState: z.literal("published"),
  }),
  dossier: z.strictObject({
    id: uuid,
    jurisdictionId: z.string().trim().min(1),
    publicSlug: z.string().trim().min(1),
    editorialState: z.literal("accepted"),
  }),
  citations: z.array(z.strictObject({
    publicationId: uuid,
    issueId: uuid,
    claimId: uuid,
    sourceVersionId: uuid,
    locator: z.string().trim().min(1).max(300),
    relation: z.enum(["supports", "contradicts", "context"]),
    machineBinding: machineBinding.nullable().optional(),
  })).min(1).max(360),
  claims: z.array(z.strictObject({
    id: uuid,
    issueId: uuid,
    evidenceState: z.literal("supported"),
    assertionReview: z.strictObject({
      publicationId: uuid,
      claimId: uuid,
      revision: z.number().int().positive(),
      decision: z.literal("accepted"),
      claimType: z.enum(["condition", "policy_action", "funding", "delivery", "attributed_finding", "evaluation"]),
      displayAssertion: z.string().trim().min(1).max(1200),
      reviewedAt: z.iso.datetime({ offset: true }),
    }),
    periodReview: z.strictObject({
      publicationId: uuid,
      claimId: uuid,
      revision: z.number().int().positive(),
      decision: z.literal("accepted"),
      periodLabel: z.string().trim().min(1).max(160),
      reviewedAt: z.iso.datetime({ offset: true }),
    }),
  })).min(1).max(30),
  sources: z.array(z.strictObject({
    id: uuid,
    sourceUrl: z.string(),
    contentSha256: hash.optional(),
    retrievedAt: z.iso.datetime({ offset: true }),
    registrationState: z.literal("approved"),
    allowPublicDerived: z.literal(true),
    rightsReviewedAt: z.iso.datetime({ offset: true }),
    publicReview: z.strictObject({
      sourceVersionId: uuid,
      revision: z.number().int().positive(),
      decision: z.literal("accepted"),
      displayTitle: z.string().trim().min(1).max(240),
      titleLanguage: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
      reviewedAt: z.iso.datetime({ offset: true }),
    }),
  })).min(1).max(120),
});

// PostgreSQL may serialize the same timestamptz with +00:00 where a reviewed
// snapshot uses Z. Keep sub-millisecond digits so nearby captures stay distinct.
function instantKey(value: string): string {
  const millis = Date.parse(value);
  const fraction = /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/.exec(value)?.[1] ?? "";
  if (!Number.isFinite(millis) || fraction.length > 9) {
    throw new Error("Invalid retrieval instant precision");
  }
  return `${millis}:${fraction.slice(3).padEnd(6, "0")}`;
}

function instantBefore(left: string, right: string): boolean {
  const [leftMillis, leftMicros] = instantKey(left).split(":");
  const [rightMillis, rightMicros] = instantKey(right).split(":");
  return Number(leftMillis) < Number(rightMillis) ||
    (leftMillis === rightMillis && leftMicros < rightMicros);
}

function exactIds(actual: string[], expected: string[], label: string) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (actualSet.size !== actual.length || expectedSet.size !== expected.length ||
      actualSet.size !== expectedSet.size || [...actualSet].some((id) => !expectedSet.has(id))) {
    throw new Error(`${label} do not match the publication`);
  }
}

export function checkPublicReadConsistency(input: unknown): PublicIssueProjection {
  const parsed = readInput.parse(input);
  const projection = parsePublicIssueProjection(parsed.envelope);
  const { jurisdiction, dossier, claims, sources, citations, publicationReview } = parsed;
  if (publicationReview.publicationId !== projection.publicationId ||
      publicationReview.displayTitle !== projection.title ||
      publicationReview.displaySummary !== projection.summary ||
      new Date(publicationReview.reviewedAt).toISOString().slice(0, 10) <
        projection.lastEvidenceReviewOn) {
    throw new Error("Issue title and summary do not match an accepted text review");
  }
  if (dossier.id !== projection.issueId ||
      dossier.jurisdictionId !== jurisdiction.id ||
      jurisdiction.publicSlug !== projection.jurisdictionSlug ||
      dossier.publicSlug !== projection.issueSlug) {
    throw new Error("Dossier identity does not match the publication");
  }

  exactIds(claims.map((item) => item.id), projection.claims.map((item) => item.id), "Claim rows");
  if (claims.some((item) => item.issueId !== projection.issueId)) {
    throw new Error("Claim belongs to another issue");
  }
  const claimById = new Map(claims.map((item) => [item.id, item]));
  for (const displayed of projection.claims) {
    const currentClaim = claimById.get(displayed.id);
    const assertion = currentClaim?.assertionReview;
    if (!assertion || assertion.publicationId !== projection.publicationId ||
        assertion.claimId !== displayed.id ||
        assertion.claimType !== displayed.type ||
        assertion.displayAssertion !== displayed.assertion ||
        instantBefore(publicationReview.reviewedAt, assertion.reviewedAt) ||
        new Date(assertion.reviewedAt).toISOString().slice(0, 10) <
          projection.lastEvidenceReviewOn) {
      throw new Error("Displayed claim lacks a current accepted assertion review");
    }
    const review = currentClaim?.periodReview;
    if (!review || review.publicationId !== projection.publicationId ||
        review.claimId !== displayed.id ||
        review.periodLabel !== displayed.periodLabel ||
        instantBefore(publicationReview.reviewedAt, review.reviewedAt) ||
        new Date(review.reviewedAt).toISOString().slice(0, 10) <
          projection.lastEvidenceReviewOn) {
      throw new Error("Displayed period label lacks a current accepted review");
    }
  }

  const citationKey = (publicationId: string, issueId: string, claimId: string,
    sourceVersionId: string, locator: string, relation: string) =>
    JSON.stringify([publicationId, issueId, claimId, sourceVersionId, locator, relation]);
  const displayedCitations = projection.claims.flatMap((item) => item.evidence.map((evidence) =>
    citationKey(projection.publicationId, projection.issueId, item.id,
      evidence.sourceVersionId, evidence.locator, evidence.relation)));
  const storedCitations = citations.map((item) => citationKey(item.publicationId, item.issueId,
    item.claimId, item.sourceVersionId, item.locator, item.relation));
  exactIds(storedCitations, displayedCitations, "Selected citation rows");

  const citedSources = projection.claims.flatMap((item) => item.evidence);
  exactIds(sources.map((item) => item.id), [...new Set(citedSources.map((item) => item.sourceVersionId))], "Source rows");
  const byId = new Map(sources.map((item) => [item.id, item]));
  for (const displayedClaim of projection.claims) for (const evidence of displayedClaim.evidence) {
    const current = byId.get(evidence.sourceVersionId);
    const selected = citations.find((item) => item.claimId === displayedClaim.id &&
      item.sourceVersionId === evidence.sourceVersionId && item.locator === evidence.locator && item.relation === evidence.relation);
    const binding = selected?.machineBinding;
    const expectedUrl = binding ? binding.publicCitationUrl : current?.sourceUrl;
    if (binding && (!current || selected?.relation !== "supports" ||
        binding.sourceVersionId !== evidence.sourceVersionId || binding.evidenceLocator !== evidence.locator ||
        binding.qualifiedRetrievalUrl !== current.sourceUrl || binding.contentSha256 !== current.contentSha256 ||
        binding.publicCitationUrl !== binding.qualificationPublicCitationUrl ||
        binding.semanticContractSha256 !== binding.qualificationSemanticContractSha256)) {
      throw new Error("Selected machine citation does not match its qualification and receipt");
    }
    if (!current || expectedUrl !== evidence.url || instantKey(current.retrievedAt) !== instantKey(evidence.retrievedAt)) {
      throw new Error("Displayed source does not match its source-version row");
    }
    if (current.publicReview.sourceVersionId !== evidence.sourceVersionId ||
        current.publicReview.displayTitle !== evidence.title ||
        instantBefore(current.publicReview.reviewedAt, current.retrievedAt)) {
      throw new Error("Displayed source title does not match a later accepted review");
    }
    if (instantBefore(publicationReview.reviewedAt, current.publicReview.reviewedAt) ||
        instantBefore(publicationReview.reviewedAt, current.rightsReviewedAt)) {
      throw new Error("Issue text review predates a selected source or rights review");
    }
    const retrievalDay = new Date(current.retrievedAt).toISOString().slice(0, 10);
    const rightsReviewDay = new Date(current.rightsReviewedAt).toISOString().slice(0, 10);
    const titleReviewDay = new Date(current.publicReview.reviewedAt).toISOString().slice(0, 10);
    if (projection.lastEvidenceReviewOn < retrievalDay ||
        projection.lastEvidenceReviewOn < rightsReviewDay ||
        projection.lastEvidenceReviewOn < titleReviewDay ||
        (evidence.sourcePublishedOn !== null && evidence.sourcePublishedOn > retrievalDay)) {
      throw new Error("Source timing is inconsistent with the evidence review");
    }
  }
  return projection;
}
