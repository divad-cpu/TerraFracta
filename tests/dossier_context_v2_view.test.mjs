import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { inventedDossierContextV2Candidate } from "../app/evidence-preview/dossier-context/example.ts";
import { checkDossierContextV2Consistency } from "../src/server/dossier-context-v2.ts";
import { contextReviews } from "./helpers/dossier_context_v2_fixture.mjs";
const url = new URL("../app/evidence-preview/dossier-context/page.tsx", import.meta.url);
const load = (intercept = () => undefined, environment = "development") => loadTsx(url, name =>
  name === "next/navigation" ? { notFound() { throw Error("NOT_FOUND"); } } : intercept(name),
  { env: { NODE_ENV: environment } }).default;
const View = loadTsx(new URL("../app/issue-evidence.tsx", import.meta.url)).IssueEvidence;
const render = issue => renderToStaticMarkup(View({ issue }));

test("the fictional v2 exercise joins all stages with reviewed context and explicitly unknown government level", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network is permitted"));
  const html = renderToStaticMarkup(load()());
  for (const wording of ["Fictional dossier-context contract exercise", "Entirely invented", "no v2 writer or provider is installed",
    "Affected population", "Dossier period", "Why this issue was selected", "Responsibility context", "Documented role",
    "year precision only", "Unknown — no reviewed wording supplied.", "not inferred from the source publisher"])
    assert.ok(html.includes(wording), wording);
  for (const type of ["Observed condition", "Policy or action", "Funding", "Delivery", "Attributed finding", "Evaluation"])
    assert.ok(html.includes(type));
  assert.equal([...html.matchAll(/class="citation-card citation-card--/g)].length, 8);
  assert.match(html, /href="\/evidence-preview"/);
  assert.doesNotMatch(html, /<form|<button|href="https:|snapshotSha256|contextReviews|publicationReview|captureId/);
});
test("every context reference keeps its exact original target and distinct context versus statement roles", () => {
  const html = renderToStaticMarkup(load()()), ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) assert.equal(ids.filter(id => id === target).length, 1, target);
  assert.match(html, /Role for this context wording: Supports this wording\. Recorded role for the original statement: Points to a conflict\./);
  assert.match(html, /Repeated references do not establish independent confirmation/);
  assert.match(html, /not chronology or importance/);
  const candidate = inventedDossierContextV2Candidate(), issue = checkDossierContextV2Consistency(candidate);
  assert.equal(issue.dossierContext.responsibilities.length, 2);
  assert.deepEqual(issue.claims.map(claim => claim.id), candidate.envelope.publication.snapshot.claims.map(claim => claim.id));
});
test("unknown and empty context remain unknown without guessing an authority period or absence of action", () => {
  const candidate = inventedDossierContextV2Candidate();
  candidate.envelope.publication.snapshot.dossierContext = { scope: { population: null, period: null, selectionRationale: null }, responsibilities: [] };
  candidate.contextReviews = [];
  const html = render(checkDossierContextV2Consistency(candidate));
  assert.equal(html.split("Unknown — no reviewed wording supplied.").length - 1, 3);
  assert.match(html, /No reviewed responsibility entries are supplied\. This does not establish that no authority is responsible\./);
  assert.match(html, /Fields labelled unknown remain unknown/);
});
test("context wording uses ordinary escaping and a missing occurrence is held before a complete display is returned", () => {
  const candidate = inventedDossierContextV2Candidate(), snapshot = candidate.envelope.publication.snapshot;
  snapshot.dossierContext.scope.population.wording = "<script>CONTEXT_CANARY</script>";
  candidate.contextReviews = contextReviews(snapshot, candidate.envelope.publication.id, candidate.envelope.publication.revision);
  const issue = checkDossierContextV2Consistency(candidate), html = render(issue);
  assert.match(html, /&lt;script&gt;CONTEXT_CANARY&lt;\/script&gt;/); assert.doesNotMatch(html, /<script|<iframe/);
  issue.dossierContext.scope.population.references[0].referenceNumber = 12;
  assert.throws(() => render(issue), /Dossier context reference unavailable/);
});
test("production and test modes stop before fixture construction or qualification", () => {
  let constructed = 0, qualified = 0;
  for (const environment of ["production", "test"]) {
    const Page = load(name => name === "./example.ts" ? { inventedDossierContextV2Candidate() { constructed++; throw Error("NO_CONSTRUCT"); } } :
      name === "../../../src/server/dossier-context-v2.ts" ? { checkDossierContextV2Consistency() { qualified++; throw Error("NO_QUALIFY"); } } : undefined, environment);
    assert.throws(() => Page(), /NOT_FOUND/);
  }
  assert.equal(constructed, 0); assert.equal(qualified, 0);
});
test("development presentation cannot rescue withdrawn rights stale heads or a changed review binding", () => {
  for (const mutate of [value => { value.sources[0].allowPublicDerived = false; },
    value => { value.envelope.currentPublicationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; },
    value => { value.contextReviews[0].snapshotSha256 = "0".repeat(64); },
    value => { value.envelope.publication.snapshot.dossierContext.scope.period.wording += " changed"; }]) {
    const value = inventedDossierContextV2Candidate(); mutate(value);
    const Page = load(name => name === "./example.ts" ? { inventedDossierContextV2Candidate: () => value } : undefined);
    assert.throws(() => Page());
  }
});
