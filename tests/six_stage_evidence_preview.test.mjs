import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { sixStageEvidenceRows } from "../app/evidence-preview/six-stage-example.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";
import { pilotStages } from "../src/synthetic-pilot-stages.ts";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
import { checkPublicReadConsistency } from "../src/public-read-consistency.ts";

const pageUrl = new URL("../app/evidence-preview/page.tsx", import.meta.url);
test("the existing development evidence page visibly joins all six statement types with exact source locations", () => {
  const Page = loadTsx(pageUrl, name => name === "next/navigation" ? { notFound() { throw Error("NOT_FOUND"); } } : undefined).default;
  const html = renderToStaticMarkup(Page());
  for (const label of ["Observed condition", "Policy or action", "Funding", "Delivery", "Attributed finding", "Evaluation"])
    assert.ok(html.includes(label), label);
  assert.match(html, /6 statements in this dossier/);
});

test("the visible example reuses the native pilot's stage definitions without mutating its single-condition seed", () => {
  const seed = structuredClone(syntheticReadRows), rows = sixStageEvidenceRows(), native = sixStagePilotRows();
  const issue = checkPublicReadConsistency(rows);
  assert.notEqual(issue.publicationId, syntheticReadRows.envelope.publication.id);
  assert.deepEqual(issue.claims.map(claim => claim.type), ["condition", ...pilotStages.map(row => row[0])]);
  for (const [index, [, period, assertion, title, locator]] of pilotStages.entries()) {
    const claim = issue.claims[index + 1], other = native.publication.snapshot.claims[index + 1];
    assert.deepEqual([claim.type, claim.periodLabel, claim.assertion, claim.evidence[0].title, claim.evidence[0].locator],
      [other.type, period, assertion, title, locator]);
  }
  assert.deepEqual(syntheticReadRows, seed);
  rows.claims[1].assertionReview.displayAssertion = "Locally mutated invented wording";
  assert.equal(sixStageEvidenceRows().claims[1].assertionReview.displayAssertion, pilotStages[0][2]);
  assert.deepEqual(syntheticReadRows, seed);
});

test("every visible example reference keeps its target and its conflict context without an external action", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network request permitted"));
  const Page = loadTsx(pageUrl, name => name === "next/navigation" ? { notFound() { throw Error("NOT_FOUND"); } } : undefined).default;
  const html = renderToStaticMarkup(Page()), issue = checkPublicReadConsistency(sixStageEvidenceRows());
  assert.equal([...html.matchAll(/class="citation-card citation-card--/g)].length, 8);
  assert.match(html, /8 exact references · 7 recorded source versions/);
  assert.match(html, /Conflicting evidence is included/);
  assert.match(html, /Original language<\/dt><dd>Not supplied/);
  assert.match(html, /Affected population<\/dt><dd>Not supplied/);
  for (const claim of issue.claims) {
    assert.ok(html.includes(claim.assertion)); assert.ok(html.includes(claim.periodLabel));
    for (const reference of claim.evidence) assert.ok(html.includes(reference.locator));
  }
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.equal(ids.filter(value => value === id).length, 1);
  assert.doesNotMatch(html, /<form|<button|href="https:/);
  assert.match(html, /Entirely fictional/); assert.match(html, /not evidence of a causal sequence/);
});

test("the production gate precedes constructing any invented candidate or calling a provider", () => {
  let constructed = 0;
  for (const environment of ["production", "test"]) {
    const Page = loadTsx(pageUrl, name => name === "next/navigation" ? { notFound() { throw Error("NOT_FOUND"); } } :
      name === "./six-stage-example.ts" ? { sixStageEvidenceRows() { constructed++; throw Error("CANDIDATE_MUST_NOT_BE_READ"); } } : undefined,
      { env: { NODE_ENV: environment } }).default;
    assert.throws(() => Page(), /NOT_FOUND/);
  }
  assert.equal(constructed, 0);
});

test("invented missing source, review and citation values are still refused by the unchanged display gate", () => {
  for (const mutate of [rows => { rows.claims[3].assertionReview.displayAssertion = "Unreviewed invented wording"; },
    rows => { rows.citations.pop(); }, rows => { rows.sources.pop(); },
    rows => { rows.envelope.publication.dependencyManifest.sourceVersionIds.pop(); }]) {
    const rows = sixStageEvidenceRows(); mutate(rows);
    assert.throws(() => checkPublicReadConsistency(rows));
    const Page = loadTsx(pageUrl, name => name === "./six-stage-example.ts" ? { sixStageEvidenceRows: () => rows } : undefined).default;
    assert.throws(() => Page());
  }
});
