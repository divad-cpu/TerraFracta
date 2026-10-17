import { sample } from "./public_read_rows_fixture.mjs";
import { pilotStages } from "../../src/synthetic-pilot-stages.ts";
export { pilotStages } from "../../src/synthetic-pilot-stages.ts";

// Private, invented candidate rows only. Accepted-looking review and rights
// fields are test inputs, never source decisions or permission to publish.
// Keep the captured-source connected reader's one-condition guard unchanged.
const uuid = n => `aa000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function sixStagePilotRows() {
  const rows = sample(), templateClaim = structuredClone(rows.claims[0]), templateSource = structuredClone(rows.sources[0]);
  rows.requestedRoute = { jurisdictionSlug: "norway", issueSlug: "housing-costs" };
  rows.country.public_slug = rows.requestedRoute.jurisdictionSlug;
  rows.dossier.public_slug = rows.requestedRoute.issueSlug;
  const snapshot = rows.publication.snapshot;
  Object.assign(snapshot, rows.requestedRoute, {
    title: "Invented six-stage pilot dossier",
    summary: "Entirely fictional conditions, response, funding, delivery, observations and evaluation. No fact about Norway or another real country is stated.",
  });
  // SQL candidate rows do not carry a verified source publication date.
  for (const claim of snapshot.claims) for (const evidence of claim.evidence) evidence.sourcePublishedOn = null;
  rows.publication_display_review.display_title = snapshot.title;
  rows.publication_display_review.display_summary = snapshot.summary;
  for (const [index, [type, period, assertion, title, locator]] of pilotStages.entries()) {
    const claimId = uuid(10 + index), sourceId = uuid(20 + index), registrationId = `registration-${sourceId}`;
    const source = structuredClone(templateSource);
    Object.assign(source.version, { id: sourceId, registration_id: registrationId, source_url: `https://example.org/fictional-${type}` });
    Object.assign(source.registration, { id: registrationId, publisher: `Fictional ${type} custodian` });
    Object.assign(source.display_review, { source_version_id: sourceId, display_title: title });
    rows.sources.push(source);
    const reference = { sourceVersionId: sourceId, publisher: source.registration.publisher, title,
      url: source.version.source_url, locator, relation: "supports", sourcePublishedOn: null, retrievedAt: source.version.retrieved_at };
    snapshot.claims.push({ id: claimId, type, assertion, periodLabel: period, evidence: [reference] });
    const claim = structuredClone(templateClaim);
    Object.assign(claim, { id: claimId, claim_type: type, assertion });
    Object.assign(claim.assertion_review, { claim_id: claimId, claim_type: type, display_assertion: assertion });
    Object.assign(claim.period_review, { claim_id: claimId, period_label: period });
    rows.claims.push(claim);
    rows.citations.push({ publication_id: rows.publication.id, issue_id: rows.dossier.id,
      claim_id: claimId, source_version_id: sourceId, locator, relation: "supports" });
    rows.publication.dependency_manifest.sourceVersionIds.push(sourceId);
  }
  return rows;
}

// A new synthetic edition is supplied explicitly by the test owner. This
// function does not review, activate, store or publish a correction.
export function sixStagePilotSuccessor(original) {
  const rows = structuredClone(original), publicationId = uuid(100);
  rows.head.current_publication_id = publicationId;
  Object.assign(rows.publication, { id: publicationId, revision: 2, publication_kind: "correction" });
  Object.assign(rows.publication_display_review, { publication_id: publicationId, revision: 2 });
  for (const claim of rows.claims) for (const name of ["assertion_review", "period_review"])
    Object.assign(claim[name], { publication_id: publicationId, revision: 2 });
  for (const citation of rows.citations) citation.publication_id = publicationId;
  const finding = rows.publication.snapshot.claims.find(claim => claim.type === "attributed_finding");
  finding.assertion = "A fictional research group revises its example observation; the revised measure still does not establish a programme effect.";
  const stored = rows.claims.find(claim => claim.id === finding.id);
  stored.assertion = finding.assertion; stored.assertion_review.display_assertion = finding.assertion;
  return rows;
}
