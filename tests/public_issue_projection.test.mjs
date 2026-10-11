import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";

const publicationId = "11111111-1111-4111-8111-111111111111";
const sourceVersionId = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";
const issueId = "44444444-4444-4444-8444-444444444444";

function eligibleShape() {
  return {
    currentPublicationId: publicationId,
    publication: {
      id: publicationId,
      issueId,
      revision: 1,
      kind: "accepted",
      snapshot: {
        schemaVersion: 1,
        jurisdictionSlug: "norway",
        issueSlug: "sample-issue",
        title: "Sample issue",
        summary: "A bounded sample summary, not a live claim.",
        lastEvidenceReviewOn: "2026-09-25",
        claims: [{
          id: claimId,
          type: "condition",
          assertion: "Sample assertion.",
          periodLabel: "Example period",
          evidence: [{
            sourceVersionId,
            publisher: "Example publisher",
            title: "Example source",
            url: "https://example.org/source",
            locator: "Table 1",
            relation: "supports",
            sourcePublishedOn: null,
            retrievedAt: "2026-09-25T12:00:00Z",
          }],
        }],
      },
      dependencyManifest: { sourceVersionIds: [sourceVersionId] },
    },
  };
}

test("a current, well-shaped snapshot yields only public display fields", () => {
  const result = parsePublicIssueProjection(eligibleShape());
  assert.equal(result.publicationId, publicationId);
  assert.equal(result.claims[0].evidence[0].locator, "Table 1");
  assert.deepEqual(Object.keys(result), [
    "issueId", "publicationId", "revision", "jurisdictionSlug", "issueSlug",
    "title", "summary", "lastEvidenceReviewOn", "claims",
  ]);
});

test("draft, suppression, stale head and private fields fail closed", () => {
  for (const kind of ["draft", "suppression"]) {
    const input = eligibleShape();
    input.publication.kind = kind;
    assert.throws(() => parsePublicIssueProjection(input));
  }
  const stale = eligibleShape();
  stale.currentPublicationId = issueId;
  assert.throws(() => parsePublicIssueProjection(stale));
  const privateField = eligibleShape();
  privateField.publication.snapshot.rawArchivePath = "/private/raw";
  assert.throws(() => parsePublicIssueProjection(privateField));
});

test("missing, extra and duplicate source dependencies are rejected", () => {
  const missing = eligibleShape();
  missing.publication.dependencyManifest.sourceVersionIds = [];
  assert.throws(() => parsePublicIssueProjection(missing));
  const extra = eligibleShape();
  extra.publication.dependencyManifest.sourceVersionIds.push(issueId);
  assert.throws(() => parsePublicIssueProjection(extra));
  const duplicate = eligibleShape();
  duplicate.publication.dependencyManifest.sourceVersionIds.push(sourceVersionId);
  assert.throws(() => parsePublicIssueProjection(duplicate));
});

test("a claim needs an actual support locator and a public HTTPS source", () => {
  const noSupport = eligibleShape();
  noSupport.publication.snapshot.claims[0].evidence[0].relation = "context";
  assert.throws(() => parsePublicIssueProjection(noSupport));
  for (const url of ["http://example.org/source", "https://localhost/private", "https://127.0.0.1/private", "https://user:pass@example.org/private"]) {
    const local = eligibleShape();
    local.publication.snapshot.claims[0].evidence[0].url = url;
    assert.throws(() => parsePublicIssueProjection(local));
  }
  const withoutLocator = eligibleShape();
  withoutLocator.publication.snapshot.claims[0].evidence[0].locator = "  ";
  assert.throws(() => parsePublicIssueProjection(withoutLocator));
});

test("contradicting context can accompany, but cannot replace, support", () => {
  const withConflict = eligibleShape();
  withConflict.publication.snapshot.claims[0].evidence.push({
    ...withConflict.publication.snapshot.claims[0].evidence[0],
    locator: "Table 2",
    relation: "contradicts",
  });
  const result = parsePublicIssueProjection(withConflict);
  assert.deepEqual(result.claims[0].evidence.map((item) => item.relation), ["supports", "contradicts"]);
  withConflict.publication.snapshot.claims[0].evidence.shift();
  assert.throws(() => parsePublicIssueProjection(withConflict));
});

test("the illustrative UI model cannot be passed off as an accepted publication", () => {
  const example = eligibleShape();
  example.publication.snapshot.contentKind = "synthetic_local_example";
  assert.throws(() => parsePublicIssueProjection(example));
});
