import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { currentIssueSelection } from "../src/current-issue-navigation.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { sample } from "./helpers/public_read_rows_fixture.mjs";

const View = loadTsx(new URL("../src/current-issue-navigation-view.tsx", import.meta.url)).CurrentIssueNavigationView;
const rows = sample();
rows.requestedRoute = { jurisdictionSlug: "norway", issueSlug: "housing-costs" };
rows.country.public_slug = "norway";
rows.dossier.public_slug = "housing-costs";
rows.publication.snapshot.jurisdictionSlug = "norway";
rows.publication.snapshot.issueSlug = "housing-costs";
let calls = 0;
let supplied = rows;
const reader = createPublicIssueReader(async route => { calls++; assert.deepEqual(route, rows.requestedRoute); return new TextEncoder().encode(JSON.stringify(supplied)); }, () => performance.now(), () => {});
const first = await reader(rows.requestedRoute);
assert.equal(first.status, 200);
const edition = first.issue.publicationId;
const decode = s => s.replaceAll("&amp;", "&").replaceAll("&#x27;", "'").replaceAll("&quot;", '"');
function link(html, label) {
  const found = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].find(m => decode(m[2]) === label);
  assert.ok(found, `Missing native link: ${label}`);
  return new URL(decode(found[1]), "https://example.invalid");
}
const query = url => Object.fromEntries(url.searchParams);
const directory = { directoryView: "issues", directoryQ: "Norway housing", directoryCountry: "norway", directoryTopic: "housing" };
const render = (view, q, decision = first) => renderToStaticMarkup(createElement(View, { decision, selection: currentIssueSelection(view, q), latestHref: `/reader-preview/norway/housing-costs/${view}` }));

test("a matching search has a native clear action and individually removable query and type", () => {
  const html = render("search", { edition, q: "cell A1", type: "condition", ...directory });
  assert.ok(html.includes("1 statement matches"));
  assert.ok(html.includes('aria-label="Active dossier filters"'));
  assert.deepEqual(query(link(html, "Clear this search")), { edition, ...directory });
  assert.deepEqual(query(link(html, "Remove search words")), { edition, ...directory, type: "condition" });
  assert.deepEqual(query(link(html, "Remove statement type")), { edition, ...directory, q: "cell A1" });
});
test("source filter removal preserves the other selectors and exact reference numbers through a fresh read", async () => {
  const html = render("sources", { edition, q: "cell A1", type: "condition", relation: "supports", ...directory });
  assert.ok(html.includes("Showing 1 of 3 references"));
  const next = query(link(html, "Remove reference role"));
  assert.deepEqual(next, { edition, ...directory, q: "cell A1", type: "condition" });
  const before = calls;
  const decision = await reader(rows.requestedRoute);
  assert.equal(calls, before + 1);
  const reopened = render("sources", next, decision);
  assert.ok(reopened.includes("Reference 1"));
  assert.ok(reopened.includes("complete dossier includes conflicting evidence"));
  assert.deepEqual(query(link(reopened, "Back to selected directory results")), { view: "issues", edition, q: "Norway housing", country: "norway", topic: "housing" });
});
test("zero results can remove one selector without losing other filters and default views add no active-filter panel", () => {
  const html = render("sources", { edition, q: "NO_MATCH", type: "condition", relation: "context" });
  assert.ok(html.includes("No reference matches these filters"));
  assert.deepEqual(query(link(html, "Remove search words")), { edition, type: "condition", relation: "context" });
  assert.ok(html.includes("does not establish that evidence is absent elsewhere"));
  for (const view of ["issue", "search", "sources"]) assert.ok(!render(view, { edition }).includes('aria-label="Active dossier filters"'));
});
test("a new rights hold after filter navigation withholds all old results selectors and remove links", async () => {
  const initial = { edition, q: "cell A1", type: "condition", relation: "supports", ...directory };
  const next = query(link(render("sources", initial), "Remove search words"));
  supplied = structuredClone(rows);
  supplied.sources[0].registration.allow_public_derived = false;
  const held = await reader(rows.requestedRoute);
  assert.equal(held.status, 503);
  const html = render("sources", next, held);
  assert.ok(!html.includes('aria-label="Active dossier filters"'));
  assert.ok(!html.includes("Remove reference role"));
  assert.ok(!html.includes(first.issue.claims[0].assertion));
  assert.ok(!html.includes("Norway housing"));
  supplied = rows;
});
test("changed absent and unavailable current decisions never expose a prior query through the new controls", () => {
  const initial = { edition, q: "PRIVATE_QUERY_CANARY", type: "condition", ...directory };
  for (const decision of [{ ...first, issue: { ...first.issue, publicationId: "aa000000-0000-4000-8000-000000000099" } }, { status: 404, cacheControl: "no-store" }, { status: 503, cacheControl: "no-store" }]) {
    const html = render("search", initial, decision);
    assert.ok(!html.includes("PRIVATE_QUERY_CANARY"));
    assert.ok(!html.includes("Remove statement type"));
    assert.ok(!html.includes(first.issue.claims[0].assertion));
  }
});
