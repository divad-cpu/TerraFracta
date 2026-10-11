import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { compareFictionalObservations } from "../src/fictional-observation-comparison.ts";
const before = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url))).fictionalCandidate;
const after = JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json", import.meta.url))).fictionalCandidate;
const Comparison = loadTsx(new URL("../app/update-preview/comparison.tsx", import.meta.url)).FictionalComparison;
const render = candidate => renderToStaticMarkup(createElement(Comparison, { baseline: before, candidate }));
function sameValue() { const value = structuredClone(after); value.observation.value = before.observation.value;
  value.publication.snapshot.claims[0].assertion = before.publication.snapshot.claims[0].assertion; return value; }
const sha = markup => createHash("sha256").update(markup).digest("hex");
test("equal checked version identities describe two recorded drafts without inventing a new version", () => {
  for (const candidate of [before, structuredClone(before)]) {
    assert.equal(compareFictionalObservations(before, candidate).kind, "unchanged"); const markup = render(candidate);
    const panels = [...markup.matchAll(/<article>([\s\S]*?)<\/article>/g)].map(m => m[1]); assert.equal(panels.length, 2);
    for (const [index, ordinal] of ["First", "Second"].entries()) {
      assert.ok(panels[index].includes(`${ordinal} recorded draft`));
      assert.ok(panels[index].includes(`${ordinal} draft’s illustrative source`));
      assert.ok(panels[index].includes(`Recorded source version: ${ordinal.toLowerCase()} draft`));
      assert.ok(panels[index].includes(before.decision.sourceVersionId)); assert.ok(panels[index].includes(before.decision.contentSha256));
    }
    assert.doesNotMatch(markup, /Earlier source version|New source version|New illustrative source|Recorded source version: new/);
    assert.match(markup, /Same period · unchanged observation/); assert.match(markup, /0\.0 percentage points/);
    assert.match(markup, /do not establish independent sources, live access or publication rights/);
  }
});
test("different checked versions preserve complete reviewed HTML for changed and unchanged values", () => {
  // Captured from the actual W26 presenter before this wording-only change.
  const expected = ["e90f3cbff444a73b1c2a646d2b66e69c73fde326d466149bee15804f0d582ec3", "6b0a91d0956e6c45c997114225586c86d75846af55c4535203e32dab84dc9f5c"];
  for (const [index, candidate] of [after, sameValue()].entries()) {
    assert.notEqual(before.decision.sourceVersionId, candidate.decision.sourceVersionId);
    const markup = render(candidate); assert.equal(sha(markup), expected[index]); assert.match(markup, /New source version/);
  }
});
test("closed comparison refusal retains exact held output without draft or version disclosure", () => {
  for (const candidate of [null, { ...before, rawBody: "PRIVATE_CANARY" }, { ...before, decision: { ...before.decision, contentSha256: "c".repeat(64) } }]) {
    assert.deepEqual(compareFictionalObservations(before, candidate), { kind: "held" }); const markup = render(candidate);
    assert.equal(sha(markup), "3fe5a10492834f7b5e92fcf68e6d1df9965261dd574668e55920931fd43827a0");
    assert.doesNotMatch(markup, /PRIVATE_CANARY|recorded draft|Source version reference|27\.4/);
  }
});
