import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parsePrivateRecoveryTrial } from "../src/private-recovery-trial.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_private_recovery_snapshot.json", import.meta.url)));

test("saved recovery distinguishes retained outcomes without current source or admission claims", () => {
  const value = parsePrivateRecoveryTrial(saved);
  assert.equal(value.cases.length, 4);assert.equal(value.cases[1].nativeCloseoutPresent, false);
  assert.equal(value.cases[2].nativeCloseoutPresent, true);assert.equal(value.historicalAdmissionOnly, true);
  assert.equal(value.sourceRequests, 0);assert.equal(value.automaticRetry, false);
  assert.doesNotMatch(JSON.stringify(value), /rawBody|runId|workClaimId|privateEvidenceDirectory|principal|readingChargeBytes/);
});

test("mixed or overstated saved recovery remains unavailable", () => {
  for (const [key, value] of [["sourceRequests", 1], ["liveStatus", true], ["publicationEnabled", true],
    ["repairPerformed", true], ["automaticRetry", true], ["historicalAdmissionOnly", false], ["rawBody", "canary"]]) {
    assert.throws(() => parsePrivateRecoveryTrial({ ...saved, [key]: value }));
  }
  const changed = structuredClone(saved);changed.cases[1].nativeCloseoutPresent = true;
  assert.throws(() => parsePrivateRecoveryTrial(changed));
  changed.cases.reverse();assert.throws(() => parsePrivateRecoveryTrial(changed));
});
