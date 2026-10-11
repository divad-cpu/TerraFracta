import assert from "node:assert/strict";
import test from "node:test";
import { currentIssueSelection, currentIssueVisit, currentIssueHref, searchCurrentIssue, currentIssueSearchMatches, currentIssueReferenceMatches } from "../src/current-issue-navigation.ts";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";

const issue = () => parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
test("closed issue selectors bind an optional publication identity and normalize bounded search", () => {
  const record = issue();
  assert.deepEqual(currentIssueSelection("sources", {}), { view: "sources", publicationId: null, query: "", statementType: "", relation: "" });
  assert.deepEqual(currentIssueSelection("search", { edition: record.publicationId, q: " Ｅｘａｍｐｌｅ " }),
    { view: "search", publicationId: record.publicationId, query: "Example", statementType: "", relation: "" });
});
test("malformed, duplicated and private selectors refuse rather than losing their intended binding", () => {
  for (const [view, query] of [["unknown", {}], ["issue", { q: "table" }], ["issue", { path: "/private" }],
    ["search", { edition: "" }], ["search", { edition: [issue().publicationId] }], ["search", { q: null }],
    ["search", { q: ["table"] }], ["search", { q: "table\0" }], ["search", { q: "x".repeat(81) }],
    ["search", { q: "\ufdfa".repeat(5) }], ["search", null], ["search", []], ["toString", {}]])
    assert.equal(currentIssueSelection(view, query), null);
});
test("source and search filters accept only closed statement types and reference roles", () => {
  for (const type of ["condition", "policy_action", "funding", "delivery", "attributed_finding", "evaluation", ""])
    for (const view of ["search", "sources"]) assert.equal(currentIssueSelection(view, { type }).statementType, type);
  for (const relation of ["supports", "contradicts", "context", ""])
    assert.equal(currentIssueSelection("sources", { q: " method note ", type: "condition", relation }).relation, relation);
  for (const selector of [{ type: "toString" }, { type: "constructor" }, { type: "private" }, { type: ["condition"] },
    { type: null }, { relation: "__proto__" }, { relation: null }, { relation: ["supports"] }])
    assert.equal(currentIssueSelection("sources", selector), null);
  assert.equal(currentIssueSelection("issue", { type: "" }), null);
  assert.equal(currentIssueSelection("search", { relation: "supports" }), null);
});
test("literal search explains matched fields, preserves statement order and never changes the checked projection", () => {
  const record = issue(), before = structuredClone(record);
  const matching = currentIssueSearchMatches(record, "ＥＸＡＭＰＬＥ year CELL a1", record.claims[0].type);
  assert.equal(matching[0].claim, record.claims[0]);
  assert.ok(matching[0].matchedFields.includes("Data period"));
  assert.ok(matching[0].matchedFields.includes("Exact location"));
  assert.deepEqual(currentIssueSearchMatches(record, "cell a1", "funding"), []);
  assert.deepEqual(currentIssueSearchMatches(record, "x".repeat(81)), []);
  assert.deepEqual(currentIssueSearchMatches(record, "cell\0"), []);
  assert.deepEqual(currentIssueSearchMatches(record, "")[0].matchedFields, []);
  assert.deepEqual(record, before);
});
test("reference filtering retains original numbers and complete dossier conflicts even when results exclude them", () => {
  const record = issue(), before = structuredClone(record);
  const all = currentIssueReferenceMatches(record, { query: "", statementType: "", relation: "" });
  assert.equal(all.total, 3); assert.equal(all.matchingStatements, 1);
  const context = currentIssueReferenceMatches(record, { query: "footnote", statementType: "condition", relation: "context" });
  assert.equal(context.references.length, 1); assert.equal(context.references[0].referenceNumber, 3);
  assert.ok(context.references[0].matchedFields.includes("Exact location"));
  const supports = currentIssueReferenceMatches(record, { query: "", statementType: "", relation: "supports" });
  assert.equal(supports.references.length, 1); assert.equal(supports.dossierConflictReferences, 1);
  assert.deepEqual(record, before);
  const split = currentIssueReferenceMatches(record, { query: "a1 method", statementType: "", relation: "" });
  assert.equal(split.references.length, 0, "terms from separate reference locations must not form a hit");
});
test("changed and unavailable visits contribute no old issue object", () => {
  const record = issue(), success = { status: 200, cacheControl: "no-store", issue: record };
  assert.equal(currentIssueVisit(success, record.publicationId).issue, record);
  assert.equal(currentIssueVisit(success, null).issue, record);
  assert.deepEqual(currentIssueVisit(success, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), { kind: "changed" });
  assert.deepEqual(currentIssueVisit({ status: 503, cacheControl: "no-store" }, record.publicationId), { kind: "unavailable" });
  assert.deepEqual(currentIssueVisit({ status: 404, cacheControl: "no-store" }, record.publicationId), { kind: "absent" });
});
test("navigation keeps the immutable publication identity and exact claim search covers period and provenance", () => {
  const record = issue();
  for (const view of ["issue", "sources", "search"])
    assert.equal(currentIssueHref(record, view), `/reader-preview/imaginary-place/sample-housing-measure/${view}?edition=${record.publicationId}`);
  assert.equal(currentIssueHref(record, "search", false), "/reader-preview/imaginary-place/sample-housing-measure/search");
  for (const query of ["", "fictional survey", "example year", "cell A1", "research group", "method note"])
    assert.deepEqual(searchCurrentIssue(record, query), record.claims, query);
  assert.deepEqual(searchCurrentIssue(record, "fictional missing-canary"), []);
  const results = searchCurrentIssue(record, ""); results.pop(); assert.equal(record.claims.length, 1);
});
