import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";
import { currentIssueSelection } from "../src/current-issue-navigation.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const Evidence = loadTsx(new URL("../app/issue-evidence.tsx", import.meta.url)).IssueEvidence;
const Navigation = loadTsx(new URL("../src/current-issue-navigation-view.tsx", import.meta.url)).CurrentIssueNavigationView;
const example = () => parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
const render = issue => renderToStaticMarkup(createElement(Evidence, { issue }));
const references = html => [...html.matchAll(/<dt>Recorded source version reference<\/dt><dd><code>([^<]+)<\/code><\/dd>/g)].map(match => match[1]);

test("the reuse index discloses each exact source-version spelling once in first-reference order", () => {
  const issue = example(), before = JSON.stringify(issue), html = render(issue);
  const ids = [...new Set(issue.claims.flatMap(claim => claim.evidence.map(source => source.sourceVersionId)))];
  assert.deepEqual(references(html), ids);
  for (const id of ids) assert.equal((html.match(new RegExp(`<code>${id}</code>`, "g")) ?? []).length, 1);
  assert.ok(html.includes("These references identify recorded source versions; they do not establish independent origin or current source availability."));
  assert.ok(html.includes("Repeated use does not establish independent confirmation."));
  assert.equal(JSON.stringify(issue), before);
  assert.ok(!html.includes('href="https:'));
});

test("same-origin revisions retain separate exact version references, metadata and their existing reuse targets", () => {
  const issue = example(), claim = issue.claims[0], first = claim.evidence[0];
  claim.evidence = [first, { ...first, sourceVersionId: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF", relation: "context", locator: "Revised invented cell" },
    { ...first, relation: "contradicts", locator: "Contradicting invented cell" }];
  const html = render(issue);
  assert.deepEqual(references(html), [first.sourceVersionId, "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF"]);
  assert.ok(html.includes("Revised invented cell") && html.includes("Contradicting invented cell"));
  assert.equal((html.match(/href="#recorded-source-group-1"/g) ?? []).length, 2);
  assert.equal((html.match(/href="#recorded-source-group-2"/g) ?? []).length, 0);
  assert.ok(html.includes("Adds context") && html.includes("Points to a conflict"));
});

test("a bounded 360-reference dossier exposes only its 120 exact version identities without duplicating citation cards", () => {
  const issue = example(), base = issue.claims[0];
  const ids = Array.from({ length: 120 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`);
  issue.claims = Array.from({ length: 30 }, (_, c) => ({ ...base,
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(c + 1).padStart(12, "0")}`,
    evidence: Array.from({ length: 12 }, (_, s) => ({ ...base.evidence[0], sourceVersionId: ids[(c * 12 + s) % 120], locator: `Invented cell ${c}:${s}` })),
  }));
  const html = render(issue);
  assert.deepEqual(references(html), ids);
  assert.equal((html.match(/class="citation-card citation-card--/g) ?? []).length, 360);
  assert.equal((html.match(/href="#recorded-source-group-/g) ?? []).length, 360);
  assert.equal((html.match(/id="recorded-source-group-/g) ?? []).length, 120);
});

test("changed or withheld actual read decisions disclose no source-version identity or earlier metadata", async () => {
  const issue = example(), selection = currentIssueSelection("issue", { edition: issue.publicationId });
  const decisions = [{ status: 404, cacheControl: "no-store" }, { status: 503, cacheControl: "no-store" },
    { status: 200, cacheControl: "no-store", issue: { ...issue, publicationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } }];
  for (const suspend of [false, true]) {
    const rows = sample();
    if (suspend) rows.sources[0].registration.registration_state = "suspended";
    else rows.sources[0].registration.allow_public_derived = false;
    const read = createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(rows)), () => 0, async () => false);
    const decision = await read(rows.requestedRoute); assert.equal(decision.status, 503); decisions.push(decision);
  }
  for (const decision of decisions) {
    const html = renderToStaticMarkup(createElement(Navigation, { decision, selection, latestHref: "/reader-preview/imaginary-place/sample-housing-measure/issue" }));
    assert.deepEqual(references(html), []);
    for (const source of issue.claims[0].evidence) assert.ok(!html.includes(source.sourceVersionId) && !html.includes(source.locator));
    assert.ok(!html.includes("recorded-source-group") && !html.includes(issue.claims[0].assertion));
  }
});
