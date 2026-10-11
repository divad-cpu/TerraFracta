import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSyntheticReadGate } from "../app/editorial-preview/synthetic-read-gate.ts";
import { syntheticReadRows } from "../app/evidence-preview/example.ts";

const ready = {
  sourceTitleReviewed: true,
  issueTextReviewed: true,
  periodLabelReviewed: true,
  claimWordingReviewed: true,
  publicReuseAllowed: true,
  citationSelected: true,
};

test("a fully fictional complete fixture passes the existing local read checker", () => {
  assert.equal(evaluateSyntheticReadGate(ready), true);
});

test("each missing fictional condition holds the page without mutating the fixture", () => {
  const original = structuredClone(syntheticReadRows);
  for (const key of Object.keys(ready)) {
    assert.equal(evaluateSyntheticReadGate({ ...ready, [key]: false }), false, key);
  }
  assert.deepEqual(syntheticReadRows, original);
});
