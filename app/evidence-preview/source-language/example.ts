import { inventedPrivateReadRows } from "../../../src/synthetic-private-read-rows.ts";
import { sourceLanguageSnapshotSha256, sourceLanguageSidecarSha256 } from "../../../src/server/source-language-sidecar.ts";
import type { SourceLanguageSidecar, SourceLanguageReview, SourceLanguageFinalReview } from "../../../src/source-language-sidecar.ts";

// Entirely invented labels, hashes and accepted-looking review rows. This never
// records a real decision or establishes a source's actual original language.
export function inventedSourceLanguageCandidate() {
  const rows = inventedPrivateReadRows();
  const invented = new Map([
    ["44444444-4444-4444-8444-444444444444", { hash: "a".repeat(64), language: "Norwegian Bokmål and English — fictional wording" }],
    ["55555555-5555-4555-8555-555555555555", { hash: "b".repeat(64), language: null }],
  ]);
  const sources = rows.sources.map(source => {
    const example = invented.get(source.version.id);
    if (!example) throw new Error("Fictional source-language example unavailable");
    source.version.content_sha256 = example.hash;
    return { sourceVersionId: source.version.id, contentSha256: example.hash, originalLanguage: example.language };
  });
  const sidecar: SourceLanguageSidecar = {
    schemaVersion: 1, kind: "source_language_sidecar_candidate", publicationId: rows.publication.id,
    revision: rows.publication.revision, baseSnapshotSha256: sourceLanguageSnapshotSha256(rows.publication.snapshot), sources,
  };
  const header = { publicationId: sidecar.publicationId, revision: sidecar.revision,
    baseSnapshotSha256: sidecar.baseSnapshotSha256, sidecarSha256: sourceLanguageSidecarSha256(sidecar), decision: "accepted" as const };
  const languageReviews: SourceLanguageReview[] = sources.filter(source => source.originalLanguage !== null).map(source => ({
    ...header, sourceVersionId: source.sourceVersionId, contentSha256: source.contentSha256, reviewedAt: "2026-09-25T14:00:00.000000001Z",
  }));
  const finalReview: SourceLanguageFinalReview = { ...header, reviewedAt: "2026-09-25T14:00:00.000000002Z" };
  return { rows, sidecar, languageReviews, finalReview };
}
