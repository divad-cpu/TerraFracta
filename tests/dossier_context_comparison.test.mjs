import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { inventedDossierContextComparisonPair } from "../app/evidence-preview/dossier-context/comparison/example.ts";
import { compareDossierContextV2Candidates } from "../src/server/dossier-context-comparison.ts";
import { checkDossierContextV2Consistency } from "../src/server/dossier-context-v2.ts";
import { contextReviews } from "./helpers/dossier_context_v2_fixture.mjs";
const compare = ({ earlier, later }) => compareDossierContextV2Candidates(earlier, later);
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function refresh(value) { value.contextReviews = contextReviews(value.envelope.publication.snapshot, value.envelope.publication.id, value.envelope.publication.revision); }
function rebind(value, { publicationId = value.envelope.publication.id, revision = value.envelope.publication.revision,
  issueId = value.envelope.publication.issueId, issueSlug = value.envelope.publication.snapshot.issueSlug } = {}) {
  value.envelope.currentPublicationId = publicationId; Object.assign(value.envelope.publication, { id: publicationId, revision, issueId });
  value.envelope.publication.snapshot.issueSlug = issueSlug; Object.assign(value.dossier, { id: issueId, publicSlug: issueSlug });
  Object.assign(value.publicationReview, { publicationId, revision });
  for (const row of value.claims) { row.issueId = issueId; for (const review of [row.assertionReview, row.periodReview]) Object.assign(review, { publicationId, revision }); }
  for (const row of value.citations) Object.assign(row, { publicationId, issueId }); refresh(value);
}
const url = new URL("../app/evidence-preview/dossier-context/comparison/page.tsx", import.meta.url);
const page = (intercept = () => undefined, mode = "development") => loadTsx(url, name => name === "next/navigation" ? {
  notFound() { throw Error("NOT_FOUND"); },
} : intercept(name), { env: { NODE_ENV: mode } }).default;

test("comparison separates context wording unknowns exact references and changed cited basis without mutating either candidate", () => {
  const pair = inventedDossierContextComparisonPair(), before = structuredClone(pair); freeze(pair);
  const result = compare(pair), byKey = Object.fromEntries(result.scope.map(row => [row.key, row]));
  assert.equal(byKey.population.state, "changed"); assert.equal(byKey.population.wordingChanged, true);
  assert.equal(byKey.period.state, "withheld");
  assert.equal(byKey.period.referenceBasisChanged, false);
  assert.equal(byKey.selectionRationale.state, "changed"); assert.equal(byKey.selectionRationale.wordingChanged, false);
  assert.equal(byKey.selectionRationale.referencesChanged, false); assert.equal(byKey.selectionRationale.referenceBasisChanged, true);
  assert.equal(result.responsibilityChanged, true); assert.equal(result.responsibilityBasisChanged, true);
  assert.equal(result.baseDisplayChanged, true); assert.equal(result.consecutiveRevisions, true);
  assert.deepEqual(pair, before); assert.notEqual(result.earlierDisplaySha256, result.laterDisplaySha256);
  assert.match(result.earlierDisplaySha256, /^[0-9a-f]{64}$/);
});
test("identical display context in distinct increasing revisions is unchanged and digest still binds the edition", () => {
  const pair = inventedDossierContextComparisonPair();
  pair.later.envelope.publication.snapshot = structuredClone(pair.earlier.envelope.publication.snapshot);
  pair.later.citations = pair.earlier.citations.map(row => ({ ...row, publicationId: pair.later.envelope.publication.id })); refresh(pair.later);
  const result = compare(pair);
  assert.ok(result.scope.every(row => row.state === "unchanged"));
  assert.equal(result.responsibilityChanged, false); assert.equal(result.responsibilityBasisChanged, false); assert.equal(result.baseDisplayChanged, false);
  assert.notEqual(result.earlierDisplaySha256, result.laterDisplaySha256);
});
test("supplied and unknown transitions are distinct from unchanged unknowns", () => {
  const pair = inventedDossierContextComparisonPair(), earlier = pair.earlier.envelope.publication.snapshot;
  earlier.dossierContext.scope.population = null; earlier.dossierContext.scope.period = null;
  refresh(pair.earlier);
  const result = compare(pair);
  assert.equal(result.scope.find(row => row.key === "population").state, "supplied");
  assert.equal(result.scope.find(row => row.key === "period").state, "unchanged");
});
test("reference selection and context role changes stay visible even when wording and original source metadata match", () => {
  const pair = inventedDossierContextComparisonPair(), before = pair.earlier.envelope.publication.snapshot;
  const after = pair.later.envelope.publication.snapshot;
  after.dossierContext.scope.population = structuredClone(before.dossierContext.scope.population);
  after.dossierContext.scope.population.references.push({ claimId: after.claims[0].id, referenceNumber: 2, relation: "context" }); refresh(pair.later);
  const row = compare(pair).scope.find(row => row.key === "population");
  assert.equal(row.wordingChanged, false); assert.equal(row.referencesChanged, true); assert.equal(row.referenceBasisChanged, false);
});
test("reordering responsibility entries does not invent changed data in shared referenced statements or sources", () => {
  const pair = inventedDossierContextComparisonPair();
  pair.later.envelope.publication.snapshot = structuredClone(pair.earlier.envelope.publication.snapshot);
  pair.later.citations = pair.earlier.citations.map(row => ({ ...row, publicationId: pair.later.envelope.publication.id }));
  pair.later.envelope.publication.snapshot.dossierContext.responsibilities.reverse(); refresh(pair.later);
  const result = compare(pair); assert.equal(result.responsibilityChanged, true); assert.equal(result.responsibilityBasisChanged, false);
  assert.equal(result.baseDisplayChanged, false);
});
test("foreign issue route nonincreasing revision or reused publication identity cannot be presented as a successor", () => {
  for (const binding of [{ issueId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, { issueSlug: "other-issue" },
    { revision: 1 }, { publicationId: "cc000000-0000-4000-8000-000000000001" }]) {
    const pair = inventedDossierContextComparisonPair(); rebind(pair.later, binding);
    assert.ok(checkDossierContextV2Consistency(pair.later));
    assert.throws(() => compare(pair), /distinct increasing revisions of the same issue and route/);
  }
});
test("a revision gap is disclosed rather than fabricating intermediate changes or event chronology", () => {
  const pair = inventedDossierContextComparisonPair(); rebind(pair.later, { revision: 4 });
  assert.equal(compare(pair).consecutiveRevisions, false);
  const Page = page(name => name === "./example.ts" ? { inventedDossierContextComparisonPair: () => pair } : undefined);
  const html = renderToStaticMarkup(Page()); assert.match(html, /Intermediate revisions are not shown/);
  assert.match(html, /Neither numbering nor list order proves an event chronology/);
});
test("both complete base and exact context review gates precede comparison in each side", () => {
  for (const side of ["earlier", "later"]) for (const mutate of [v => { v.sources[0].allowPublicDerived = false; },
    v => { v.contextReviews.pop(); }, v => { v.contextReviews[0].decision = "withdrawn"; },
    v => { v.envelope.currentPublicationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; },
    v => { v.claims[0].assertionReview.displayAssertion += " unreviewed"; }]) {
    const pair = inventedDossierContextComparisonPair(); mutate(pair[side]); assert.throws(() => compare(pair));
  }
});
test("distinct-side targets preserve every reference and associated statement without duplicate fragments or external actions", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network is permitted"));
  const html = renderToStaticMarkup(page()()), ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) assert.equal(ids.filter(id => id === target).length, 1, target);
  for (const side of ["earlier", "later"]) {
    assert.equal(ids.filter(id => id.startsWith(`context-comparison-${side}-reference-`)).length, 8);
    assert.equal(ids.filter(id => id.startsWith(`context-comparison-${side}-claim-`)).length, 6);
  }
  assert.match(html, /Exact wording or its known\/unknown state changed/);
  assert.match(html, /even when context wording is identical/);
  assert.match(html, /not matched as the same institution, tenure or event/);
  assert.doesNotMatch(html, /<form|<button|href="https:|snapshotSha256|contextReviews|registrationState/);
});
test("comparison route refuses nondevelopment use before construction and qualification", () => {
  let constructed = 0, checked = 0;
  for (const environment of ["production", "test", "", "preview", null]) {
    const Page = page(name => name === "./example.ts" ? { inventedDossierContextComparisonPair() { constructed++; throw Error("NO_CONSTRUCT"); } } :
      name === "../../../../src/server/dossier-context-comparison.ts" ? { compareDossierContextV2Candidates() { checked++; throw Error("NO_CHECK"); } } : undefined, environment);
    assert.throws(() => Page(), /NOT_FOUND/);
  }
  assert.equal(constructed, 0); assert.equal(checked, 0);
});
