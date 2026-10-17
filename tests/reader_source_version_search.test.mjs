import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { currentIssueSelection, currentIssueReferenceMatches, currentIssueSearchMatches } from "../src/current-issue-navigation.ts";
const View = loadTsx(new URL("../src/current-issue-navigation-view.tsx", import.meta.url)).CurrentIssueNavigationView;
const read = rows => createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(rows)))(rows.requestedRoute);
const select = (query, statementType = "", relation = "") => ({ query, statementType, relation });
const render = (decision, view, query) => renderToStaticMarkup(View({ decision, selection: currentIssueSelection(view, query), latestHref: "/reader-preview/latest" }));

test("the displayed source version is searchable in references and statements with Unicode and UUID case normalization", async () => {
  const decision = await read(sample()); assert.equal(decision.status, 200);
  const issue = decision.issue, before = structuredClone(issue), id = issue.claims[0].evidence[0].sourceVersionId;
  for (const query of [id, id.toUpperCase(), [...id].map(char => char === "-" ? char : String.fromCharCode(char.charCodeAt(0) + 0xfee0)).join("")]) {
    const result = currentIssueReferenceMatches(issue, select(query));
    assert.ok(result.references.length > 0); assert.ok(result.references.every(row => row.source.sourceVersionId.toLowerCase() === id.toLowerCase()));
    assert.ok(result.references.every(row => row.matchedFields.includes("Recorded source version")));
    const statements = currentIssueSearchMatches(issue, query); assert.ok(statements.length > 0);
    assert.ok(statements.flatMap(row => row.matchedReferences).every(row => row.matchedFields.includes("Recorded source version")));
  }
  assert.deepEqual(issue, before);
});
test("repeated version references remain distinct and filtered results keep original reference ordinals and conflict totals", async () => {
  const { issue } = await read(sample()), clone = structuredClone(issue), original = clone.claims[0];
  const version = original.evidence[0].sourceVersionId;
  original.evidence[1].sourceVersionId = version.toUpperCase();
  original.evidence[2].sourceVersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  clone.claims.push({ ...structuredClone(original), id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", type: "delivery" });
  const full = currentIssueReferenceMatches(clone, select(version)); assert.deepEqual(full.references.map(row => row.referenceNumber), [1, 2, 4, 5]);
  assert.equal(new Set(full.references.map(row => row.anchor)).size, 4);
  const filtered = currentIssueReferenceMatches(clone, select(version, "delivery", "contradicts"));
  assert.deepEqual(filtered.references.map(row => row.referenceNumber), [5]); assert.equal(filtered.total, 6); assert.equal(filtered.dossierConflictReferences, 2);
});
test("version plus locator search keeps source matches within one occurrence while statement search retains its documented wider scope", async () => {
  const { issue } = await read(sample()), clone = structuredClone(issue);
  const a = clone.claims[0].evidence[0], b = clone.claims[0].evidence[1];
  a.locator = "FIRST_LOCATOR_ONLY"; b.locator = "SECOND_LOCATOR_ONLY";
  b.sourceVersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  clone.claims[0].evidence[2].sourceVersionId = b.sourceVersionId;
  const query = `${a.sourceVersionId} SECOND_LOCATOR_ONLY`;
  assert.equal(currentIssueReferenceMatches(clone, select(query)).references.length, 0);
  const wider = currentIssueSearchMatches(clone, query); assert.equal(wider.length, 1);
  assert.equal(wider[0].matchedReferences.length, 2);
});
test("actual reader views explain and mark version matches without adding a route parameter or implying qualification", async () => {
  const decision = await read(sample()), id = decision.issue.claims[0].evidence[0].sourceVersionId;
  for (const view of ["sources", "search"]) {
    const html = render(decision, view, { edition: decision.issue.publicationId, q: id });
    assert.match(html, /Matched in: Recorded source version|Search words in: Recorded source version/);
    assert.ok(html.includes(`<code><mark>${id}</mark></code>`));
    assert.ok(html.includes(`returnQ=${id}`)); assert.match(html, /recorded source version reference/i);
    assert.doesNotMatch(html, /href="https:|name="sourceVersion"|name="source_id"/);
    assert.match(html, /does not establish|do not establish/);
  }
});
test("changed and rights-withheld editions cannot expose version search results", async () => {
  const rows = sample(), edition = rows.publication.id, id = rows.publication.snapshot.claims[0].evidence[0].sourceVersionId;
  const held = structuredClone(rows); held.sources[0].registration.allow_public_derived = false;
  const changed = JSON.parse(JSON.stringify(rows).replaceAll(edition, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
  for (const candidate of [held, changed]) for (const view of ["sources", "search"]) {
    const html = render(await read(candidate), view, { edition, q: id });
    assert.doesNotMatch(html, /current-source-list|current-search-results|<mark>|name="q"/); assert.ok(!html.includes(id));
  }
});
test("the 30-statement 360-reference display bound preserves every original occurrence for a shared version", async () => {
  const { issue } = await read(sample()), clone = structuredClone(issue), model = clone.claims[0], source = model.evidence[0];
  clone.claims = Array.from({ length: 30 }, (_, i) => ({ ...model, id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`, evidence: Array.from({ length: 12 }, () => ({ ...source })) }));
  const found = currentIssueReferenceMatches(clone, select(source.sourceVersionId));
  assert.equal(found.references.length, 360); assert.equal(found.total, 360); assert.equal(found.matchingStatements, 30);
  assert.deepEqual(found.references.map(row => row.referenceNumber), Array.from({ length: 360 }, (_, i) => i + 1));
  assert.equal(new Set(found.references.map(row => row.anchor)).size, 360);
});
