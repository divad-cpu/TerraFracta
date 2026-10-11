import type { Database } from "./database.types.ts";
import type { PublicIssueProjection } from "./public-issue-projection.ts";
import { checkPublicReadConsistency } from "./public-read-consistency.ts";

type Tables = Database["terra_private"]["Tables"];
type Country = Pick<Tables["jurisdictions"]["Row"], "id" | "public_slug" | "coverage_state">;
type Dossier = Pick<Tables["issue_dossiers"]["Row"], "id" | "jurisdiction_id" | "public_slug" | "editorial_state">;
type Head = Pick<Tables["issue_heads"]["Row"], "issue_id" | "current_publication_id">;
type Publication = Pick<Tables["issue_publications"]["Row"],
  "id" | "issue_id" | "revision" | "publication_kind" | "snapshot" | "dependency_manifest">;
type Claim = Pick<Tables["claims"]["Row"],
  "id" | "issue_id" | "claim_type" | "assertion" | "evidence_state">;
type Citation = Pick<Tables["issue_publication_citations"]["Row"],
  "publication_id" | "issue_id" | "claim_id" | "source_version_id" | "locator" | "relation"> & { machine_binding?: unknown };
type Version = Pick<Tables["source_versions"]["Row"],
  "id" | "registration_id" | "source_url" | "retrieved_at"> & { content_sha256?: string };
type Registration = Pick<Tables["source_registrations"]["Row"],
  "id" | "publisher" | "registration_state" | "allow_public_derived" | "reviewed_at">;
type DisplayReview = Pick<Tables["source_display_reviews"]["Row"],
  "source_version_id" | "revision" | "decision" | "display_title" |
  "title_language" | "reviewed_at">;
type TextReview = Pick<Tables["issue_text_reviews"]["Row"],
  "publication_id" | "revision" | "decision" | "display_title" |
  "display_summary" | "reviewed_at">;
type PeriodReview = Pick<Tables["claim_period_reviews"]["Row"],
  "publication_id" | "claim_id" | "revision" | "decision" |
  "period_label" | "reviewed_at">;
type AssertionReview = Pick<Tables["claim_assertion_reviews"]["Row"],
  "publication_id" | "claim_id" | "revision" | "decision" |
  "claim_type" | "display_assertion" | "reviewed_at">;

export type CandidatePublicReadRows = {
  requestedRoute: { jurisdictionSlug: string; issueSlug: string };
  country: Country;
  dossier: Dossier;
  head: Head;
  publication: Publication;
  publication_display_review: TextReview | null;
  claims: Array<Claim & {
    period_review: PeriodReview | null;
    assertion_review: AssertionReview | null;
  }>;
  citations: Citation[];
  sources: Array<{ version: Version; registration: Registration; display_review: DisplayReview | null }>;
};

// Pure, server-oriented mapping. The caller must fetch every row in one consistent
// database read and authorize the read; this function cannot do either.
export function materializePublicIssueFromRows(input: CandidatePublicReadRows): PublicIssueProjection {
  const { country, dossier, head, publication } = input;
  if (!country.public_slug || !dossier.public_slug ||
      input.requestedRoute.jurisdictionSlug !== country.public_slug ||
      input.requestedRoute.issueSlug !== dossier.public_slug) {
    throw new Error("Requested route does not match private route rows");
  }
  if (head.issue_id !== dossier.id || publication.issue_id !== dossier.id ||
      head.current_publication_id !== publication.id) {
    throw new Error("Head, publication and dossier are not one issue revision");
  }
  for (const { version, registration } of input.sources) {
    if (version.registration_id !== registration.id) {
      throw new Error("Source version is paired with another registration");
    }
  }

  const projection = checkPublicReadConsistency({
    envelope: {
      currentPublicationId: head.current_publication_id,
      publication: {
        id: publication.id,
        issueId: publication.issue_id,
        revision: publication.revision,
        kind: publication.publication_kind,
        snapshot: publication.snapshot,
        dependencyManifest: publication.dependency_manifest,
      },
    },
    publicationReview: input.publication_display_review === null ? null : {
      publicationId: input.publication_display_review.publication_id,
      revision: input.publication_display_review.revision,
      decision: input.publication_display_review.decision,
      displayTitle: input.publication_display_review.display_title,
      displaySummary: input.publication_display_review.display_summary,
      reviewedAt: input.publication_display_review.reviewed_at,
    },
    jurisdiction: {
      id: country.id,
      publicSlug: country.public_slug,
      coverageState: country.coverage_state,
    },
    dossier: {
      id: dossier.id,
      jurisdictionId: dossier.jurisdiction_id,
      publicSlug: dossier.public_slug,
      editorialState: dossier.editorial_state,
    },
    claims: input.claims.map((item) => ({
      id: item.id, issueId: item.issue_id, evidenceState: item.evidence_state,
      assertionReview: item.assertion_review === null ? null : {
        publicationId: item.assertion_review.publication_id,
        claimId: item.assertion_review.claim_id,
        revision: item.assertion_review.revision,
        decision: item.assertion_review.decision,
        claimType: item.assertion_review.claim_type,
        displayAssertion: item.assertion_review.display_assertion,
        reviewedAt: item.assertion_review.reviewed_at,
      },
      periodReview: item.period_review === null ? null : {
        publicationId: item.period_review.publication_id,
        claimId: item.period_review.claim_id,
        revision: item.period_review.revision,
        decision: item.period_review.decision,
        periodLabel: item.period_review.period_label,
        reviewedAt: item.period_review.reviewed_at,
      },
    })),
    citations: input.citations.map((item) => ({
      publicationId: item.publication_id,
      issueId: item.issue_id,
      claimId: item.claim_id,
      sourceVersionId: item.source_version_id,
      locator: item.locator,
      relation: item.relation,
      machineBinding: item.machine_binding,
    })),
    sources: input.sources.map(({ version, registration, display_review }) => ({
      id: version.id,
      sourceUrl: version.source_url,
      contentSha256: version.content_sha256,
      retrievedAt: version.retrieved_at,
      registrationState: registration.registration_state,
      allowPublicDerived: registration.allow_public_derived,
      rightsReviewedAt: registration.reviewed_at,
      publicReview: display_review === null ? null : {
        sourceVersionId: display_review.source_version_id,
        revision: display_review.revision,
        decision: display_review.decision,
        displayTitle: display_review.display_title,
        titleLanguage: display_review.title_language,
        reviewedAt: display_review.reviewed_at,
      },
    })),
  });

  const claims = new Map(input.claims.map((item) => [item.id, item]));
  const sources = new Map(input.sources.map((item) => [item.version.id, item]));
  for (const item of projection.claims) {
    const current = claims.get(item.id);
    if (!current || current.claim_type !== item.type || current.assertion !== item.assertion) {
      throw new Error("Displayed claim does not match its private claim row");
    }
    for (const evidence of item.evidence) {
      if (sources.get(evidence.sourceVersionId)?.registration.publisher !== evidence.publisher) {
        throw new Error("Displayed publisher does not match its private source registration");
      }
    }
  }
  // The v1 snapshot contains a publication-date slot, but current source-title
  // decisions and qualified receipt bindings do not establish that metadata.
  // Keep every existing check above (including impossible/future-date refusal)
  // before withholding this unbound value on a fresh public projection. Never
  // alter the retained snapshot/hash or substitute raw version metadata.
  return { ...projection, claims: projection.claims.map(item => ({ ...item,
    evidence: item.evidence.map(evidence => ({ ...evidence, sourcePublishedOn: null })),
  })) };
}
