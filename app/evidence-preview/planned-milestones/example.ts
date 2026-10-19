import { sourceLanguageSidecarSha256 } from "../../../src/server/source-language-sidecar.ts";
import { sourceLanguageSidecarSchema } from "../../../src/source-language-sidecar.ts";
import { sixStageEvidenceRows } from "../six-stage-example.ts";
import { inventedPrivateReadRows } from "../../../src/synthetic-private-read-rows.ts";
import { plannedMilestoneCandidateSchema } from "../../../src/planned-milestone-candidate.ts";
import { plannedMilestoneSnapshotSha256, plannedMilestoneCandidateSha256 } from "../../../src/server/planned-milestone-candidate.ts";

// Entirely invented targets, institutions, content hashes and review decisions.
// This creates no actual plan, source approval, publication or completed event.
export function inventedPlannedMilestoneCandidate() {
  const rows = inventedPrivateReadRows(sixStageEvidenceRows());
  const hashes = ["a", "b", "c", "d", "e", "f", "0"];
  const sources = rows.sources.map((source, index) => {
    const spelling = hashes[index];
    if (spelling === undefined) throw new Error("Fictional milestone sources unavailable");
    source.version.content_sha256 = spelling.repeat(64);
    return { sourceVersionId: source.version.id, contentSha256: source.version.content_sha256 };
  });
  const policy = rows.claims.find(claim => claim.claim_type === "policy_action"), delivery = rows.claims.find(claim => claim.claim_type === "delivery");
  if (!policy || !delivery) throw new Error("Fictional milestone association unavailable");
  const reference = (claimId: string, referenceNumber = 1) => [{ claimId, referenceNumber, relation: "supports" as const }];
  const dates = [{ precision: "day", value: "2027-06-14" }, { precision: "month", value: "2027-06" },
    { precision: "year", value: "2027" }, { precision: "year", value: "2028" },
    { precision: "period", label: "After a separately described fictional consultation" }, null] as const;
  const candidate = plannedMilestoneCandidateSchema.parse({
    schemaVersion: 1, kind: "planned_milestone_candidate", publicationId: rows.publication.id,
    revision: rows.publication.revision, baseSnapshotSha256: plannedMilestoneSnapshotSha256(rows.publication.snapshot), sources,
    entries: dates.map((date, index) => {
      const claimId = index % 2 === 0 ? policy.id : delivery.id;
      return { claimId, fields: {
        description: { wording: `Fictional source-described target ${index + 1}; completion has not been established.`, references: reference(claimId) },
        targetDate: date === null ? null : { date, references: reference(claimId) },
        institution: index === 0 ? { wording: "Fictional local implementation unit", references: reference(rows.claims[0].id, 3) } : null,
        reportedDate: index === 0 ? { date: { precision: "day", value: "2026-09-25" }, references: reference(claimId) } : null,
      } };
    }),
  });
  const candidateSha256 = plannedMilestoneCandidateSha256(candidate), header = { publicationId: candidate.publicationId,
    revision: candidate.revision, baseSnapshotSha256: candidate.baseSnapshotSha256, candidateSha256, decision: "accepted" as const };
  const reviews = candidate.entries.flatMap((entry, index) => Object.entries(entry.fields).filter(([, field]) => field !== null).map(([name]) => ({
    ...header, fieldPath: `/entries/${index}/fields/${name}`, reviewedAt: "2026-09-25T14:00:00.000000001Z",
  })));
  const sidecar = sourceLanguageSidecarSchema.parse({ schemaVersion: 1, kind: "source_language_sidecar_candidate",
    publicationId: candidate.publicationId, revision: candidate.revision, baseSnapshotSha256: candidate.baseSnapshotSha256,
    sources: sources.map((source, index) => ({ ...source, originalLanguage: index === 0 ? "Norwegian Bokmål and English — fictional wording" : null })),
  });
  const languageHeader = { publicationId: sidecar.publicationId, revision: sidecar.revision,
    baseSnapshotSha256: sidecar.baseSnapshotSha256, sidecarSha256: sourceLanguageSidecarSha256(sidecar), decision: "accepted" as const };
  const language = { sidecar, reviews: sidecar.sources.filter(source => source.originalLanguage !== null).map(source => ({
    ...languageHeader, sourceVersionId: source.sourceVersionId, contentSha256: source.contentSha256, reviewedAt: "2026-09-25T14:00:00.000000003Z",
  })), finalReview: { ...languageHeader, reviewedAt: "2026-09-25T14:00:00.000000004Z" } };
  return { rows, candidate, reviews, language, finalReview: { ...header, reviewedAt: "2026-09-25T14:00:00.000000002Z" } };
}
