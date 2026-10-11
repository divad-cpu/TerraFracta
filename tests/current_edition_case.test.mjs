import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { currentIssueSelection, currentIssueVisit, currentIssueDirectoryHref, currentIssueInspectionHref, currentIssueReturnHref, currentCatalogueIssueHref } from "../src/current-issue-navigation.ts";
import { currentCatalogueSelection, currentCatalogueResult } from "../src/current-visitor-catalog.ts";
import { currentIssueFilterActions } from "../src/current-issue-filter-actions.ts";
import { currentReadingGuideReturn, canonicalReadingGuideReturn } from "../src/current-reading-guide.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { sample } from "./helpers/public_read_rows_fixture.mjs";

const lower = "abcdef01-2345-4abc-8def-0123456789ab", upper = lower.toUpperCase(), mixed = "AbCdEf01-2345-4aBc-8dEf-0123456789aB";
const editions = [lower, upper, mixed], other = "abcdef01-2345-4abc-8def-0123456789ac";
const route = { jurisdictionSlug: "norway", issueSlug: "housing-costs" };
const directory = { directoryView: "issues", directoryQ: "Norway housing", directoryCountry: "norway", directoryTopic: "housing" };
const query = href => Object.fromEntries(new URL(href, "https://example.invalid").searchParams);
const IssueView = loadTsx(new URL("../src/current-issue-navigation-view.tsx", import.meta.url)).CurrentIssueNavigationView;
const CatalogueView = loadTsx(new URL("../src/current-visitor-catalog-view.tsx", import.meta.url)).CurrentVisitorCatalogueView;
function rowsFor(id) {
  const rows = sample(), old = rows.publication.id;
  const replace = value => typeof value === "string" ? value === old ? id : value : Array.isArray(value) ? value.map(replace) :
    value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,replace(v)])) : value;
  const result = replace(rows);
  result.requestedRoute = route; result.country.public_slug = route.jurisdictionSlug; result.dossier.public_slug = route.issueSlug;
  result.publication.snapshot.jurisdictionSlug = route.jurisdictionSlug; result.publication.snapshot.issueSlug = route.issueSlug;
  return result;
}
async function checked(rows) {
  let calls = 0;
  const reader = createPublicIssueReader(async (requested, signal) => {
    calls++; assert.deepEqual(requested, route); assert.ok(signal instanceof AbortSignal);
    return new TextEncoder().encode(JSON.stringify(rows));
  }, () => 0, () => {});
  const decision = await reader(route); assert.equal(calls,1); return decision;
}
const decisions = await Promise.all(editions.map(async edition => { const result = await checked(rowsFor(edition));assert.equal(result.status,200);assert.equal(result.issue.publicationId,edition);return result; }));

test("each accepted UUID spelling identifies the same checked current dossier and directory", () => {
  for (const decision of decisions) for (const edition of editions) {
    const selected = currentIssueSelection("issue", { edition });
    const listing = currentCatalogueSelection({ view: "issues", edition });
    assert.equal(selected.publicationId, edition); assert.equal(listing.publicationId, edition);
    assert.equal(currentIssueVisit(decision, edition).issue, decision.issue);
    const result = currentCatalogueResult(decision, listing);
    assert.equal(result.kind, "available"); assert.equal(result.issue.publicationId, decision.issue.publicationId);
    const html = renderToStaticMarkup(createElement(IssueView, { decision, selection: selected, latestHref: "/reader-preview/norway/housing-costs/issue" }));
    const catalogue = renderToStaticMarkup(createElement(CatalogueView, { result }));
    assert.ok(html.includes(decision.issue.claims[0].assertion)); assert.ok(!html.includes("A newer publication is available"));
    assert.ok(catalogue.includes(decision.issue.title)); assert.ok(!catalogue.includes("The directory edition changed"));
  }
});
test("directory card inspection and explicit selected-directory return retain the checked output spelling and filters", () => {
  for (const decision of decisions) for (const edition of editions) {
    const issue = decision.issue, listing = currentCatalogueSelection({ view: "issues", edition, q: directory.directoryQ, country: "norway", topic: "housing" });
    const href = currentCatalogueIssueHref(issue, "sources", listing), selected = currentIssueSelection("sources", query(href));
    assert.equal(query(href).edition, issue.publicationId); assert.equal(query(href).directoryQ, directory.directoryQ);
    assert.deepEqual(query(currentIssueDirectoryHref(issue, selected)), { view: "issues", edition: issue.publicationId, q: directory.directoryQ, country: "norway", topic: "housing" });
    const differentlySpelled = currentIssueSelection("sources", { edition, ...directory });
    assert.deepEqual(query(currentIssueDirectoryHref(issue, differentlySpelled)), query(currentIssueDirectoryHref(issue, selected)));
  }
});
test("source inspection return and reading-guide return keep same-UUID filters across mixed spelling", () => {
  for (const decision of decisions) for (const edition of editions) {
    const issue = decision.issue, selected = currentIssueSelection("sources", { edition, q: "cell A1", type: "condition", relation: "supports", ...directory });
    const inspected = currentIssueInspectionHref(issue, selected), expected = { edition: issue.publicationId, ...directory, returnView: "sources", returnQ: "cell A1", returnType: "condition", returnRelation: "supports" };
    assert.deepEqual(query(inspected), expected);
    assert.equal(currentReadingGuideReturn(issue, selected), inspected); assert.equal(canonicalReadingGuideReturn(inspected), inspected);
    const admitted = currentIssueSelection("issue", { ...query(inspected), edition });
    assert.deepEqual(query(currentIssueReturnHref(issue, admitted)), { edition: issue.publicationId, ...directory, q: "cell A1", type: "condition", relation: "supports" });
  }
});
test("individual source-filter removals retain same-UUID directory context and other filters", () => {
  for (const decision of decisions) for (const edition of editions) {
    const selected = currentIssueSelection("sources", { edition, q: "cell A1", type: "condition", relation: "supports", ...directory });
    const actions = currentIssueFilterActions(decision.issue, selected); assert.equal(actions.length,3);
    for (const action of actions) {
      const next = query(action.href); assert.equal(next.edition, decision.issue.publicationId); assert.equal(next.directoryQ, directory.directoryQ);
      for (const [key,value] of [["q","cell A1"],["type","condition"],["relation","supports"]]) assert.equal(next[key], action.field === key ? undefined : value);
    }
  }
});
test("a genuine UUID difference still withholds issue catalogue filters and selected returns", () => {
  for (const decision of decisions) for (const edition of [other,other.toUpperCase()]) {
    const selected = currentIssueSelection("sources", { edition, q: "QUERY_CANARY", type: "condition", ...directory });
    assert.deepEqual(currentIssueVisit(decision,edition), { kind: "changed" });
    const result = currentCatalogueResult(decision,currentCatalogueSelection({ view: "issues",edition }));
    assert.equal(result.kind,"changed"); assert.equal(Object.hasOwn(result,"issue"),false);
    assert.equal(currentIssueDirectoryHref(decision.issue,selected),null); assert.deepEqual(currentIssueFilterActions(decision.issue,selected),[]);
    const returned = currentIssueSelection("issue", { edition, returnView: "sources", returnQ: "QUERY_CANARY", ...directory });
    assert.equal(currentIssueReturnHref(decision.issue,returned),null);
    const html = renderToStaticMarkup(createElement(IssueView,{ decision,selection:selected,latestHref:"/reader-preview/norway/housing-costs/sources" }));
    assert.ok(html.includes("A newer publication is available")); assert.ok(!html.includes("QUERY_CANARY")); assert.ok(!html.includes(decision.issue.claims[0].assertion));
  }
});
test("equal malformed identities are refused and non200 decisions take priority over spelling", () => {
  for (const bad of ["not-a-uuid"," abcdef01-2345-4abc-8def-0123456789ab",lower.replaceAll("-", ""),null,[],{}]) {
    assert.equal(currentIssueSelection("issue",{ edition:bad }),null); assert.equal(currentCatalogueSelection({ edition:bad }),null);
    if (bad !== null) assert.equal(currentIssueVisit({ ...decisions[0],issue:{ ...decisions[0].issue,publicationId:bad } },bad).kind,"changed");
  }
  for (const edition of editions) for (const [status,expected] of [[404,"absent"],[503,"unavailable"]]) {
    const decision = { status,cacheControl:"no-store" };
    assert.deepEqual(currentIssueVisit(decision,edition),{ kind:expected });
    assert.equal(currentCatalogueResult(decision,currentCatalogueSelection({ edition })).kind,expected);
  }
});
test("presentation casing cannot loosen exact stored head joins or bypass a new rights hold", async () => {
  const mismatched = rowsFor(lower); mismatched.head.current_publication_id = upper;
  const held = rowsFor(upper); held.sources[0].registration.allow_public_derived = false;
  for (const rows of [mismatched,held]) {
    const decision = await checked(rows); assert.equal(decision.status,503);
    assert.equal(currentIssueVisit(decision,mixed).kind,"unavailable");
    const result = currentCatalogueResult(decision,currentCatalogueSelection({ edition:mixed }));assert.equal(result.kind,"unavailable");
    const html = renderToStaticMarkup(createElement(IssueView,{ decision,selection:currentIssueSelection("sources",{ edition:mixed,q:"QUERY_CANARY",...directory }),latestHref:"/reader-preview/norway/housing-costs/sources" }));
    assert.ok(!html.includes("QUERY_CANARY"));assert.ok(!html.includes(decisions[0].issue.claims[0].assertion));
  }
});
