import { inventedDossierContextV2Candidate } from "../example.ts";
import { suppliedDossierContextFields } from "../../../../src/dossier-context-v2.ts";
import { dossierSnapshotV2Sha256 } from "../../../../src/server/dossier-context-v2.ts";

// Two invented candidates, not reads of current or historical database rows.
export function inventedDossierContextComparisonPair() {
  const earlier = inventedDossierContextV2Candidate(), later = inventedDossierContextV2Candidate();
  const publicationId = "cc000000-0000-4000-8000-000000000002", revision = 2;
  later.envelope.currentPublicationId = publicationId; later.envelope.publication.id = publicationId; later.envelope.publication.revision = revision;
  later.publicationReview.publicationId = publicationId; later.publicationReview.revision = revision;
  for (const claim of later.claims) for (const review of [claim.assertionReview, claim.periodReview]) { review.publicationId = publicationId; review.revision = revision; }
  for (const citation of later.citations) citation.publicationId = publicationId;
  const snapshot = later.envelope.publication.snapshot, context = snapshot.dossierContext;
  context.scope.population!.wording = "A different entirely fictional group, included only for this local comparison.";
  context.scope.period = null;
  context.responsibilities[0].fields.governmentLevel = { wording: "Invented municipal level", references: [{ ...context.scope.selectionRationale!.references[1] }] };
  context.responsibilities.reverse();
  // Same context selection wording, but a genuinely different referenced locator.
  snapshot.claims[0].evidence[2].locator += " — invented successor location";
  later.citations[2].locator = snapshot.claims[0].evidence[2].locator;
  const snapshotSha256 = dossierSnapshotV2Sha256(snapshot);
  later.contextReviews = suppliedDossierContextFields(context).map(({ path }) => ({ publicationId, revision, snapshotSha256,
    fieldPath: path, decision: "accepted", reviewedAt: "2026-09-25T18:00:00.000000001Z" }));
  return { earlier, later };
}
