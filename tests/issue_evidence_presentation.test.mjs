import assert from "node:assert/strict";
import test from "node:test";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";

// The exact presenter, React SSR and a parsed invented display contract. Parsing
// this fixture grants no source/publication authority. No HTTP or Browser access.
const exports = loadTsx(new URL("../app/issue-evidence.tsx", import.meta.url));
const render = issue => renderToStaticMarkup(createElement(exports.IssueEvidence, { issue }));
function example() { return parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope)); }

test("actual evidence panel retains statement order and provides unambiguous anchor targets for all six types", () => {
  const issue = example(), base = issue.claims[0];
  const types = ["funding", "condition", "policy_action", "evaluation", "delivery", "attributed_finding"];
  issue.claims = types.map((type, index) => ({ ...base, type,
    id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
    assertion: `Invented statement ${index + 1}`, periodLabel: `Example period ${index + 1}` }));
  const html = render(issue), positions = [];
  const outline = html.match(/<nav class="evidence-outline"[\s\S]*?<\/nav>/)[0];
  const overview = html.match(/<section class="dossier-reading-overview"[\s\S]*?<\/section>/)[0];
  const limits = html.match(/<section class="publication-limits info-band"[\s\S]*?<\/section>/)[0];
  for (const claim of issue.claims) {
    // The original two paths remain; only recorded conflicts gain a limits link.
    const conflicts = Number(claim.evidence.some(source => source.relation === "contradicts"));
    assert.equal(html.split(`href="#claim-${claim.id}"`).length - 1, 2 + conflicts);
    assert.equal(limits.split(`href="#claim-${claim.id}"`).length - 1, conflicts);
    assert.equal(outline.split(`href="#claim-${claim.id}"`).length - 1, 1);
    assert.equal(overview.split(`href="#claim-${claim.id}"`).length - 1, 1);
    assert.equal(html.split(`id="claim-${claim.id}"`).length - 1, 1);
    positions.push(html.indexOf(`>${claim.assertion}</h3>`));
  }
  assert.ok(positions.every((position, index) => position > 0 && (!index || position > positions[index - 1])));
  for (const label of ["Observed condition", "Policy or action", "Funding", "Delivery", "Attributed finding", "Evaluation"])
    assert.ok(html.includes(label), label);
  assert.ok(html.includes('aria-label="Statements in this dossier"'));
  assert.ok(html.includes("6 statements in this dossier"));
});
test("actual evidence control exposes every locator by default and flags conflict outside the disclosure", () => {
  const issue = example(), html = render(issue);
  assert.ok(html.includes('<details class="claim-sources" open="">'));
  assert.ok(html.includes("3 exact source references for this statement"));
  assert.ok(html.indexOf("Conflicting evidence is included") < html.indexOf('<details class="claim-sources"'));
  for (const source of issue.claims[0].evidence) {
    assert.ok(html.includes(source.locator)); assert.ok(html.includes(source.url));
  }
  for (const relation of ["Supports this wording", "Points to a conflict", "Adds context"])
    assert.ok(html.includes(relation));
  // Invented addresses remain text; no external request or raw archive link.
  assert.ok(!html.includes('href="https:')); assert.ok(!html.includes("<iframe"));
});
test("support-only statements do not acquire a conflict warning; missing publication date stays missing", () => {
  const issue = example(); issue.claims[0].evidence = [issue.claims[0].evidence[0]];
  issue.claims[0].evidence[0].sourcePublishedOn = null;
  const html = render(issue);
  assert.ok(!html.includes("Conflicting evidence is included"));
  assert.ok(html.includes("1 exact source reference for this statement"));
  assert.ok(html.includes("Source published</dt><dd>No verified source publication date supplied</dd>"));
  assert.ok(!html.includes('dateTime="null"')); assert.ok(!html.includes("Source published</dt><dd><time"));
});
test("distinct stored dates and revision are retained without inventing correction history or an absence conclusion", () => {
  const issue = example(); issue.revision = 4;
  const html = render(issue);
  for (const date of [issue.lastEvidenceReviewOn, ...issue.claims[0].evidence.flatMap(source => [source.sourcePublishedOn, source.retrievedAt])])
    assert.ok(html.includes(`dateTime="${date}"`), date);
  assert.ok(html.includes("Data period:")); assert.ok(html.includes("Last evidence review"));
  assert.ok(html.includes("Publication revision 4")); assert.ok(!html.includes("Correction published"));
  assert.ok(html.includes("A missing type of statement is not evidence of inaction"));
  assert.ok(html.includes("It is not the time you opened this page"));
});
test("statement, period and provenance text are escaped together without private receipt fields", () => {
  const issue = example();
  issue.claims[0].assertion = "<img src=x onerror=private-canary>";
  issue.claims[0].periodLabel = "<script>period-canary</script>";
  issue.claims[0].evidence[0].locator = "<svg onload=locator-canary>";
  const html = render(issue);
  for (const token of ["&lt;img", "&lt;script&gt;period-canary", "&lt;svg"])
    assert.ok(html.includes(token));
  for (const token of ["<img", "<script", "<svg", "registrationState", "dependencyManifest", "publicationReview"])
    assert.ok(!html.includes(token), token);
});
