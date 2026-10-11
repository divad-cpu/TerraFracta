import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parsePrivateSSBAssessment } from "../src/private-ssb-assessment.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_private_ssb_assessment_snapshot.json", import.meta.url), "utf8"));
test("saved assessment retains two held fictional annual observations", () => {
  const result = parsePrivateSSBAssessment(saved);
  assert.deepEqual(result.candidates.map((x) => x.year), [2024, 2025]);
  assert.equal(result.pairStatus, "pending");
  assert.equal(result.publicQualificationIssued, false);
});
test("private values and live acceptance claims cannot enter the display", () => {
  for (const [key, value] of [["respondentCount", 100], ["rawBody", "canary"], ["pairId", "canary"],
    ["liveStatus", true], ["publicationEnabled", true], ["checkpointAdvanced", true],
    ["sourceRequests", false], ["sourceRequests", 1], ["numericCellsIncluded", true]]) {
    assert.throws(() => parsePrivateSSBAssessment({ ...saved, [key]: value }));
  }
});
test("held annual and unresolved meaning sets are fixed and ordered", () => {
  for (const change of [(x) => x.candidates.reverse(), (x) => x.candidates[0].state = "accepted",
    (x) => x.candidates[0].year = 2025, (x) => x.unresolvedMeanings.reverse()]) {
    const altered = structuredClone(saved); change(altered);
    assert.throws(() => parsePrivateSSBAssessment(altered));
  }
});
