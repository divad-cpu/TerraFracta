import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFictionalPipelineSnapshot, pipelineStages } from "../src/fictional-pipeline-snapshot.ts";
const sample = JSON.parse(readFileSync(new URL("../fixtures/fictional_pipeline_snapshot.json", import.meta.url), "utf8"));
const copy = () => structuredClone(sample);

test("whole-update stages keep storage separate from website verification", () => {
  const record = parseFictionalPipelineSnapshot(sample);
  const fact = record.cases.find((x) => x.caseKey === "stored_fact");
  const stages = pipelineStages(fact);
  assert.equal(stages.find((x) => x.key === "storage").status, "passed");
  assert.equal(stages.find((x) => x.key === "visibility").status, "pending");
  assert.equal(record.runtimeVisibilityVerified, false);
});
test("a resolved hold completes without activating a fact", () => {
  const entry = sample.cases.find((x) => x.caseKey === "held_finished");
  const stages = pipelineStages(entry);
  assert.equal(stages.find((x) => x.key === "decision").status, "held");
  assert.equal(stages.find((x) => x.key === "storage").status, "not_needed");
  assert.equal(stages.find((x) => x.key === "closeout").status, "passed");
});
test("a missing decision cannot be labelled finished or checked", () => {
  const entry = sample.cases.find((x) => x.caseKey === "missing_decision");
  assert.equal(pipelineStages(entry).find((x) => x.key === "decision").status, "pending");
  assert.throws(() => pipelineStages({ ...entry, decidedItems: 1 }));
});
test("changing named outcomes, counters or capacity cannot invent success", () => {
  for (const change of [{ storedFacts: 0 }, { visibilityState: "verified" }, { pendingItems: 1 },
    { fixtureReads: 2 }, { sourceChecks: 0 }, { reservedBytes: 65536 }, { measuredBytes: 65537 }]) {
    const record = copy(); Object.assign(record.cases[0], change);
    assert.throws(() => parseFictionalPipelineSnapshot(record));
  }
  const record = copy(); record.cases[1].caseKey = "stored_fact";
  assert.throws(() => parseFictionalPipelineSnapshot(record));
});
test("private controls, enabled runtime flags or changed source links reject", () => {
  for (const key of ["runId", "workClaimId", "reservationId", "databaseTarget", "principal", "rawBody"]) {
    const record = copy(); record[key] = "fictional-placeholder";
    assert.throws(() => parseFictionalPipelineSnapshot(record));
  }
  for (const change of [{ liveCollectionEnabled: true }, { livePublicationEnabled: true },
    { externalSourceRequests: 1 }, { displayRollbackVerified: false }, { runtimeVisibilityVerified: true }]) {
    const record = copy(); Object.assign(record, change);
    assert.throws(() => parseFictionalPipelineSnapshot(record));
  }
  const record = copy(); record.fact.url = "https://example.org/substitute";
  assert.throws(() => parseFictionalPipelineSnapshot(record));
});
test("different measured bodies or impossible chronology cannot combine", () => {
  for (const change of [(r) => r.cases[1].measuredBytes++,
    (r) => r.fact.lastEvidenceReviewOn = "2026-09-28",
    (r) => r.fact.retrievedAt = "2027-01-01T00:00:00Z",
    (r) => r.cases[0].finishedAt = "2027-01-01T00:00:00Z"]) {
    const record = copy(); change(record);
    assert.throws(() => parseFictionalPipelineSnapshot(record));
  }
});
