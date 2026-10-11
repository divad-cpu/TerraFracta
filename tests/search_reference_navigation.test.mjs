import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { currentIssueHref, currentIssueSelection } from "../src/current-issue-navigation.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";

const View = loadTsx(new URL("../src/current-issue-navigation-view.tsx", import.meta.url)).CurrentIssueNavigationView;
const issue = (change = () => {}) => {
  const envelope = structuredClone(syntheticReadRows.envelope);
  change(envelope.publication.snapshot);
  return parsePublicIssueProjection(envelope);
};
const render = (record, query = {}, decision = { status: 200, cacheControl: "no-store", issue: record }, view = "search") =>
  renderToStaticMarkup(createElement(View, { decision, selection: currentIssueSelection(view, { edition: record.publicationId, ...query }),
    latestHref: currentIssueHref(record, view, false) }));
const links = html => [...html.matchAll(/href="([^"]+)"[^>]*>Reference (\d+): /g)]
  .map(match => ({ href: match[1].replaceAll("&amp;", "&"), number: Number(match[2]) }));

test("actual search links each matching occurrence to one citation in the same edition", () => {
  const record = issue(), html = render(record, { q: "footnote", type: "condition" }), found = links(html);
  assert.equal(found.length, 1); assert.equal(found[0].number, 3);
  const url = new URL(found[0].href, "https://example.invalid");
  assert.equal(url.pathname, `/reader-preview/${record.jurisdictionSlug}/${record.issueSlug}/issue`);
  assert.deepEqual(Object.fromEntries(url.searchParams), { edition: record.publicationId, returnView: "search", returnQ: "footnote", returnType: "condition" });
  assert.equal(url.hash, `#reference-${record.claims[0].id}-3`);
  assert.equal(render(record, {}, undefined, "issue").split(`id="${url.hash.slice(1)}"`).length - 1, 1);
  assert.ok(html.includes("Adds context · Search words in: Exact location"));
  assert.ok(!html.includes('href="https:'));
});

test("split-reference matches explain any-word provenance and retain the complete conflict warning", () => {
  const html = render(issue(), { q: "A1 method" });
  assert.deepEqual(links(html).map(row => row.number), [1, 2]);
  for (const text of ["Words may occur across different references", "one or more search words", "do not establish support or agreement",
    "Supports this wording · Search words in: Exact location", "Points to a conflict · Search words in: Source title",
    "statement includes conflicting evidence", 'aria-describedby="current-search-help"', 'id="current-search-help"'])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes("Reference 3:"));
});

test("filtered duplicate search occurrences keep original numbers and separate DOM targets", () => {
  const record = issue(s => {
    s.claims[0].evidence.push(structuredClone(s.claims[0].evidence[0]));
    s.claims.push({ ...structuredClone(s.claims[0]), id: "66666666-6666-4666-8666-666666666666", type: "funding" });
  });
  const found = links(render(record, { q: "cell A1", type: "funding" }));
  assert.deepEqual(found.map(row => row.number), [5, 8]);
  assert.equal(new Set(found.map(row => row.href)).size, 2);
  const dossier = render(record, {}, undefined, "issue");
  for (const row of found) assert.equal(dossier.split(`id="${new URL(row.href, "https://example.invalid").hash.slice(1)}"`).length - 1, 1);
});

test("empty and statement-only searches make no source-match links or absence inference", () => {
  const record = issue(s => { s.claims[0].assertion = "statementonly"; });
  for (const query of [{}, { q: "statementonly" }]) {
    const html = render(record, query); assert.equal(links(html).length, 0);
    assert.ok(html.includes("1 statement matches")); assert.ok(html.includes(`#claim-${record.claims[0].id}`));
  }
  const empty = render(record, { q: "inventedmissingword" });
  assert.equal(links(empty).length, 0);
  assert.ok(empty.includes("No matching statement in this dossier"));
  assert.ok(empty.includes("does not establish that an action or evidence is absent elsewhere"));
});

test("search titles and query are escaped while matching-field labels remain authored", () => {
  const record = issue(s => { s.claims[0].evidence[0].title = '<svg onload="private-canary">'; });
  const html = render(record, { q: "<svg" });
  assert.equal(links(html).length, 1);
  assert.ok(html.includes("&lt;svg")); assert.ok(!html.includes("<svg"));
  assert.ok(html.includes("Search words in: Source title"));
  assert.ok(!html.includes('href="https:')); assert.ok(!html.includes("registration_id"));
});

test("changed, absent and unavailable reads withhold old search-reference links together", () => {
  const record = issue(), next = structuredClone(record); next.publicationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const decision of [{ status: 200, cacheControl: "no-store", issue: next },
    { status: 404, cacheControl: "no-store" }, { status: 503, cacheControl: "no-store" }]) {
    const html = render(record, { q: "cell A1" }, decision);
    assert.equal(links(html).length, 0); assert.ok(!html.includes("#reference-"));
    assert.ok(!html.includes(record.claims[0].assertion)); assert.ok(!html.includes('id="current-search-help"'));
  }
});

test("the actual materializer's withdrawn or suspended source cannot supply search-reference details", async () => {
  for (const change of [rows => { rows.sources[0].registration.allow_public_derived = false; },
    rows => { rows.sources[0].registration.registration_state = "suspended"; }]) {
    const rows = sample(); change(rows);
    const decision = await createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(rows)))(rows.requestedRoute);
    assert.equal(decision.status, 503);
    const html = render(issue(), { q: "cell A1" }, decision);
    assert.equal(links(html).length, 0); assert.ok(!html.includes("Reference 1:"));
    assert.ok(html.includes("Issue temporarily unavailable"));
  }
});
