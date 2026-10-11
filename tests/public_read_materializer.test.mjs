import assert from "node:assert/strict";
import test from "node:test";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { materializePublicIssueFromRows } from "../src/public-read-materializer.ts";



test("synthetic private-shaped rows produce the bounded issue projection", () => {
  const issue = materializePublicIssueFromRows(sample());
  assert.equal(issue.issueSlug, "sample-housing-measure");
  assert.equal(issue.claims[0].evidence.length, 3);
});

test("current publication text decision must match title and summary", () => {
  const absent = sample();
  absent.publication_display_review = null;
  assert.throws(() => materializePublicIssueFromRows(absent));
  const changed = sample();
  changed.publication_display_review.display_summary = "Unreviewed replacement";
  assert.throws(() => materializePublicIssueFromRows(changed));
  const withdrawn = sample();
  withdrawn.publication_display_review.decision = "withdrawn";
  assert.throws(() => materializePublicIssueFromRows(withdrawn));
});

test("current claim period decision must match the displayed period", () => {
  const absent = sample();
  absent.claims[0].period_review = null;
  assert.throws(() => materializePublicIssueFromRows(absent));
  const changed = sample();
  changed.claims[0].period_review.period_label = "Different period";
  assert.throws(() => materializePublicIssueFromRows(changed));
  const withdrawn = sample();
  withdrawn.claims[0].period_review.decision = "withdrawn";
  assert.throws(() => materializePublicIssueFromRows(withdrawn));
});

test("current claim assertion decision must match type and wording", () => {
  const absent = sample();
  absent.claims[0].assertion_review = null;
  assert.throws(() => materializePublicIssueFromRows(absent));
  const changed = sample();
  changed.claims[0].assertion_review.display_assertion = "Different assertion";
  assert.throws(() => materializePublicIssueFromRows(changed));
  const wrongType = sample();
  wrongType.claims[0].assertion_review.claim_type = "funding";
  assert.throws(() => materializePublicIssueFromRows(wrongType));
  const withdrawn = sample();
  withdrawn.claims[0].assertion_review.decision = "withdrawn";
  assert.throws(() => materializePublicIssueFromRows(withdrawn));
});

test("requested route and current head must identify this revision", () => {
  const wrongRoute = sample();
  wrongRoute.requestedRoute.issueSlug = "another-issue";
  assert.throws(() => materializePublicIssueFromRows(wrongRoute));
  const staleHead = sample();
  staleHead.head.current_publication_id = staleHead.dossier.id;
  assert.throws(() => materializePublicIssueFromRows(staleHead));
  const otherIssue = sample();
  otherIssue.head.issue_id = otherIssue.publication.id;
  assert.throws(() => materializePublicIssueFromRows(otherIssue));
});

test("source registration must own its version and still allow public derivation", () => {
  const wrongOwner = sample();
  wrongOwner.sources[0].registration.id = "other-registration";
  assert.throws(() => materializePublicIssueFromRows(wrongOwner));
  const noRight = sample();
  noRight.sources[0].registration.allow_public_derived = false;
  assert.throws(() => materializePublicIssueFromRows(noRight));
});

test("snapshot claim assertion and source publisher must match selected private rows", () => {
  const falseClaim = sample();
  falseClaim.publication.snapshot.claims[0].assertion = "Different synthetic assertion.";
  assert.throws(() => materializePublicIssueFromRows(falseClaim));
  const falsePublisher = sample();
  falsePublisher.publication.snapshot.claims[0].evidence[0].publisher = "Different publisher";
  assert.throws(() => materializePublicIssueFromRows(falsePublisher));
});

test("selected citation mismatch is rejected after mapping SQL-shaped rows", () => {
  const missing = sample();
  missing.citations.pop();
  assert.throws(() => materializePublicIssueFromRows(missing));
});

test("current source-title decision must agree with the displayed title", () => {
  const absent = sample();
  absent.sources[0].display_review = null;
  assert.throws(() => materializePublicIssueFromRows(absent));
  const changed = sample();
  changed.sources[0].display_review.display_title = "Different reviewed title";
  assert.throws(() => materializePublicIssueFromRows(changed));
  const withdrawn = sample();
  withdrawn.sources[0].display_review.decision = "withdrawn";
  assert.throws(() => materializePublicIssueFromRows(withdrawn));
});

function distinctCitationSample() {
  const input = sample();
  const evidence = input.publication.snapshot.claims[0].evidence[0];
  const source = input.sources.find((row) => row.version.id === evidence.sourceVersionId);
  const citation = input.citations.find((row) => row.claim_id === input.publication.snapshot.claims[0].id && row.source_version_id === evidence.sourceVersionId && row.locator === evidence.locator);
  const retrieval = source.version.source_url;
  evidence.url = "https://example.org/qualified-human-table";
  source.version.content_sha256 = "a".repeat(64);
  citation.machine_binding = {
    decisionId: "88888888-8888-4888-8888-888888888888",
    qualificationId: "77777777-7777-4777-8777-777777777777",
    disposition: "eligible", sourceVersionId: evidence.sourceVersionId,
    contentSha256: "a".repeat(64), semanticContractSha256: "b".repeat(64),
    qualificationSemanticContractSha256: "b".repeat(64),
    publicCitationUrl: evidence.url, qualificationPublicCitationUrl: evidence.url,
    qualifiedRetrievalUrl: retrieval, evidenceLocator: evidence.locator,
  };
  return { input, source, citation, evidence };
}

test("a distinct public citation needs an exact selected machine binding and preserves the retrieval endpoint", () => {
  const { input, source, citation, evidence } = distinctCitationSample();
  const retrieval = source.version.source_url;
  const projection = materializePublicIssueFromRows(input);
  assert.equal(projection.claims[0].evidence[0].url, evidence.url);
  assert.equal(source.version.source_url, retrieval);
  assert.ok(!JSON.stringify(projection).includes("machineBinding"));
  delete citation.machine_binding;
  assert.throws(() => materializePublicIssueFromRows(input));
});

test("public target, receipt hash, mapping, source identity and locator substitutions are rejected", () => {
  const mutations = [
    (x) => x.citation.machine_binding.qualificationPublicCitationUrl = "https://example.org/substituted",
    (x) => x.citation.machine_binding.qualifiedRetrievalUrl = "https://example.org/substituted",
    (x) => x.citation.machine_binding.contentSha256 = "c".repeat(64),
    (x) => delete x.source.version.content_sha256,
    (x) => x.citation.machine_binding.qualificationSemanticContractSha256 = "c".repeat(64),
    (x) => x.citation.machine_binding.sourceVersionId = "99999999-9999-4999-8999-999999999999",
    (x) => x.citation.machine_binding.evidenceLocator = "invented-location",
    (x) => x.citation.machine_binding.disposition = "held",
    (x) => x.citation.machine_binding.privateReviewReference = "private-canary",
  ];
  for (const mutate of mutations) {
    const sample = distinctCitationSample(); mutate(sample);
    assert.throws(() => materializePublicIssueFromRows(sample.input));
  }
});
