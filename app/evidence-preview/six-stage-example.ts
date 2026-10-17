import { syntheticReadRows } from "./example.ts";
import { pilotStages } from "../../src/synthetic-pilot-stages.ts";

// Display rehearsal only. The checked values are invented consistency inputs,
// not real source rights, reviews, stored publications or a connected reader.
export function sixStageEvidenceRows() {
  const rows = structuredClone(syntheticReadRows);
  const publicationId = "bb000000-0000-4000-8000-000000000001";
  const publication = rows.envelope.publication, snapshot = publication.snapshot;
  rows.envelope.currentPublicationId = publicationId;
  publication.id = publicationId;
  snapshot.title = "Fictional six-stage evidence chain";
  snapshot.summary = "An entirely invented condition, response, funding allocation, delivery record, observation and evaluation. No fact about a country, government or real programme is stated.";
  Object.assign(rows.publicationReview, { publicationId, displayTitle: snapshot.title, displaySummary: snapshot.summary });
  for (const citation of rows.citations) citation.publicationId = publicationId;
  for (const claim of rows.claims) {
    claim.assertionReview.publicationId = publicationId;
    claim.periodReview.publicationId = publicationId;
  }
  const claimTemplate = structuredClone(rows.claims[0]), sourceTemplate = structuredClone(rows.sources[0]);
  for (const [index, [type, period, assertion, title, locator]] of pilotStages.entries()) {
    const claimId = `bb000000-0000-4000-8000-${String(10 + index).padStart(12, "0")}`;
    const sourceId = `bb000000-0000-4000-8000-${String(20 + index).padStart(12, "0")}`;
    const source = structuredClone(sourceTemplate);
    Object.assign(source, { id: sourceId, sourceUrl: `https://example.org/fictional-${type}` });
    Object.assign(source.publicReview, { sourceVersionId: sourceId, displayTitle: title });
    rows.sources.push(source);
    snapshot.claims.push({ id: claimId, type, assertion, periodLabel: period, evidence: [{
      sourceVersionId: sourceId, publisher: `Fictional source custodian ${index + 1}`, title, url: source.sourceUrl,
      locator, relation: "supports", sourcePublishedOn: "2026-09-20", retrievedAt: source.retrievedAt,
    }] });
    const claim = structuredClone(claimTemplate);
    claim.id = claimId;
    Object.assign(claim.assertionReview, { claimId, claimType: type, displayAssertion: assertion });
    Object.assign(claim.periodReview, { claimId, periodLabel: period });
    rows.claims.push(claim);
    rows.citations.push({ publicationId, issueId: publication.issueId, claimId, sourceVersionId: sourceId, locator, relation: "supports" });
    publication.dependencyManifest.sourceVersionIds.push(sourceId);
  }
  return rows;
}
