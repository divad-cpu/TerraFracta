import assert from "node:assert/strict";
import test from "node:test";
import { checkMachineActivationResult } from "../src/machine-activation-result.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";

const expected = { publicationId: "11111111-1111-4111-8111-111111111111",
  decisionId: "88888888-8888-4888-8888-888888888888", runId: "99999999-9999-4999-8999-999999999999",
  requestFingerprint: "a".repeat(64), publicationSha256: "b".repeat(64) };
function candidate() {
  const rows = sample(), evidence = rows.publication.snapshot.claims[0].evidence[0];
  rows.publication.snapshot.claims[0].evidence = [evidence];
  rows.publication.dependency_manifest.sourceVersionIds = [evidence.sourceVersionId];
  rows.sources = [rows.sources[0]]; rows.citations = [rows.citations[0]];
  rows.sources[0].version.content_sha256 = "c".repeat(64);
  rows.citations[0].machine_binding = { decisionId: expected.decisionId,
    qualificationId: "77777777-7777-4777-8777-777777777777", disposition: "eligible",
    sourceVersionId: evidence.sourceVersionId, contentSha256: "c".repeat(64),
    semanticContractSha256: "d".repeat(64), qualificationSemanticContractSha256: "d".repeat(64),
    publicCitationUrl: evidence.url, qualificationPublicCitationUrl: evidence.url,
    qualifiedRetrievalUrl: evidence.url, evidenceLocator: evidence.locator };
  return rows;
}
function receipt(status, activatedAt) {
  return { ...expected, schemaVersion: 1, status, activatedAt, visibilityState: "pending",
    currentHeadMatches: true, candidate: status === "activated" ? candidate() : null };
}
for (const status of ["already_activated", "activated"]) {
  test(`a ${status} receipt cannot borrow observation's millisecond for a future fraction`, () => {
    const now = new Date("2026-10-01T12:00:00.123Z");
    for (const stamp of ["2026-10-01T12:00:00.123000001Z", "2026-10-01T14:00:00.123000000000000001+02:00"]) {
      assert.throws(() => checkMachineActivationResult(receipt(status, stamp), expected, now), /Activation receipt is inconsistent/);
    }
  });
  test(`a ${status} receipt preserves equal offsets, earlier fractions and pending visibility`, () => {
    const now = new Date("2026-10-01T12:00:00.123Z");
    for (const stamp of ["2026-10-01T12:00:00.123000000Z", "2026-10-01T07:00:00.123-05:00", "2026-10-01T12:00:00.122999999999999999Z"]) {
      const result = checkMachineActivationResult(receipt(status, stamp), expected, now);
      assert.equal(result.visibilityState, "pending");
      assert.equal(result.kind, status === "activated" ? "candidate" : "receipt");
      assert.equal("activatedAt" in result, false); assert.equal("candidate" in result, false);
      if (status === "activated") {
        assert.equal(result.issue.claims.length, 1);
        assert.equal(JSON.stringify(result).includes("machine_binding"), false);
        assert.equal(JSON.stringify(result).includes("content_sha256"), false);
      }
    }
  });
}
test("pre-epoch receipt fractions compare to the actual millisecond clock", () => {
  const now = new Date("1969-12-31T23:59:59.999Z");
  assert.throws(() => checkMachineActivationResult(receipt("already_activated", "1969-12-31T23:59:59.999000001Z"), expected, now), /inconsistent/);
  assert.equal(checkMachineActivationResult(receipt("already_activated", "1969-12-31T23:59:59.998999999Z"), expected, now).kind, "receipt");
});
test("malformed timestamps and invalid clocks retain one curated refusal", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  for (const stamp of ["private-canary", "2026-02-30T12:00:00Z", "2026-10-01T12:00:00+01:30:20", "2026-10-01T12:00Z"]) {
    assert.throws(() => checkMachineActivationResult(receipt("already_activated", stamp), expected, now),
      { message: "Activation receipt is inconsistent" });
  }
  assert.throws(() => checkMachineActivationResult(receipt("already_activated", now.toISOString()), expected, new Date(NaN)),
    { message: "Activation receipt is inconsistent" });
});
test("chronological equality does not weaken candidate identity or current-head checks", () => {
  const now = new Date("2026-10-01T12:00:00Z"), stamp = now.toISOString();
  const changed = receipt("activated", stamp); changed.candidate.citations[0].machine_binding.decisionId = expected.runId;
  assert.throws(() => checkMachineActivationResult(changed, expected, now), /inconsistent/);
  const stale = receipt("activated", stamp); stale.currentHeadMatches = false;
  assert.throws(() => checkMachineActivationResult(stale, expected, now), /inconsistent/);
  const input = receipt("already_activated", stamp); input.currentHeadMatches = false;
  assert.equal(checkMachineActivationResult(input, expected, now).currentHeadMatches, false);
});
