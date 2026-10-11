import { syntheticReadRows } from "../../app/evidence-preview/example.ts";

// Existing invented private-row fixture, shared by materializer and connector checks.
export function sample() {
  const original = structuredClone(syntheticReadRows);
  const publication = original.envelope.publication;
  return {
    requestedRoute: {
      jurisdictionSlug: original.jurisdiction.publicSlug,
      issueSlug: original.dossier.publicSlug,
    },
    country: {
      id: original.jurisdiction.id,
      public_slug: original.jurisdiction.publicSlug,
      coverage_state: original.jurisdiction.coverageState,
    },
    dossier: {
      id: original.dossier.id,
      jurisdiction_id: original.dossier.jurisdictionId,
      public_slug: original.dossier.publicSlug,
      editorial_state: original.dossier.editorialState,
    },
    head: { issue_id: original.dossier.id, current_publication_id: publication.id },
    publication: {
      id: publication.id, issue_id: publication.issueId, revision: publication.revision,
      publication_kind: publication.kind, snapshot: publication.snapshot,
      dependency_manifest: publication.dependencyManifest,
    },
    publication_display_review: {
      publication_id: original.publicationReview.publicationId,
      revision: original.publicationReview.revision,
      decision: original.publicationReview.decision,
      display_title: original.publicationReview.displayTitle,
      display_summary: original.publicationReview.displaySummary,
      reviewed_at: original.publicationReview.reviewedAt,
    },
    claims: original.claims.map((item) => ({
      id: item.id, issue_id: item.issueId,
      claim_type: publication.snapshot.claims.find((claim) => claim.id === item.id).type,
      assertion: publication.snapshot.claims.find((claim) => claim.id === item.id).assertion,
      evidence_state: item.evidenceState,
      assertion_review: {
        publication_id: item.assertionReview.publicationId,
        claim_id: item.assertionReview.claimId,
        revision: item.assertionReview.revision,
        decision: item.assertionReview.decision,
        claim_type: item.assertionReview.claimType,
        display_assertion: item.assertionReview.displayAssertion,
        reviewed_at: item.assertionReview.reviewedAt,
      },
      period_review: {
        publication_id: item.periodReview.publicationId,
        claim_id: item.periodReview.claimId,
        revision: item.periodReview.revision,
        decision: item.periodReview.decision,
        period_label: item.periodReview.periodLabel,
        reviewed_at: item.periodReview.reviewedAt,
      },
    })),
    citations: original.citations.map((item) => ({
      publication_id: item.publicationId, issue_id: item.issueId, claim_id: item.claimId,
      source_version_id: item.sourceVersionId, locator: item.locator, relation: item.relation,
    })),
    sources: original.sources.map((source) => ({
      version: {
        id: source.id, registration_id: `registration-${source.id}`,
        source_url: source.sourceUrl, retrieved_at: source.retrievedAt,
      },
      registration: {
        id: `registration-${source.id}`,
        publisher: publication.snapshot.claims[0].evidence.find((e) => e.sourceVersionId === source.id).publisher,
        registration_state: source.registrationState,
        allow_public_derived: source.allowPublicDerived,
        reviewed_at: source.rightsReviewedAt,
      },
      display_review: {
        source_version_id: source.publicReview.sourceVersionId,
        revision: source.publicReview.revision,
        decision: source.publicReview.decision,
        display_title: source.publicReview.displayTitle,
        title_language: source.publicReview.titleLanguage,
        reviewed_at: source.publicReview.reviewedAt,
      },
    })),
  };
}
