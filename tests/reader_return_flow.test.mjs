import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { currentIssueSelection, currentIssueHref } from "../src/current-issue-navigation.ts";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";
import { canonicalPublicIssueRoute, createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";

const View = loadTsx(new URL("../src/current-issue-navigation-view.tsx", import.meta.url)).CurrentIssueNavigationView;
function issue(change = () => {}) { const envelope = structuredClone(syntheticReadRows.envelope); change(envelope.publication.snapshot); return parsePublicIssueProjection(envelope); }
const render = (record, view, query = {}, decision = { status: 200, cacheControl: "no-store", issue: record }) =>
  renderToStaticMarkup(createElement(View, { decision, selection: currentIssueSelection(view, { edition: record.publicationId, ...query }), latestHref: currentIssueHref(record, view, false) }));
const links = html => [...html.matchAll(/<a\b[^>]*\shref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({ url: new URL(m[1].replaceAll("&amp;", "&"), "https://example.invalid"), text: m[2].replace(/<[^>]*>/g, "").replaceAll("&amp;", "&") }));
const selectedLink = (html, text) => { const link = links(html).find(row => row.text === text); assert.ok(link, text); return link.url; };
const query = url => Object.fromEntries(url.searchParams);
const backLink = html => { const link = links(html).find(row => row.text.startsWith("Back to selected ")); assert.ok(link, "Explicit selected-results return"); return link.url; };

test("a filtered reference links to the complete checked statement and returns to its same-edition selected references", () => {
  const record = issue(), initial = render(record, "sources", { q: "footnote", type: "condition", relation: "context" });
  const inspection = selectedLink(initial, "Read reference 3 in the statement");
  assert.equal(inspection.hash, "#reference-" + record.claims[0].id + "-3"); assert.equal(inspection.searchParams.get("returnView"), "sources");
  const full = render(record, "issue", query(inspection));
  for (const source of record.claims[0].evidence) assert.ok(full.includes(source.locator));
  assert.ok(full.includes("Conflicting evidence is included")); assert.ok(full.includes("checks the current publication again"));
  const back = backLink(full); assert.deepEqual(query(back), { edition: record.publicationId, q: "footnote", type: "condition", relation: "context" });
  assert.equal(back.pathname, "/reader-preview/imaginary-place/sample-housing-measure/sources");
  const restored = render(record, "sources", query(back)); assert.ok(restored.includes("Showing 1 of 3 references")); assert.ok(restored.includes("Reference 3"));
});

test("split-reference search inspection preserves complete conflict evidence and returns to the original statement query", () => {
  const record = issue(), initial = render(record, "search", { q: "A1 method", type: "condition" });
  const reference = selectedLink(initial, "Reference 1: " + record.claims[0].evidence[0].title);
  const statement = selectedLink(initial, record.claims[0].assertion);
  assert.deepEqual(query(reference), query(statement));
  const full = render(record, "issue", query(reference)), back = backLink(full);
  assert.deepEqual(query(back), { edition: record.publicationId, q: "A1 method", type: "condition" });
  const restored = render(record, "search", query(back));
  assert.ok(restored.includes("1 statement matches")); assert.ok(restored.includes("Reference 2:"));
  assert.ok(restored.includes("do not establish support or agreement")); assert.ok(full.includes("Conflicting evidence is included"));
});

test("unfiltered and no-hit conflict inspection retain their distinct selection and ordinary issue visits invent no return", () => {
  const record = issue();
  const all = selectedLink(render(record, "sources"), "Read reference 1 in the statement");
  assert.deepEqual(query(backLink(render(record, "issue", query(all)))), { edition: record.publicationId });
  const noHit = render(record, "sources", { q: "missing-canary", relation: "supports" });
  const conflict = selectedLink(noHit, "Read the complete statements and their evidence");
  const back = backLink(render(record, "issue", query(conflict)));
  assert.deepEqual(query(back), { edition: record.publicationId, q: "missing-canary", relation: "supports" });
  assert.ok(render(record, "sources", query(back)).includes("No reference matches these filters"));
  assert.ok(!render(record, "issue").includes("Back to selected "));
});

test("search wording containing URL and HTML characters stays one bounded encoded query and does not create foreign links", () => {
  const wording = "needle & returnView=sources?<script>#";
  const record = issue(s => { s.claims[0].assertion = wording; });
  const initial = render(record, "search", { q: wording }), inspection = links(initial).find(row => row.url.hash === "#claim-" + record.claims[0].id).url;
  assert.equal(inspection.searchParams.get("returnView"), "search"); assert.equal(inspection.searchParams.get("returnQ"), wording);
  const full = render(record, "issue", query(inspection)), back = backLink(full);
  assert.equal(back.searchParams.get("q"), wording); assert.ok(!full.includes("<script>"));
  for (const link of links(full)) assert.equal(link.url.origin, "https://example.invalid");
});

test("changed absent and unavailable visits withhold old return context together with all old evidence", () => {
  const record = issue(), next = structuredClone(record); next.publicationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const decision of [{ status: 200, cacheControl: "no-store", issue: next }, { status: 404, cacheControl: "no-store" }, { status: 503, cacheControl: "no-store" }]) {
    const html = render(record, "issue", { returnView: "sources", returnQ: "OLD_SELECTION_CANARY", returnType: "condition", returnRelation: "context" }, decision);
    assert.ok(!html.includes("Back to selected ")); assert.ok(!html.includes("OLD_SELECTION_CANARY")); assert.ok(!html.includes("returnView"));
    assert.ok(!html.includes(record.claims[0].assertion)); assert.ok(!html.includes("current-source-list"));
  }
});

test("the real async page snapshots presentation choices before a reader await and gives the provider only its current route", async () => {
  const record = sample(), calls = []; let reads = 0;
  const input = { edition: record.publication.id, returnView: "search", get returnQ() { reads++; return reads === 1 ? "old query" : "changed query"; } };
  const reader = createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(record)), () => 0, async () => false);
  const page = loadTsx(new URL("../app/reader-preview/[country]/[issue]/[view]/page.tsx", import.meta.url), name => name === "next/navigation" ? {
    notFound() { assert.fail("Valid selected return was refused"); },
  } : name.endsWith("public-issue-reader") ? { canonicalPublicIssueRoute, readPublicIssue: async route => {
    calls.push(route); input.returnView = "sources"; return reader(route);
  } } : undefined).default;
  const element = await page({ params: Promise.resolve({ country: record.requestedRoute.jurisdictionSlug, issue: record.requestedRoute.issueSlug, view: "issue" }), searchParams: Promise.resolve(input) });
  const html = renderToStaticMarkup(element), back = backLink(html);
  assert.equal(reads, 1); assert.deepEqual(calls, [record.requestedRoute]); assert.equal(back.searchParams.get("q"), "old query");
  assert.equal(back.pathname.endsWith("/search"), true);
});

test("a new real current-reader visit after return never restores an edition with changed head or withdrawn derived rights", async () => {
  const record = issue(), inspection = selectedLink(render(record, "sources", { q: "footnote" }), "Read reference 3 in the statement");
  const back = backLink(render(record, "issue", query(inspection)));
  for (const change of [rows => { rows.sources[0].registration.allow_public_derived = false; }, rows => { rows.head.current_publication_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; }]) {
    const rows = sample(); change(rows); let calls = 0;
    const reader = createPublicIssueReader(async () => { calls++; return new TextEncoder().encode(JSON.stringify(rows)); }, () => 0, async () => false);
    const decision = await reader(rows.requestedRoute); assert.equal(decision.status, 503); assert.equal(calls, 1);
    const html = render(record, "sources", query(back), decision);
    assert.ok(html.includes("Issue temporarily unavailable")); assert.ok(!html.includes("Back to selected ")); assert.ok(!html.includes("Reference 3"));
  }
});
