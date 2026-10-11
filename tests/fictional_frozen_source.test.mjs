import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseFictionalFrozenSource } from "../src/fictional-frozen-source.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_frozen_source_capture_snapshot.json", import.meta.url)));

test("saved actual invented collection stays pending with three retained failures", () => {
  const result = parseFictionalFrozenSource(saved);
  assert.equal(result.pairsStored, 1);
  assert.equal(result.sourceVersions, 2);
  assert.equal(result.faults.length, 3);
  assert.equal(result.collectionState, "pending");
  assert.equal(result.processingState, "partial");
});

test("private identities, live acceptance and retry claims are refused", () => {
  for (const change of [{ runId: "private" }, { livePublicationEnabled: true }, { websiteVisibilityVerified: true },
    { realSourceRequests: 1 }, { collectionState: "usable" }, { reviewedCodeUsed: 1 }, { processingState: "completed" }]) {
    assert.throws(() => parseFictionalFrozenSource({ ...saved, ...change }));
  }
  const changed = structuredClone(saved);
  changed.faults[0].automaticRestage = true;
  assert.throws(() => parseFictionalFrozenSource(changed));
});

test("duplicate or relabelled saved failures cannot borrow the other outcomes", () => {
  const changed = structuredClone(saved);
  changed.faults[2] = changed.faults[0];
  assert.throws(() => parseFictionalFrozenSource(changed));
});
