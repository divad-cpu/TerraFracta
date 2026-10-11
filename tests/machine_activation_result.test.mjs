import assert from "node:assert/strict";
import test from "node:test";
import { checkMachineActivationResult } from "../src/machine-activation-result.ts";

const expected = {
  publicationId: "92bb9213-05e0-550a-8b99-cbf65e786609",
  decisionId: "88888888-8888-4888-8888-888888888888",
  runId: "11111111-1111-4111-8111-111111111111",
  requestFingerprint: "a".repeat(64), publicationSha256: "b".repeat(64),
};
const now = new Date("2026-09-30T14:00:00Z");
const sample = () => ({ ...expected, schemaVersion: 1, status: "already_activated",
  activatedAt: "2026-09-30T13:59:00+00:00", visibilityState: "pending",
  currentHeadMatches: true, candidate: null });

test("a replay receipt preserves unverified visibility and contains no issue", () => {
  assert.deepEqual(checkMachineActivationResult(sample(), expected, now),
    { kind: "receipt", status: "already_activated", visibilityState: "pending", currentHeadMatches: true });
});
test("a later head does not let replay reactivate an old issue", () => {
  const result = sample(); result.currentHeadMatches = false;
  assert.equal(checkMachineActivationResult(result, expected, now).currentHeadMatches, false);
});
test("every independently expected identity must match", () => {
  for (const key of Object.keys(expected)) {
    const result = sample();
    result[key] = key.endsWith("Sha256") || key.endsWith("Fingerprint")
      ? "c".repeat(64) : "99999999-9999-4999-8999-999999999999";
    assert.throws(() => checkMachineActivationResult(result, expected, now), /inconsistent/);
  }
});
test("private extras and missing receipt fields fail closed", () => {
  for (const key of ["candidate", "publicationSha256", "requestFingerprint"]) {
    const result = sample(); delete result[key];
    assert.throws(() => checkMachineActivationResult(result, expected, now));
  }
  assert.throws(() => checkMachineActivationResult({ ...sample(), leaseId: "private-placeholder" }, expected, now));
});
test("a replay cannot smuggle a private candidate into a public result", () => {
  assert.throws(() => checkMachineActivationResult({ ...sample(), candidate: {} }, expected, now));
});
test("new activation requires a fully materialized current issue", () => {
  for (const candidate of [null, {}, { candidate_state: "rejected" }]) {
    assert.throws(() => checkMachineActivationResult({ ...sample(), status: "activated", candidate }, expected, now));
  }
  assert.throws(() => checkMachineActivationResult({ ...sample(), status: "activated", currentHeadMatches: false }, expected, now));
});
test("neither publication nor verified visibility can be asserted by a receipt", () => {
  for (const visibilityState of ["verified", "public", "not_required"]) {
    assert.throws(() => checkMachineActivationResult({ ...sample(), visibilityState }, expected, now));
  }
  assert.throws(() => checkMachineActivationResult({ ...sample(), status: "published" }, expected, now));
});
test("future receipts, bad clocks and boolean schema versions reject", () => {
  assert.throws(() => checkMachineActivationResult({ ...sample(), activatedAt: "2026-10-01T00:00:00Z" }, expected, now));
  assert.throws(() => checkMachineActivationResult(sample(), expected, new Date("invalid")));
  assert.throws(() => checkMachineActivationResult({ ...sample(), schemaVersion: true }, expected, now));
});
