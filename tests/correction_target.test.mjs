import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { deriveCorrectionTarget, checkCorrectionTarget, checkCorrectionDraft, correctionDraftFieldsSchema } from "../src/correction-target.ts";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";

const current = () => ({ kind: "issue", issue: connectedInput().issue });
const fields = () => ({ kind: "missing_context", details: "The sample sentence should state its measurement period.", sourceUrl: "https://example.org/fictional-context" });
function available(outcome, claimId = null) {
  const result = deriveCorrectionTarget(outcome, claimId); assert.equal(result.kind, "available"); return result;
}

test("page and visible-claim targets use the exact checked issue, route, publication and revision", () => {
  const outcome = current(), page = available(outcome);
  assert.deepEqual(page.target, { issueId: outcome.issue.issueId, publicationId: outcome.issue.publicationId,
    revision: 1, jurisdictionSlug: "fictional-country", issueSlug: "fictional-share", claimId: null });
  assert.equal(page.claimAssertion, null);
  const claim = available(outcome, outcome.issue.claims[0].id);
  assert.equal(claim.claimAssertion, "In 2025, the fictional share was 27.4%.");
  assert.deepEqual(checkCorrectionTarget(outcome, claim.target), claim);
});

test("a successor with the same claim ID cannot receive an earlier publication's draft", () => {
  const before = current(), target = available(before, before.issue.claims[0].id).target;
  const successor = structuredClone(before); successor.issue.publicationId = randomUUID(); successor.issue.revision = 2;
  successor.issue.claims[0].assertion = "In 2025, the fictional share was 28.1%.";
  assert.deepEqual(checkCorrectionTarget(successor, target), { kind: "held", reason: "changed" });
  assert.deepEqual(checkCorrectionDraft(successor, { target, fields: fields() }), { kind: "held", reason: "changed" });
  assert.equal(available(successor, target.claimId).claimAssertion, "In 2025, the fictional share was 28.1%.");
});

test("each mismatched issue, publication, revision and route refuses independently", () => {
  const outcome = current(), target = available(outcome).target;
  for (const change of [{ issueId: randomUUID() }, { publicationId: randomUUID() }, { revision: 2 },
    { jurisdictionSlug: "other-place" }, { issueSlug: "other-issue" }]) {
    assert.deepEqual(checkCorrectionTarget(outcome, { ...target, ...change }), { kind: "held", reason: "changed" });
  }
});

test("a claim from the same issue but absent from the visible revision is unavailable", () => {
  const outcome = current();
  assert.deepEqual(deriveCorrectionTarget(outcome, randomUUID()), { kind: "held", reason: "invalid_target" });
  for (const claimId of [undefined, [], 1, "", "../private"]) {
    // Undefined means the optional function argument was omitted, hence page scope.
    if (claimId === undefined) continue;
    assert.deepEqual(deriveCorrectionTarget(outcome, claimId), { kind: "held", reason: "invalid_target" });
  }
});

test("missing, rejected, suppressed-shaped or malformed current projections reveal no target or wording", () => {
  const target = available(current()).target;
  for (const outcome of [{ kind: "absent" }, { kind: "rejected" }, { kind: "issue", issue: null },
    { kind: "snapshot", snapshot: { state: "suppressed", issue: null } }, null, undefined]) {
    assert.deepEqual(deriveCorrectionTarget(outcome), { kind: "held", reason: "unavailable" });
    assert.deepEqual(checkCorrectionTarget(outcome, target), { kind: "held", reason: "unavailable" });
  }
});

test("duplicate claims, unsafe revisions and private extra fields cannot enter the correction context", () => {
  for (const mutate of [outcome => outcome.issue.claims.push(structuredClone(outcome.issue.claims[0])),
    outcome => outcome.issue.revision = Number.MAX_SAFE_INTEGER + 1,
    outcome => outcome.issue.privateCanary = "must-not-leak",
    outcome => outcome.issue.claims[0].privateCanary = "must-not-leak"]) {
    const outcome = current(); mutate(outcome);
    assert.deepEqual(deriveCorrectionTarget(outcome), { kind: "held", reason: "unavailable" });
  }
});

test("strict target parsing refuses client review status, private data and fabricated shapes", () => {
  const outcome = current(), target = available(outcome).target;
  for (const input of [{ ...target, reviewState: "closed" }, { ...target, privateCanary: "must-not-leak" },
    { ...target, revision: true }, { ...target, revision: 0 }, { ...target, revision: 1.5 },
    { ...target, claimId: "" }, { ...target, issueSlug: "../private" }, [], null]) {
    assert.deepEqual(checkCorrectionTarget(outcome, input), { kind: "held", reason: "invalid_target" });
  }
});

test("a bounded local draft preserves plain text and derives display wording from the current read", () => {
  const outcome = current(), target = available(outcome, outcome.issue.claims[0].id).target;
  const input = { target, fields: { ...fields(), details: "  Sample: <script>unsupported text</script>\nNo HTML is executed.  " } };
  const result = checkCorrectionDraft(outcome, input);
  assert.equal(result.kind, "preview"); assert.equal(result.draft.fields.details, input.fields.details.trim());
  assert.equal(result.draft.claimAssertion, outcome.issue.claims[0].assertion);
  assert.equal(result.draft.pageTitle, outcome.issue.title);
  assert.deepEqual(Object.keys(result.draft).sort(), ["claimAssertion", "fields", "pageTitle", "target"]);
  assert.equal(input.fields.details.startsWith("  "), true, "input object remains unchanged");
});

test("field boundaries, required kinds and optional HTTPS source have explicit limits", () => {
  for (const details of ["x".repeat(10), "x".repeat(1000)]) assert.equal(correctionDraftFieldsSchema.safeParse({ ...fields(), details }).success, true);
  for (const details of ["x".repeat(9), "x".repeat(1001), " ".repeat(10), "sample\u0000canary", "sample\u007fcanary"]) {
    assert.equal(correctionDraftFieldsSchema.safeParse({ ...fields(), details }).success, false);
  }
  assert.equal(correctionDraftFieldsSchema.safeParse({ ...fields(), sourceUrl: "" }).success, true);
  for (const sourceUrl of ["http://example.org/source", "javascript:alert(1)", "https://name:secret@example.org/source",
    "https://example.org/line\nfeed", "https://example.org/a b", "https://example.org/" + "x".repeat(2048)]) {
    assert.equal(correctionDraftFieldsSchema.safeParse({ ...fields(), sourceUrl }).success, false);
  }
});

test("draft parsing cannot assign storage, contacts, timestamps or moderation state", () => {
  const outcome = current(), input = { target: available(outcome).target, fields: fields() };
  for (const extra of [{ reviewState: "closed" }, { reportedAt: "2026-10-02" }, { contact: "sample@example.org" }, { resolutionNote: "Automatically approved" }]) {
    assert.deepEqual(checkCorrectionDraft(outcome, { ...input, ...extra }), { kind: "held", reason: "invalid_fields" });
    assert.deepEqual(checkCorrectionDraft(outcome, { ...input, fields: { ...input.fields, ...extra } }), { kind: "held", reason: "invalid_fields" });
  }
  assert.deepEqual(checkCorrectionDraft(outcome, { ...input, fields: { ...fields(), kind: "publish_now" } }), { kind: "held", reason: "invalid_fields" });
});
