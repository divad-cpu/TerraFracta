import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { materializePublicIssueFromRows } from "../src/public-read-materializer.ts";
import { createPublicIssueReader, createDevelopmentPublicIssueHandler } from "../src/server/public-issue-reader.ts";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";

// Entirely invented private candidate rows. Matching review/rights fields cannot
// establish authentic source authority, database acceptance or publication.
function aliasedRows() {
  const rows = sixStagePilotRows(), claim = rows.publication.snapshot.claims[1];
  const original = claim.evidence[0], alias = original.sourceVersionId.toUpperCase();
  assert.notEqual(alias, original.sourceVersionId);
  const source = structuredClone(rows.sources.find(item => item.version.id === original.sourceVersionId));
  source.version.id = alias; source.display_review.source_version_id = alias;
  rows.sources.push(source);
  const evidence = { ...original, sourceVersionId: alias, locator: "Another invented passage of the same source version" };
  claim.evidence.push(evidence);
  rows.citations.push({ publication_id: rows.publication.id, issue_id: rows.dossier.id,
    claim_id: claim.id, source_version_id: alias, locator: evidence.locator, relation: evidence.relation });
  rows.publication.dependency_manifest.sourceVersionIds.push(alias);
  return rows;
}
function envelope(rows) {
  return { currentPublicationId: rows.head.current_publication_id,
    publication: { id: rows.publication.id, issueId: rows.dossier.id, revision: rows.publication.revision,
      kind: rows.publication.publication_kind, snapshot: rows.publication.snapshot,
      dependencyManifest: rows.publication.dependency_manifest } };
}
test("publication parsing refuses two manifest spellings of one source UUID even when citations mirror them", () => {
  assert.throws(() => parsePublicIssueProjection(envelope(aliasedRows())), /Duplicate source version/);
});
test("private-row materialization refuses invented matching source rows for a case-aliased manifest", () => {
  assert.throws(() => materializePublicIssueFromRows(aliasedRows()), /Duplicate source version/);
});
test("actual candidate reader withholds case-aliased source dependencies without asserting a technical failure", async () => {
  const rows = aliasedRows(), recorded = [], route = rows.requestedRoute;
  const reader = createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(rows)), () => 0,
    code => recorded.push(code));
  assert.deepEqual(await reader(route), { status: 503, cacheControl: "no-store" });
  assert.deepEqual(recorded, []);
});
test("native development handler exposes only the closed held body for the rejected manifest candidate", async () => {
  const rows = aliasedRows(), recorded = [];
  const reader = createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(rows)), () => 0,
    code => recorded.push(code));
  const handler = createDevelopmentPublicIssueHandler(reader, code => recorded.push(code));
  const response = await handler(new Request("http://127.0.0.1:3000/api/dev/public-issue/norway/housing-costs",
    { headers: { "sec-fetch-site": "same-origin" } }),
    { params: Promise.resolve({ country: "norway", issue: "housing-costs" }) }, "development");
  assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), { error: "read_unavailable" }); assert.deepEqual(recorded, []);
});
test("valid single uppercase spelling stays byte-exact while cited/manifest spelling disagreement remains held", () => {
  const rows = sixStagePilotRows(), env = envelope(rows), old = env.publication.snapshot.claims[1].evidence[0].sourceVersionId;
  const upper = old.toUpperCase();
  env.publication.snapshot.claims[1].evidence[0].sourceVersionId = upper;
  const position = env.publication.dependencyManifest.sourceVersionIds.indexOf(old);
  assert.ok(position >= 0); env.publication.dependencyManifest.sourceVersionIds[position] = upper;
  assert.equal(parsePublicIssueProjection(env).claims[1].evidence[0].sourceVersionId, upper);
  env.publication.dependencyManifest.sourceVersionIds[position] = old;
  assert.throws(() => parsePublicIssueProjection(env), /disagree/);
});
test("distinct source UUIDs and duplicate references keep existing admission and exact-duplicate refusal", () => {
  const rows = sixStagePilotRows(), env = envelope(rows);
  const claim = env.publication.snapshot.claims[1]; claim.evidence.push({ ...claim.evidence[0], locator: "Another passage" });
  assert.equal(parsePublicIssueProjection(env).claims[1].evidence.length, 2);
  env.publication.dependencyManifest.sourceVersionIds.push(claim.evidence[0].sourceVersionId);
  assert.throws(() => parsePublicIssueProjection(env), /Duplicate source version/);
});
