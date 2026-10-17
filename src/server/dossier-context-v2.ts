import { createHash } from "node:crypto";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { checkPublicReadConsistency } from "../public-read-consistency.ts";
import { materializePublicIssueFromRows, type CandidatePublicReadRows } from "../public-read-materializer.ts";
import { compareRecordedInstants } from "../recorded-instant-order.ts";
import { dossierSnapshotV2Schema, dossierProjectionV2Schema, dossierContextReviewV2Schema,
  suppliedDossierContextFields, type DossierProjectionV2, type DossierSnapshotV2 } from "../dossier-context-v2.ts";
import type { PublicIssueProjection } from "../public-issue-projection.ts";

// Pure local candidate qualification. No provider, SQL, writer, default reader,
// source approval, credential or publication operation is installed here.
function snapshot(input: unknown): DossierSnapshotV2 {
  const parsed = dossierSnapshotV2Schema.parse(input);
  if (canonicalProposalJson(input) !== canonicalProposalJson(parsed)) throw new Error("Noncanonical v2 snapshot");
  return parsed;
}
export function dossierSnapshotV2Sha256(input: unknown): string {
  return createHash("sha256").update(canonicalProposalJson(snapshot(input)), "utf8").digest("hex");
}
function legacySnapshot(value: DossierSnapshotV2) {
  const { dossierContext: _context, schemaVersion: _version, ...base } = value;
  return { schemaVersion: 1, ...base };
}
// Accepted review authority must be supplied in this bundle. Do not invoke an
// accessor or borrow a prototype value, including for the shared final instant.
function ownData(input: unknown, key: string): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("V2 review bundle unavailable");
  return ownPropertyValue(input, key);
}
function ownPropertyValue(input: object, key: string): unknown {
  const property = Object.getOwnPropertyDescriptor(input, key);
  if (!property || !("value" in property)) throw new Error("V2 review bundle requires own data properties");
  return property.value;
}
function finalReview(input: unknown, key: string) {
  const instant = ownData(input, key);
  if (typeof instant !== "string") throw new Error("V2 final review instant unavailable");
  return { record: { ...(input as Record<string, unknown>), [key]: instant }, instant };
}
function ownReviewRows(input: unknown) {
  if (!Array.isArray(input)) throw new Error("V2 review rows unavailable");
  const length = ownPropertyValue(input, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > 35 ||
      Reflect.ownKeys(input).length !== length + 1) throw new Error("V2 review rows exceed their closed shape");
  const keys = ["publicationId", "revision", "snapshotSha256", "fieldPath", "decision", "reviewedAt"];
  const rows = [];
  for (let index = 0; index < length; index++) {
    const row = ownPropertyValue(input, String(index));
    if (row === null || typeof row !== "object" || Array.isArray(row) ||
        Reflect.ownKeys(row).length !== keys.length) throw new Error("V2 review row requires a closed own data record");
    rows.push(Object.fromEntries(keys.map(key => [key, ownData(row, key)])));
  }
  return dossierContextReviewV2Schema.parse(rows);
}
function qualify(base: PublicIssueProjection, value: DossierSnapshotV2, rawReviews: unknown,
  finalReviewAt: string): DossierProjectionV2 {
  const reviews = ownReviewRows(rawReviews), fields = suppliedDossierContextFields(value.dossierContext);
  const claims = new Map(base.claims.map(claim => [claim.id, claim]));
  const entries = new Set<string>();
  for (const entry of value.dossierContext.responsibilities) {
    if (!claims.has(entry.claimId)) throw new Error("Responsibility belongs to another statement");
    const identity = canonicalProposalJson(entry);
    if (entries.has(identity)) throw new Error("Duplicate responsibility entry");
    entries.add(identity);
  }
  const reviewByPath = new Map(reviews.map(review => [review.fieldPath, review]));
  if (reviewByPath.size !== reviews.length || reviews.length !== fields.length ||
      reviews.some(review => !fields.some(field => field.path === review.fieldPath))) {
    throw new Error("Context review set does not match supplied fields");
  }
  const digest = dossierSnapshotV2Sha256(value);
  for (const { path, field } of fields) {
    const seen = new Set<string>();
    for (const reference of field.references) {
      const key = JSON.stringify([reference.claimId, reference.referenceNumber]);
      if (seen.has(key) || !claims.get(reference.claimId)?.evidence[reference.referenceNumber - 1]) {
        throw new Error("Context reference is repeated or outside this publication");
      }
      seen.add(key);
    }
    const review = reviewByPath.get(path)!;
    if (review.publicationId !== base.publicationId || review.revision !== base.revision || review.snapshotSha256 !== digest ||
        compareRecordedInstants(review.reviewedAt, finalReviewAt) > 0 ||
        new Date(review.reviewedAt).toISOString().slice(0, 10) < base.lastEvidenceReviewOn) {
      throw new Error("Context lacks an exact current accepted review");
    }
  }
  return dossierProjectionV2Schema.parse({ ...base, schemaVersion: 2, dossierContext: value.dossierContext });
}

// Reuses the complete current-head/source/rights/claim/citation consistency
// checks. This entry is for the existing invented consistency-input exercise.
export function checkDossierContextV2Consistency(input: unknown): DossierProjectionV2 {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("V2 candidate unavailable");
  const contextReviews = ownData(input, "contextReviews");
  const { contextReviews: _reviews, ...baseInput } = input as Record<string, unknown>;
  const final = finalReview(ownData(baseInput, "publicationReview"), "reviewedAt");
  const envelope = baseInput.envelope as { publication?: { snapshot?: unknown } } | undefined;
  const value = snapshot(envelope?.publication?.snapshot);
  const legacyEnvelope = { ...envelope, publication: { ...envelope!.publication, snapshot: legacySnapshot(value) } };
  const base = checkPublicReadConsistency({ ...baseInput, envelope: legacyEnvelope, publicationReview: final.record });
  return qualify(base, value, contextReviews, final.instant);
}

export type CandidateDossierContextRowsV2 = CandidatePublicReadRows & { context_reviews: unknown };

// Future trusted callers must obtain all base and context rows in one consistent
// authorized read. Reuse the full private-row mapper, including current private
// assertion/publisher checks and the withholding of unbound source dates.
export function materializeDossierContextV2FromRows(input: CandidateDossierContextRowsV2): DossierProjectionV2 {
  const contextReviews = ownData(input, "context_reviews");
  const final = finalReview(ownData(input, "publication_display_review"), "reviewed_at");
  const value = snapshot(input.publication.snapshot);
  const base = materializePublicIssueFromRows({ ...input,
    publication_display_review: final.record as CandidatePublicReadRows["publication_display_review"],
    publication: { ...input.publication, snapshot: legacySnapshot(value) } });
  return qualify(base, value, contextReviews, final.instant);
}
