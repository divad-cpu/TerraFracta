import assert from "node:assert/strict";
import test from "node:test";
import { checkPublicReadConsistency } from "../src/public-read-consistency.ts";

const publicationId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";
const sourceId = "44444444-4444-4444-8444-444444444444";

function sample() {
  return {
    envelope: {
      currentPublicationId: publicationId,
      publication: {
        id: publicationId,
        issueId,
        revision: 1,
        kind: "accepted",
        snapshot: {
          schemaVersion: 1,
          jurisdictionSlug: "sample-place",
          issueSlug: "sample-issue",
          title: "Synthetic issue",
          summary: "Synthetic summary for a structural check.",
          lastEvidenceReviewOn: "2026-09-25",
          claims: [{
            id: claimId,
            type: "condition",
            assertion: "Synthetic assertion.",
            periodLabel: "Example period",
            evidence: [{
              sourceVersionId: sourceId,
              publisher: "Example publisher",
              title: "Example source",
              url: "https://example.org/source",
              locator: "Table 1",
              relation: "supports",
              sourcePublishedOn: "2026-09-24",
              retrievedAt: "2026-09-25T12:00:00Z",
            }],
          }],
        },
        dependencyManifest: { sourceVersionIds: [sourceId] },
      },
    },
    publicationReview: {
      publicationId,
      revision: 1,
      decision: "accepted",
      displayTitle: "Synthetic issue",
      displaySummary: "Synthetic summary for a structural check.",
      reviewedAt: "2026-09-25T13:00:00Z",
    },
    jurisdiction: { id: "TF-SAMPLE", publicSlug: "sample-place", coverageState: "published" },
    dossier: { id: issueId, jurisdictionId: "TF-SAMPLE", publicSlug: "sample-issue", editorialState: "accepted" },
    citations: [{ publicationId, issueId, claimId, sourceVersionId: sourceId,
      locator: "Table 1", relation: "supports" }],
    claims: [{
      id: claimId, issueId, evidenceState: "supported",
      assertionReview: {
        publicationId,
        claimId,
        revision: 1,
        decision: "accepted",
        claimType: "condition",
        displayAssertion: "Synthetic assertion.",
        reviewedAt: "2026-09-25T12:45:00Z",
      },
      periodReview: {
        publicationId,
        claimId,
        revision: 1,
        decision: "accepted",
        periodLabel: "Example period",
        reviewedAt: "2026-09-25T12:40:00Z",
      },
    }],
    sources: [{
      id: sourceId,
      sourceUrl: "https://example.org/source",
      retrievedAt: "2026-09-25T12:00:00Z",
      registrationState: "approved",
      allowPublicDerived: true,
      rightsReviewedAt: "2026-09-24T12:00:00Z",
      publicReview: {
        sourceVersionId: sourceId,
        revision: 1,
        decision: "accepted",
        displayTitle: "Example source",
        titleLanguage: "en",
        reviewedAt: "2026-09-25T12:30:00Z",
      },
    }],
  };
}

test("consistent synthetic rows produce the bounded display projection", () => {
  assert.equal(checkPublicReadConsistency(sample()).issueSlug, "sample-issue");
});

test("issue wording needs the accepted current publication text review", () => {
  const absent = sample();
  absent.publicationReview = null;
  assert.throws(() => checkPublicReadConsistency(absent));
  const withdrawn = sample();
  withdrawn.publicationReview.decision = "withdrawn";
  assert.throws(() => checkPublicReadConsistency(withdrawn));
  const otherPublication = sample();
  otherPublication.publicationReview.publicationId = issueId;
  assert.throws(() => checkPublicReadConsistency(otherPublication));
  const changedTitle = sample();
  changedTitle.envelope.publication.snapshot.title = "Unreviewed title";
  assert.throws(() => checkPublicReadConsistency(changedTitle));
  const changedSummary = sample();
  changedSummary.envelope.publication.snapshot.summary = "Unreviewed summary";
  assert.throws(() => checkPublicReadConsistency(changedSummary));
});

test("issue text review must follow evidence, title and rights review", () => {
  const earlierDay = sample();
  earlierDay.publicationReview.reviewedAt = "2026-09-24T23:59:59Z";
  assert.throws(() => checkPublicReadConsistency(earlierDay));
  const beforeSource = sample();
  beforeSource.publicationReview.reviewedAt = "2026-09-25T12:29:59.999999Z";
  assert.throws(() => checkPublicReadConsistency(beforeSource));
  const afterRights = sample();
  afterRights.sources[0].rightsReviewedAt = "2026-09-25T13:00:00.000001Z";
  assert.throws(() => checkPublicReadConsistency(afterRights));
});

test("claim period label must match a current accepted review for this publication", () => {
  const absent = sample();
  absent.claims[0].periodReview = null;
  assert.throws(() => checkPublicReadConsistency(absent));
  const withdrawn = sample();
  withdrawn.claims[0].periodReview.decision = "withdrawn";
  assert.throws(() => checkPublicReadConsistency(withdrawn));
  const changed = sample();
  changed.envelope.publication.snapshot.claims[0].periodLabel = "Unreviewed period";
  assert.throws(() => checkPublicReadConsistency(changed));
  const wrongPublication = sample();
  wrongPublication.claims[0].periodReview.publicationId = issueId;
  assert.throws(() => checkPublicReadConsistency(wrongPublication));
});

test("period review must follow evidence date and precede issue text review", () => {
  const earlyDay = sample();
  earlyDay.claims[0].periodReview.reviewedAt = "2026-09-24T23:59:59Z";
  assert.throws(() => checkPublicReadConsistency(earlyDay));
  const lateMicrosecond = sample();
  lateMicrosecond.claims[0].periodReview.reviewedAt = "2026-09-25T13:00:00.000001Z";
  assert.throws(() => checkPublicReadConsistency(lateMicrosecond));
});

test("dossier or claim identity mismatch blocks the read", () => {
  const wrongDossier = sample();
  wrongDossier.dossier.publicSlug = "other-issue";
  assert.throws(() => checkPublicReadConsistency(wrongDossier));
  const wrongClaim = sample();
  wrongClaim.claims[0].issueId = publicationId;
  assert.throws(() => checkPublicReadConsistency(wrongClaim));
});

test("unreviewed claim, suspended source or lost public right blocks the read", () => {
  const unreviewed = sample();
  unreviewed.claims[0].evidenceState = "unreviewed";
  assert.throws(() => checkPublicReadConsistency(unreviewed));
  const suspended = sample();
  suspended.sources[0].registrationState = "suspended";
  assert.throws(() => checkPublicReadConsistency(suspended));
  const noRight = sample();
  noRight.sources[0].allowPublicDerived = false;
  assert.throws(() => checkPublicReadConsistency(noRight));
});

test("a changed URL, retrieval time or unlisted source blocks the read", () => {
  const changedUrl = sample();
  changedUrl.sources[0].sourceUrl = "https://example.org/other";
  assert.throws(() => checkPublicReadConsistency(changedUrl));
  const changedTime = sample();
  changedTime.sources[0].retrievedAt = "2026-09-25T13:00:00Z";
  assert.throws(() => checkPublicReadConsistency(changedTime));
  const extra = sample();
  extra.sources.push({ ...extra.sources[0], id: publicationId });
  assert.throws(() => checkPublicReadConsistency(extra));
});

test("a missing, withdrawn or mismatched source-title review blocks display", () => {
  const missing = sample();
  missing.sources[0].publicReview = null;
  assert.throws(() => checkPublicReadConsistency(missing));
  const withdrawn = sample();
  withdrawn.sources[0].publicReview.decision = "withdrawn";
  assert.throws(() => checkPublicReadConsistency(withdrawn));
  const changedTitle = sample();
  changedTitle.envelope.publication.snapshot.claims[0].evidence[0].title = "Invented replacement";
  assert.throws(() => checkPublicReadConsistency(changedTitle));
  const wrongVersion = sample();
  wrongVersion.sources[0].publicReview.sourceVersionId = issueId;
  assert.throws(() => checkPublicReadConsistency(wrongVersion));
});

test("source-title review must follow retrieval and precede evidence review", () => {
  const early = sample();
  early.sources[0].publicReview.reviewedAt = "2026-09-25T11:59:59.999999Z";
  assert.throws(() => checkPublicReadConsistency(early));
  const laterDay = sample();
  laterDay.sources[0].publicReview.reviewedAt = "2026-09-26T00:00:00Z";
  assert.throws(() => checkPublicReadConsistency(laterDay));
  const earlierMicrosecond = sample();
  earlierMicrosecond.sources[0].retrievedAt = "2026-09-25T12:00:00.123457Z";
  earlierMicrosecond.envelope.publication.snapshot.claims[0].evidence[0].retrievedAt =
    "2026-09-25T12:00:00.123457Z";
  earlierMicrosecond.sources[0].publicReview.reviewedAt = "2026-09-25T12:00:00.123456Z";
  assert.throws(() => checkPublicReadConsistency(earlierMicrosecond));
});

test("equivalent timezone text matches but different microseconds do not", () => {
  const equivalent = sample();
  equivalent.sources[0].retrievedAt = "2026-09-25T12:00:00+00:00";
  assert.equal(checkPublicReadConsistency(equivalent).issueSlug, "sample-issue");
  equivalent.sources[0].retrievedAt = "2026-09-25T14:00:00+02:00";
  assert.equal(checkPublicReadConsistency(equivalent).issueSlug, "sample-issue");
  const differentMicrosecond = sample();
  differentMicrosecond.sources[0].retrievedAt = "2026-09-25T12:00:00.123456Z";
  differentMicrosecond.envelope.publication.snapshot.claims[0].evidence[0].retrievedAt = "2026-09-25T12:00:00.123457Z";
  assert.throws(() => checkPublicReadConsistency(differentMicrosecond));
});

test("review before retrieval and future source publication dates block the read", () => {
  const staleReview = sample();
  staleReview.envelope.publication.snapshot.lastEvidenceReviewOn = "2026-09-24";
  assert.throws(() => checkPublicReadConsistency(staleReview));
  const futurePublication = sample();
  futurePublication.envelope.publication.snapshot.claims[0].evidence[0].sourcePublishedOn = "2026-09-26";
  assert.throws(() => checkPublicReadConsistency(futurePublication));
  const newerRightsReview = sample();
  newerRightsReview.sources[0].rightsReviewedAt = "2026-09-26T08:00:00Z";
  assert.throws(() => checkPublicReadConsistency(newerRightsReview));
});

test("selected citation rows must exactly match every displayed locator and relation", () => {
  const missing = sample();
  missing.citations = [];
  assert.throws(() => checkPublicReadConsistency(missing));
  const changedLocator = sample();
  changedLocator.citations[0].locator = "Other table";
  assert.throws(() => checkPublicReadConsistency(changedLocator));
  const changedRelation = sample();
  changedRelation.citations[0].relation = "context";
  assert.throws(() => checkPublicReadConsistency(changedRelation));
  const extra = sample();
  extra.citations.push({ ...extra.citations[0], locator: "Unexpected footnote" });
  assert.throws(() => checkPublicReadConsistency(extra));
  const duplicate = sample();
  duplicate.citations.push({ ...duplicate.citations[0] });
  assert.throws(() => checkPublicReadConsistency(duplicate));
  const wrongPublication = sample();
  wrongPublication.citations[0].publicationId = issueId;
  assert.throws(() => checkPublicReadConsistency(wrongPublication));
});

test("claim wording and type need the current exact assertion decision", () => {
  const absent = sample();
  delete absent.claims[0].assertionReview;
  assert.throws(() => checkPublicReadConsistency(absent));
  const changed = sample();
  changed.claims[0].assertionReview.displayAssertion = "Different text";
  assert.throws(() => checkPublicReadConsistency(changed));
  const type = sample();
  type.claims[0].assertionReview.claimType = "funding";
  assert.throws(() => checkPublicReadConsistency(type));
  const withdrawn = sample();
  withdrawn.claims[0].assertionReview.decision = "withdrawn";
  assert.throws(() => checkPublicReadConsistency(withdrawn));
  const late = sample();
  late.claims[0].assertionReview.reviewedAt = "2026-09-25T13:00:01Z";
  assert.throws(() => checkPublicReadConsistency(late));
});

test("jurisdiction route identity and published coverage must match the issue", () => {
  const wrongCountry = sample();
  wrongCountry.jurisdiction.publicSlug = "other-place";
  assert.throws(() => checkPublicReadConsistency(wrongCountry));
  const wrongJurisdictionId = sample();
  wrongJurisdictionId.dossier.jurisdictionId = "TF-OTHER";
  assert.throws(() => checkPublicReadConsistency(wrongJurisdictionId));
  const unpublished = sample();
  unpublished.jurisdiction.coverageState = "researching";
  assert.throws(() => checkPublicReadConsistency(unpublished));
  const noSlug = sample();
  noSlug.jurisdiction.publicSlug = "";
  assert.throws(() => checkPublicReadConsistency(noSlug));
});
