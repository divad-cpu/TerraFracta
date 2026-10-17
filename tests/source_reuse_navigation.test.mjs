import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";
import { currentIssueSelection } from "../src/current-issue-navigation.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const Evidence = loadTsx(new URL("../app/issue-evidence.tsx", import.meta.url)).IssueEvidence;
const Navigation = loadTsx(new URL("../src/current-issue-navigation-view.tsx", import.meta.url)).CurrentIssueNavigationView;
const example = () => parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
const render = issue => renderToStaticMarkup(createElement(Evidence, { issue }));
const citations = html => [...html.matchAll(/<li id="reference-[^"]*"[\s\S]*?<\/li>/g)].map(match => match[0]);

test("repeated-version citations identify their exact existing group and link to one numbered reuse target", () => {
  const issue = example(), html = render(issue), cards = citations(html);
  assert.equal(cards.length, 3);
  assert.equal((html.match(/id="recorded-source-group-1"/g) ?? []).length, 1);
  assert.equal((html.match(/id="recorded-source-group-2"/g) ?? []).length, 1);
  const reused = cards.filter(card => card.includes('href="#recorded-source-group-1"'));
  assert.equal(reused.length, 2);
  for (const card of reused) {
    assert.ok(card.includes("Recorded source version 1: 2 exact references across 1 statement"));
    assert.ok(card.includes("Inspect all references to this recorded source version"));
    assert.ok(card.includes("Repeated use does not establish independent confirmation"));
  }
  const singleton = cards.find(card => !card.includes('href="#recorded-source-group-1"'));
  assert.ok(!singleton.includes("Repeated use") && !singleton.includes("Inspect all references"));
});

test("same origin does not merge versions and reuse across statements retains each contradictory locator and date", () => {
  const issue = example(), base = issue.claims[0], first = base.evidence[0];
  issue.claims = [
    { ...base, evidence: [first] },
    { ...base, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", assertion: "Another invented statement", evidence: [
      { ...first, title: "Literal <second> title", locator: "Other invented cell", relation: "contradicts", sourcePublishedOn: null, retrievedAt: "2026-10-02T00:00:00Z" },
      { ...first, sourceVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", relation: "supports", locator: "Same-origin revised cell" },
    ] },
  ];
  const before = structuredClone(issue), html = render(issue), cards = citations(html);
  const repeated = cards.filter(card => card.includes('href="#recorded-source-group-1"'));
  assert.equal(repeated.length, 2);
  assert.ok(repeated.every(card => card.includes("2 exact references across 2 statements")));
  assert.ok(repeated.some(card => card.includes("Literal &lt;second&gt; title") && card.includes("Other invented cell") && card.includes("2026-10-02T00:00:00Z") && card.includes("Points to a conflict")));
  assert.ok(cards.find(card => card.includes("Same-origin revised cell")).includes("Supports this wording"));
  assert.ok(!cards.find(card => card.includes("Same-origin revised cell")).includes("Repeated use"));
  assert.deepEqual(issue, before);
});

test("the maximum repeated-version dossier adds one shortcut per citation with no quadratic reference copies", () => {
  const issue = example(), base = issue.claims[0];
  issue.claims = Array.from({ length: 30 }, (_, claimNumber) => ({ ...base,
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(claimNumber + 1).padStart(12, "0")}`,
    evidence: Array.from({ length: 12 }, (_, referenceNumber) => ({ ...base.evidence[0], locator: `Cell ${claimNumber}:${referenceNumber}` })),
  }));
  const html = render(issue);
  assert.equal(citations(html).length, 360);
  assert.equal((html.match(/href="#recorded-source-group-1"/g) ?? []).length, 360);
  assert.equal((html.match(/id="recorded-source-group-1"/g) ?? []).length, 1);
  assert.equal((html.match(/href="#reference-/g) ?? []).length, 360);
  assert.ok(html.includes("360 exact references across 30 statements"));
});

test("the actual reader withholds all contextual reuse details on changed absent and unavailable visits", () => {
  const issue = example(), selection = currentIssueSelection("issue", { edition: issue.publicationId });
  for (const decision of [{ status: 404, cacheControl: "no-store" }, { status: 503, cacheControl: "no-store" },
    { status: 200, cacheControl: "no-store", issue: { ...issue, publicationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } }]) {
    const html = renderToStaticMarkup(createElement(Navigation, { decision, selection, latestHref: "/reader-preview/imaginary-place/sample-housing-measure/issue" }));
    assert.ok(!html.includes("recorded-source-group") && !html.includes("Repeated use"));
    assert.ok(!html.includes(issue.claims[0].assertion) && !html.includes(issue.claims[0].evidence[0].locator));
  }
});
