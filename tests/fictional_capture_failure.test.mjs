import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFictionalCaptureFailure } from "../src/fictional-capture-failure.ts";
const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_capture_failure_snapshot.json", import.meta.url), "utf8"));
test("an incomplete saved run preserves unknown measurement and deferred work", () => {
  const record = parseFictionalCaptureFailure(saved);
  assert.equal(record.runState, "partial");
  assert.equal(record.coveredSources, 0);
  assert.equal(record.dependentSourceRequests, 0);
  assert.equal(record.measuredResponseBytes, null);
  assert.equal(record.savedCloseouts, 1);
});
test("the preview cannot turn charged capacity into a measured response or success", () => {
  for (const change of [{ runState: "completed" }, { measuredResponseBytes: 65537 }, { retainedChargeBytes: 0 },
    { coveredSources: 1 }, { sourceVersions: 1 }, { storedFacts: 1 }, { expectedFindings: 1 }, { dependentSourceRequests: 1 }]) {
    assert.throws(() => parseFictionalCaptureFailure({ ...saved, ...change }));
  }
});
test("private identity, runtime flags and impossible chronology stay outside the preview", () => {
  for (const change of [{ runtimeEnabled: true }, { externalSourceRequests: 1 }, { workClaimId: "private" },
    { rawBody: "private" }, { finishedAt: "2027-01-01T00:00:00+00:00" }]) {
    assert.throws(() => parseFictionalCaptureFailure({ ...saved, ...change }));
  }
});
