import assert from "node:assert/strict";
import test from "node:test";
import { recordedReferenceEntries, matchingRecordedReferences } from "../src/recorded-reference-finder.ts";
import { recordedProposalSourceIndex } from "../src/recorded-proposal-source-index.ts";
import { proposedPayload, proposalId } from "./helpers/proposal_fixture.mjs";

const snapshots = () => {
  const proposed = proposedPayload().snapshot, base = structuredClone(proposed);
  base.claims[0].evidence[0].title = "Recorded Cafe\u0301 inventory";
  proposed.claims[0].evidence[0].title = "Proposed ﬁle inventory";
  return { base, proposed };
};
const entries = (base, proposed) => recordedReferenceEntries(recordedProposalSourceIndex(base, proposed));
const keys = list => list?.map(entry => entry.anchor);
const anchor = (side, ref, id = proposalId(3)) => `proposal-${side}-reference-${id}-${ref}`;

test("minimal finder projection preserves each side's original positions without sending hidden metadata", () => {
  const { base, proposed } = snapshots();
  proposed.claims.push({ ...structuredClone(proposed.claims[0]), id: proposalId(20) });
  proposed.claims[0].evidence.push(structuredClone(proposed.claims[0].evidence[0]));
  const before = JSON.stringify({ base, proposed }), result = entries(base, proposed);
  assert.deepEqual(keys(result), [anchor("base", 1), anchor("base", 2), anchor("proposed", 1), anchor("proposed", 2), anchor("proposed", 3), anchor("proposed", 1, proposalId(20)), anchor("proposed", 2, proposalId(20))]);
  assert.deepEqual(Object.keys(result[0]).sort(), ["side", "statementNumber", "referenceNumber", "statementType", "periodLabel", "anchor", "sourceVersionId", "title", "locator", "relation"].sort());
  assert.equal(JSON.stringify({ base, proposed }), before);
  for (const value of result) for (const forbidden of ["url", "publisher", "retrievedAt", "sourcePublishedOn", "assertion", "contentSha256", "rawArchivePath"])
    assert.equal(Object.hasOwn(value, forbidden), false);
});

test("all words match one occurrence while native Unicode normalization preserves display bytes", () => {
  const { base, proposed } = snapshots(), rows = entries(base, proposed), before = structuredClone(rows);
  assert.deepEqual(keys(matchingRecordedReferences(rows, "recorded café")), [anchor("base", 1)]);
  assert.deepEqual(keys(matchingRecordedReferences(rows, "ＰＲＯＰＯＳＥＤ file")), [anchor("proposed", 1)]);
  assert.deepEqual(keys(matchingRecordedReferences(rows, "café file")), []);
  assert.deepEqual(keys(matchingRecordedReferences(rows, "cafe")), [], "no accent stripping");
  assert.deepEqual(rows, before);
});

test("panel type and role filters intersect without changing numbers or hiding the source collection", () => {
  const { base, proposed } = snapshots(); proposed.claims[0].type = "delivery";
  const rows = entries(base, proposed), before = structuredClone(rows);
  assert.deepEqual(keys(matchingRecordedReferences(rows, "", "proposed", "delivery", "contradicts")), [anchor("proposed", 2)]);
  assert.deepEqual(keys(matchingRecordedReferences(rows, "", "base", "delivery")), []);
  assert.deepEqual(keys(matchingRecordedReferences(rows, "reference 2 conflicting evidence")), [anchor("base", 2), anchor("proposed", 2)]);
  assert.deepEqual(keys(matchingRecordedReferences(rows, "points to a conflict")), [anchor("base", 2), anchor("proposed", 2)]);
  assert.deepEqual(rows, before);
});

test("source-version spelling and repeated identical references keep exact per-occurrence identity", () => {
  const { base, proposed } = snapshots();
  const id = "abcdef12-0000-4000-8000-000000000001";
  base.claims[0].evidence[0].sourceVersionId = id;
  proposed.claims[0].evidence[0].sourceVersionId = id.toUpperCase();
  proposed.claims[0].evidence.push(structuredClone(proposed.claims[0].evidence[0]));
  const rows = entries(base, proposed), matched = matchingRecordedReferences(rows, id.toUpperCase());
  assert.deepEqual(keys(matched), [anchor("base", 1), anchor("proposed", 1), anchor("proposed", 3)]);
  assert.deepEqual(matched.map(row => row.sourceVersionId), [id, id.toUpperCase(), id.toUpperCase()]);
});

test("a witnessed absent base produces only proposed entries and unknown query words cannot discover omitted fields", () => {
  const { proposed } = snapshots(), rows = entries(null, proposed);
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.side === "proposed"));
  assert.deepEqual(matchingRecordedReferences(rows, "", "base"), []);
  assert.deepEqual(matchingRecordedReferences(rows, "example.org"), []);
  assert.deepEqual(matchingRecordedReferences(rows, "publisher"), []);
  assert.deepEqual(matchingRecordedReferences(rows, "invented second publisher"), []);
});

test("invalid query and selections refuse before observing even the local collection", () => {
  const unobserved = new Proxy([], { get() { assert.fail("invalid selection observed records"); } });
  for (const query of [null, [], {}, "\0", "x".repeat(81), "\ufdfa".repeat(5)])
    assert.equal(matchingRecordedReferences(unobserved, query), null);
  for (const values of [["", "foreign"], ["", "", "toString"], ["", "", "", "constructor"], ["", null], ["", "", []]])
    assert.equal(matchingRecordedReferences(unobserved, ...values), null);
});

test("the existing maximum two-panel shape remains bounded and preserves all 720 distinct targets", () => {
  const { proposed } = snapshots();
  proposed.claims = Array.from({ length: 30 }, (_, index) => ({ ...structuredClone(proposed.claims[0]), id: proposalId(100 + index),
    evidence: Array.from({ length: 12 }, () => structuredClone(proposed.claims[0].evidence[0])) }));
  const rows = entries(structuredClone(proposed), proposed);
  assert.equal(rows.length, 720); assert.equal(new Set(keys(rows)).size, 720);
  assert.equal(matchingRecordedReferences(rows, "", "proposed").length, 360);
  assert.equal(matchingRecordedReferences(rows, "reference 12", "base").length, 41,
    "all words may match different labels: statement 12 also matches the text 12");
  assert.deepEqual(matchingRecordedReferences(rows, "missing material"), []);
});
