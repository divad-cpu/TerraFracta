import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { compareFictionalObservations, exportFictionalComparison } from "../src/fictional-observation-comparison.ts";

const before = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url))).fictionalCandidate;
const after = JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json", import.meta.url))).fictionalCandidate;
const Comparison = loadTsx(new URL("../app/update-preview/comparison.tsx", import.meta.url)).FictionalComparison;
const render = (baseline = before, candidate = after) => renderToStaticMarkup(createElement(Comparison, { baseline, candidate }));
function pairSameValue() { const same = structuredClone(after); same.observation.value = before.observation.value;
  same.publication.snapshot.claims[0].assertion = before.publication.snapshot.claims[0].assertion; return same; }
function sourceFields(comparison, left, right) {
  for (const [side, draft] of [["before", left], ["after", right]]) {
    assert.equal(comparison[`${side}SourceVersionId`], draft.decision.sourceVersionId);
    assert.equal(comparison[`${side}ContentSha256`], draft.decision.contentSha256);
  }
}
test("comparison projects exact separately checked version and fingerprint values for each side", () => {
  const compared = compareFictionalObservations(before, after); assert.equal(compared.kind, "changed"); sourceFields(compared, before, after);
  assert.equal(compared.beforeUrl, compared.afterUrl); assert.notEqual(compared.beforeSourceVersionId, compared.afterSourceVersionId);
});
test("actual same-address comparison displays each provenance pair in its own source panel", () => {
  const markup = render(), articles = [...markup.matchAll(/<article>([\s\S]*?)<\/article>/g)].map(match => match[1]); assert.equal(articles.length, 2);
  for (const [index, draft] of [before, after].entries()) {
    assert.match(articles[index], /Recorded source version/); assert.match(articles[index], /Source version reference/); assert.match(articles[index], /Content fingerprint/);
    assert.ok(articles[index].includes(draft.decision.sourceVersionId)); assert.ok(articles[index].includes(draft.decision.contentSha256));
    assert.ok(!articles[index].includes([after, before][index].decision.sourceVersionId));
  }
  assert.match(markup, /do not establish independent sources, live access or publication rights/);
  assert.match(markup, /\+0\.7 percentage points/);
});
test("an unchanged equal-version observation makes no claim that its source value was revised", () => {
  const compared = compareFictionalObservations(before, before); assert.equal(compared.kind, "unchanged"); sourceFields(compared, before, before);
  const markup = render(before, before); assert.match(markup, /Same period · unchanged observation/); assert.match(markup, /checked value is the same in both drafts/);
  assert.doesNotMatch(markup, /Same period · revised observation|The source revised a value/);
});
test("a later different-version same-value record preserves both identities without inventing a value change", () => {
  const same = pairSameValue(), compared = compareFictionalObservations(before, same); assert.equal(compared.kind, "unchanged"); sourceFields(compared, before, same);
  const markup = render(before, same); assert.ok(markup.includes(before.decision.sourceVersionId)); assert.ok(markup.includes(same.decision.sourceVersionId));
  assert.match(markup, /0\.0 percentage points/); assert.match(markup, /Same period · unchanged observation/); assert.doesNotMatch(markup, /The source revised a value/);
});
test("held, private, mismatched and out-of-order inputs disclose no projected provenance", () => {
  const cases = [null, { ...after, privatePath: "PRIVATE_PROVENANCE_CANARY" }, structuredClone(after), structuredClone(after), structuredClone(after)];
  cases[2].decision.contentSha256 = before.decision.contentSha256;
  cases[3].publication.snapshot.claims[0].evidence[0].retrievedAt = before.publication.snapshot.claims[0].evidence[0].retrievedAt;
  cases[4].decision.locator = "different row"; cases[4].publication.snapshot.claims[0].evidence[0].locator = "different row";
  for (const candidate of cases) { assert.deepEqual(compareFictionalObservations(before, candidate), { kind: "held" });
    const markup = render(before, candidate); assert.match(markup, /Comparison held/); assert.doesNotMatch(markup, /PRIVATE_PROVENANCE_CANARY|Recorded source version|Content fingerprint|22222222|55555555|27\.4|28\.1/); }
});
test("projected provenance remains an owned checked value after input records change", () => {
  const left = structuredClone(before), right = structuredClone(after), compared = compareFictionalObservations(left, right);
  left.decision.sourceVersionId = "PRIVATE_LATE_VALUE"; right.decision.contentSha256 = "PRIVATE_LATE_VALUE";
  sourceFields(compared, before, after); assert.ok(!JSON.stringify(compared).includes("PRIVATE_LATE_VALUE"));
});
test("the existing exported comparison format and complete bytes stay unchanged", () => {
  const expected = JSON.parse(readFileSync(new URL("../fixtures/fictional_comparison_export_byte_oracles.json", import.meta.url)));
  for (const [index, candidate] of [after, before, pairSameValue()].entries()) {
    const bytes = exportFictionalComparison(before, candidate); assert.equal(createHash("sha256").update(bytes).digest("hex"), expected[index]);
    const parsed = JSON.parse(bytes); assert.deepEqual(Object.keys(parsed), ["schemaVersion", "artifactKind", "state", "publicChanges", "comparisonKind", "before", "after", "deltaPercentagePoints", "limitation"]);
    assert.equal(parsed.state, "draft"); assert.equal(parsed.publicChanges, 0);
  }
});
