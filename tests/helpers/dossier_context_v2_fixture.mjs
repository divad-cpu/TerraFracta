import { createHash } from "node:crypto";
import { sample } from "./public_read_rows_fixture.mjs";
import { syntheticReadRows } from "../../app/evidence-preview/example.ts";
import { inventedDossierContext } from "../../src/synthetic-dossier-context.ts";
import { canonicalProposalJson } from "../../src/operator-proposal-capture.ts";

// Invented accepted-looking rows are test inputs. No default provider or
// operation is configured, and no field-review decision is recorded anywhere.
export const finalContextReviewAt = "2026-09-25T18:00:00.000000002Z";
export const contextReviewAt = "2026-09-25T18:00:00.000000001Z";
export const contextPublicationId = "cc000000-0000-4000-8000-000000000001";
export function contextReviews(snapshot, publicationId = contextPublicationId, revision = 1) {
  const paths = [];
  for (const [key, field] of Object.entries(snapshot.dossierContext.scope)) if (field !== null) paths.push(`/scope/${key}`);
  snapshot.dossierContext.responsibilities.forEach((entry, index) => {
    for (const [key, field] of Object.entries(entry.fields)) if (field !== null) paths.push(`/responsibilities/${index}/${key}`);
  });
  const snapshotSha256 = createHash("sha256").update(canonicalProposalJson(snapshot), "utf8").digest("hex");
  return paths.map(fieldPath => ({ publicationId, revision, snapshotSha256, fieldPath, decision: "accepted", reviewedAt: contextReviewAt }));
}
export function v2ConsistencyCandidate() {
  const value = structuredClone(syntheticReadRows), publication = value.envelope.publication;
  value.envelope.currentPublicationId = publication.id = contextPublicationId;
  value.publicationReview.publicationId = contextPublicationId; value.publicationReview.reviewedAt = finalContextReviewAt;
  for (const claim of value.claims) { claim.assertionReview.publicationId = contextPublicationId; claim.periodReview.publicationId = contextPublicationId; }
  for (const citation of value.citations) citation.publicationId = contextPublicationId;
  publication.snapshot.schemaVersion = 2;
  publication.snapshot.dossierContext = inventedDossierContext(publication.snapshot.claims[0].id);
  return { ...value, contextReviews: contextReviews(publication.snapshot) };
}
export function v2PrivateRows() {
  const rows = sample(), publication = rows.publication;
  rows.head.current_publication_id = publication.id = contextPublicationId;
  rows.publication_display_review.publication_id = contextPublicationId; rows.publication_display_review.reviewed_at = finalContextReviewAt;
  for (const claim of rows.claims) { claim.assertion_review.publication_id = contextPublicationId; claim.period_review.publication_id = contextPublicationId; }
  for (const citation of rows.citations) citation.publication_id = contextPublicationId;
  publication.snapshot.schemaVersion = 2;
  publication.snapshot.dossierContext = inventedDossierContext(publication.snapshot.claims[0].id);
  return { ...rows, context_reviews: contextReviews(publication.snapshot) };
}
