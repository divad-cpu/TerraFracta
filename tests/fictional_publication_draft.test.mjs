import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fictionalPublicationDraftSchema } from "../src/fictional-publication-draft.ts";
import { parseUpdateRunReport } from "../src/update-run-report.ts";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";

function report() {
  return JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
}

test("a source-derived fictional draft preserves the parsed value and cannot enter public reads", () => {
  const candidate = fictionalPublicationDraftSchema.parse(report().fictionalCandidate);
  assert.equal(candidate.observation.value, "27.4");
  assert.equal(candidate.publication.snapshot.claims[0].assertion, "In 2025, the fictional share was 27.4%.");
  const { previousPublicationId, ...publication } = candidate.publication;
  assert.throws(() => parsePublicIssueProjection({ currentPublicationId: publication.id, publication }));
});

test("altered value, wording, target, location and private fields fail the draft contract", () => {
  for (const mutate of [
    (candidate) => { candidate.observation.value = "28.0"; },
    (candidate) => { candidate.publication.snapshot.claims[0].assertion = "A political interpretation."; },
    (candidate) => { candidate.decision.publicCitationUrl = "https://example.org/other"; },
    (candidate) => { candidate.publication.snapshot.claims[0].evidence[0].locator = "invented"; },
    (candidate) => { candidate.publication.kind = "accepted"; },
    (candidate) => { candidate.publication.snapshot.privateNote = "private-canary"; },
  ]) {
    const candidate = report().fictionalCandidate;
    mutate(candidate);
    assert.equal(fictionalPublicationDraftSchema.safeParse(candidate).success, false);
  }
});

test("a page draft must remain bound to the checked item in the same report", () => {
  assert.equal(parseUpdateRunReport(report()).fictionalCandidate.publication.kind, "draft");
  for (const mutate of [
    (item) => { item.outcome = "held"; item.reasonCodes = ["material_conflict"]; },
    (item) => { item.source.contentSha256 = "d".repeat(64); },
    (item) => { item.source.publisher = "Other publisher"; },
  ]) {
    const input = report();
    mutate(input.items[0]);
    assert.throws(() => parseUpdateRunReport(input));
  }
});
