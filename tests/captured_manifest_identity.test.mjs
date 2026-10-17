import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { proposedPayload, proposalReport } from "./helpers/proposal_fixture.mjs";
import { encodeProposalCapture, decodeProposalCapture, parseCapturedProposalEnvelope } from "../src/server/proposal-capture.ts";
import { canonicalProposalJson } from "../src/operator-proposal-capture.ts";
const lower = "abcdefab-cdef-4abc-8def-abcdefabcdef";
function repeated() {
  const payload = proposedPayload(), claim = payload.snapshot.claims[0];
  claim.evidence[0].sourceVersionId = lower; payload.dependencyManifest.sourceVersionIds[0] = lower;
  claim.evidence.push({ ...claim.evidence[0], sourceVersionId: lower.toUpperCase(), locator: "Another invented passage" });
  payload.dependencyManifest.sourceVersionIds.push(lower.toUpperCase()); return payload;
}
test("trusted preparation refuses duplicate UUID dependencies in both case orders without creating captured bytes", () => {
  for (const reverse of [false, true]) {
    const payload = repeated(); if (reverse) payload.dependencyManifest.sourceVersionIds.reverse();
    assert.throws(() => encodeProposalCapture(payload));
  }
});
test("exact hashed review-only decoding refuses a case-aliased dependency manifest", () => {
  const json = canonicalProposalJson(repeated()), hash = createHash("sha256").update(json).digest("hex");
  assert.throws(() => decodeProposalCapture(json, hash));
});
test("captured envelope refuses duplicate UUID spellings in a base panel even with exact recomputed base hashes", () => {
  const report = proposalReport(), base = JSON.parse(report.base.publicationJson), claim = base.snapshot.claims[0];
  claim.evidence[0].sourceVersionId = lower; base.dependencyManifest.sourceVersionIds[0] = lower;
  claim.evidence.push({ ...claim.evidence[0], sourceVersionId: lower.toUpperCase(), locator: "Another base passage" });
  base.dependencyManifest.sourceVersionIds.push(lower.toUpperCase());
  const publicationJson = JSON.stringify(base), publicationSha256 = createHash("sha256").update(publicationJson).digest("hex");
  report.base = { publicationJson, publicationSha256 }; report.capture.baseContentSha256 = publicationSha256;
  assert.throws(() => parseCapturedProposalEnvelope(report));
});
test("one uppercase source spelling and repeated references preserve exact private JSON while spelling mismatch still refuses", () => {
  const payload = proposedPayload(), claim = payload.snapshot.claims[0], upper = lower.toUpperCase();
  claim.evidence[0].sourceVersionId = upper; payload.dependencyManifest.sourceVersionIds[0] = upper;
  claim.evidence.push({ ...claim.evidence[0], locator: "Another exact passage" });
  const encoded = encodeProposalCapture(payload); assert.deepEqual(decodeProposalCapture(encoded.proposalJson, encoded.proposalSha256), payload);
  payload.dependencyManifest.sourceVersionIds[0] = lower; assert.throws(() => encodeProposalCapture(payload));
  assert.equal(parseCapturedProposalEnvelope(proposalReport()).status, "ok");
});
