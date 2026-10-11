import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parsePrivateCustodianTrial } from "../src/private-custodian-trial.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_private_custodian_snapshot.json", import.meta.url), "utf8"));

test("recorded complete path keeps both years pending and all interruption outcomes held", () => {
  const record = parsePrivateCustodianTrial(saved);
  assert.deepEqual(record.pendingYears, [2024, 2025]);
  assert.deepEqual(record.faults.map((item) => [item.savedPairs, item.savedCloseouts]), [[0, 0], [1, 0], [1, 1]]);
  assert.ok(record.faults.every((item) => item.result === "held" && !item.automaticRetry));
  assert.equal(record.liveStatus, false);
});

test("private identities, response bytes and live acceptance claims cannot enter this view", () => {
  for (const [key, value] of [["rawBody", "invented-private-canary"], ["principal", "canary"], ["pairId", "canary"],
    ["nativeAdmissionReceiptSha256", "a".repeat(64)], ["rawPath", "/private/canary"], ["liveStatus", true],
    ["sourceRequests", 1], ["sourceRequests", false], ["modelCalls", 1], ["checkpointAdvanced", true],
    ["publicQualificationIssued", true], ["publicationEnabled", true], ["ownedProcessesEnded", false]]) {
    assert.throws(() => parsePrivateCustodianTrial({ ...saved, [key]: value }));
  }
});

test("fault order, preserved counts and no automatic retry remain exact", () => {
  for (const change of [(x) => x.faults.reverse(), (x) => x.faults[0].savedPairs = 1,
    (x) => x.faults[1].savedCloseouts = 1, (x) => x.faults[2].result = "successful",
    (x) => x.faults[1].automaticRetry = true, (x) => x.pendingYears.reverse(),
    (x) => x.faults[1].rawBody = "private-canary", (x) => x.faults[2].savedCloseouts = true]) {
    const changed = structuredClone(saved); change(changed);
    assert.throws(() => parsePrivateCustodianTrial(changed));
  }
});
