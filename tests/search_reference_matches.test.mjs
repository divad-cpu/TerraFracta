import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicIssueProjection } from "../src/public-issue-projection.ts";
import { currentIssueSearchMatches, currentIssueReferenceMatches, searchCurrentIssue } from "../src/current-issue-navigation.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";

const issue = (change = () => {}) => {
  const envelope = structuredClone(syntheticReadRows.envelope);
  change(envelope.publication.snapshot);
  envelope.publication.dependencyManifest.sourceVersionIds = [...new Set(envelope.publication.snapshot.claims.flatMap(claim => claim.evidence.map(source => source.sourceVersionId)))];
  return parsePublicIssueProjection(envelope);
};

test("a literal source search identifies its original exact occurrence and fields", () => {
  const record = issue(), before = structuredClone(record);
  const result = currentIssueSearchMatches(record, "cell A1");
  assert.equal(result.length, 1);
  assert.equal(result[0].claim, record.claims[0]);
  assert.deepEqual(result[0].matchedFields, ["Exact location"]);
  assert.equal(result[0].matchedReferences.length, 1);
  assert.equal(result[0].matchedReferences[0].source, record.claims[0].evidence[0]);
  assert.equal(result[0].matchedReferences[0].referenceNumber, 1);
  assert.equal(result[0].matchedReferences[0].anchor, `reference-${record.claims[0].id}-1`);
  assert.deepEqual(result[0].matchedReferences[0].matchedFields, ["Exact location"]);
  assert.deepEqual(record, before);
});

test("all words may match one statement across several references without becoming a full-reference match", () => {
  const record = issue();
  const result = currentIssueSearchMatches(record, "A1 method");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].matchedReferences.map(row => [row.referenceNumber, row.matchedFields]),
    [[1, ["Exact location"]], [2, ["Source title"]]]);
  assert.deepEqual(currentIssueReferenceMatches(record, { query: "A1 method", statementType: "", relation: "" }).references, []);
  assert.equal(searchCurrentIssue(record, "A1 method")[0], record.claims[0]);
});

test("statement, title and period matches do not invent matching reference fields", () => {
  const record = issue(s => { s.title = "dossieronly"; s.claims[0].assertion = "statementonly"; s.claims[0].periodLabel = "periodonly"; });
  for (const [query, field] of [["dossieronly", "Issue title"], ["statementonly", "Statement"], ["periodonly", "Data period"]]) {
    const result = currentIssueSearchMatches(record, query);
    assert.deepEqual(result[0].matchedFields, [field]);
    assert.deepEqual(result[0].matchedReferences, []);
  }
  const combined = currentIssueSearchMatches(record, "statementonly footnote");
  assert.deepEqual(combined[0].matchedReferences.map(row => row.referenceNumber), [3]);
});

test("reference numbering precedes statement type filtering and retains repeated occurrences", () => {
  const record = issue(s => {
    const first = s.claims[0];
    first.evidence.push(structuredClone(first.evidence[0]));
    s.claims.push({ ...structuredClone(first), id: "66666666-6666-4666-8666-666666666666", type: "funding" });
  });
  const result = currentIssueSearchMatches(record, "cell A1", "funding");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].matchedReferences.map(row => row.referenceNumber), [5, 8]);
  assert.deepEqual(result[0].matchedReferences.map(row => row.anchor),
    [`reference-${record.claims[1].id}-1`, `reference-${record.claims[1].id}-4`]);
  assert.equal(result[0].matchedReferences[0].source.sourceVersionId, result[0].matchedReferences[1].source.sourceVersionId);
});

test("search terms never combine across different statements or outside indexed metadata", () => {
  const record = issue(s => {
    s.title = "neutral"; s.claims[0].assertion = "firstword";
    s.claims.push({ ...structuredClone(s.claims[0]), id: "66666666-6666-4666-8666-666666666666", assertion: "secondword" });
  });
  for (const query of ["firstword secondword", "https://example.org/fictional-table", "2026-09-20", "2026-09-25T12:00:00Z"])
    assert.deepEqual(currentIssueSearchMatches(record, query), [], query);
});

test("bounded compatibility-normalized words retain role-neutral occurrence matching", () => {
  const record = issue();
  const result = currentIssueSearchMatches(record, " ＭＥＴＨＯＤ section ");
  assert.equal(result[0].matchedReferences.length, 1);
  assert.equal(result[0].matchedReferences[0].source.relation, "contradicts");
  assert.deepEqual(result[0].matchedReferences[0].matchedFields, ["Source title", "Exact location"]);
  assert.equal(currentIssueSearchMatches(record, "footnote")[0].matchedReferences[0].source.relation, "context");
  assert.equal(currentIssueSearchMatches(record, "cell")[0].matchedReferences[0].source.relation, "supports");
});

test("empty or invalid queries produce no per-reference claims and leave input unchanged", () => {
  const record = issue(), before = structuredClone(record);
  for (const query of ["", "   "]) {
    const result = currentIssueSearchMatches(record, query);
    assert.equal(result.length, record.claims.length);
    assert.deepEqual(result[0].matchedReferences, []);
  }
  for (const query of ["\0", "x".repeat(81), "\ufdfa".repeat(5), null, ["cell"]])
    assert.deepEqual(currentIssueSearchMatches(record, query), []);
  assert.deepEqual(record, before);
});

test("the existing maximum keeps all 360 occurrences distinct and in dossier order", () => {
  const record = issue(s => {
    const template = structuredClone(s.claims[0]);
    template.evidence = Array.from({ length: 12 }, () => structuredClone(template.evidence[0]));
    s.claims = Array.from({ length: 30 }, (_, n) => ({ ...structuredClone(template),
      id: `${(n + 1).toString(16).padStart(8, "0")}-6666-4666-8666-666666666666` }));
  });
  const before = structuredClone(record), rows = currentIssueSearchMatches(record, "cell").flatMap(match => match.matchedReferences);
  assert.equal(rows.length, 360);
  assert.deepEqual(rows.map(row => row.referenceNumber), Array.from({ length: 360 }, (_, n) => n + 1));
  assert.equal(new Set(rows.map(row => row.anchor)).size, 360);
  assert.equal(rows.at(-1).anchor, `reference-${record.claims[29].id}-12`);
  assert.deepEqual(record, before);
});
