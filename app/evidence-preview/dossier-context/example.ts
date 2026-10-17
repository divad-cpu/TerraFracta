import { sixStageEvidenceRows } from "../six-stage-example.ts";
import { inventedDossierContext } from "../../../src/synthetic-dossier-context.ts";
import { dossierSnapshotV2Schema, suppliedDossierContextFields } from "../../../src/dossier-context-v2.ts";
import { dossierSnapshotV2Sha256 } from "../../../src/server/dossier-context-v2.ts";

// Entirely fictional consistency inputs. The accepted-looking values below are
// not persisted decisions, source approvals or a real publication operation.
export function inventedDossierContextV2Candidate() {
  const value = sixStageEvidenceRows(), publicationId = "cc000000-0000-4000-8000-000000000001";
  const old = value.envelope.publication;
  const snapshot = dossierSnapshotV2Schema.parse({ ...old.snapshot, schemaVersion: 2,
    dossierContext: inventedDossierContext(old.snapshot.claims[0].id) });
  const snapshotSha256 = dossierSnapshotV2Sha256(snapshot);
  value.publicationReview.publicationId = publicationId;
  value.publicationReview.reviewedAt = "2026-09-25T18:00:00.000000002Z";
  for (const claim of value.claims) { claim.assertionReview.publicationId = publicationId; claim.periodReview.publicationId = publicationId; }
  for (const citation of value.citations) citation.publicationId = publicationId;
  return { ...value, envelope: { currentPublicationId: publicationId, publication: { ...old, id: publicationId, snapshot } },
    contextReviews: suppliedDossierContextFields(snapshot.dossierContext).map(({ path }) => ({
      publicationId, revision: old.revision, snapshotSha256, fieldPath: path, decision: "accepted",
      reviewedAt: "2026-09-25T18:00:00.000000001Z",
    })) };
}
