import assert from "node:assert/strict";
import test from "node:test";
import { checkScopeDraft, scopeDraftJson, scopeDraftFieldFeedback } from "../src/issue-scope-draft.ts";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";

const context = () => capturedScopeDraftContext(proposalReport());
const reference = () => ({ claimId: proposalId(3), referenceNumber: 1 });
const fields = () => ({ population: null, period: null, selectionRationale: null });
const okay = { wording: false, references: false };
const candidate = (ctx, input) => ({ schemaVersion: 1, kind: "issue_scope_preparation", binding: ctx.binding, fields: input });

test("unknown optional fields and exact valid wording/reference choices have no field errors", () => {
  const ctx = context(), input = fields();
  assert.deepEqual(scopeDraftFieldFeedback(input, ctx), { population: okay, period: okay, selectionRationale: okay });
  input.population = { wording: "  Invented population  ", references: [reference()] };
  const before = structuredClone(input);
  assert.deepEqual(scopeDraftFieldFeedback(input, ctx), { population: okay, period: okay, selectionRationale: okay });
  assert.deepEqual(input, before, "feedback does not trim the editable or captured source values");
  assert.equal(checkScopeDraft(candidate(ctx, input), ctx).fields.population.wording, "Invented population");
});

test("missing wording, missing references and excessive selections identify their own controls", () => {
  const ctx = context(), input = fields();
  input.population = { wording: " ", references: [reference()] };
  input.period = { wording: "Invented interval", references: [] };
  input.selectionRationale = { wording: "x".repeat(1201), references: Array.from({ length: 13 }, reference) };
  assert.deepEqual(scopeDraftFieldFeedback(input, ctx), {
    population: { wording: true, references: false }, period: { wording: false, references: true },
    selectionRationale: { wording: true, references: true },
  });
  assert.equal(checkScopeDraft(candidate(ctx, input), ctx), null);
});

test("structurally valid repeated, foreign and out-of-range occurrences remain reference errors", () => {
  const ctx = context();
  for (const refs of [[reference(), reference()], [{ claimId: proposalId(99), referenceNumber: 1 }], [{ claimId: proposalId(3), referenceNumber: 3 }], [{ claimId: proposalId(3), referenceNumber: 13 }], [null], ["PRIVATE_REFERENCE"]]) {
    const input = fields(); input.population = { wording: "Invented population", references: refs };
    assert.deepEqual(scopeDraftFieldFeedback(input, ctx)?.population, { wording: false, references: true });
    assert.equal(checkScopeDraft(candidate(ctx, input), ctx), null);
  }
  const mixed = fields(); mixed.population = { wording: " ", references: [{ claimId: proposalId(99), referenceNumber: 1 }] };
  assert.deepEqual(scopeDraftFieldFeedback(mixed, ctx)?.population, { wording: true, references: true });
});

test("feedback reuses trimmed wording limits and never approves changed binding or total export size", () => {
  const ctx = context(), input = fields();
  input.population = { wording: "x".repeat(1200) + "  ", references: [reference()] };
  assert.deepEqual(scopeDraftFieldFeedback(input, ctx)?.population, okay);
  const changed = candidate(ctx, input); changed.binding = { ...changed.binding, comparisonSha256: "0".repeat(64) };
  assert.equal(checkScopeDraft(changed, ctx), null);
  const large = structuredClone(ctx); large.claims[0].evidence = Array.from({ length: 12 }, () => structuredClone(ctx.claims[0].evidence[0]));
  for (const field of Object.keys(input)) input[field] = { wording: "\u0001".repeat(200) + "界".repeat(1000), references: Array.from({ length: 12 }, (_, index) => ({ claimId: proposalId(3), referenceNumber: index + 1 })) };
  const prepared = checkScopeDraft(candidate(large, input), large);
  assert.ok(prepared); assert.ok(Object.values(scopeDraftFieldFeedback(input, large)).every(row => !row.wording && !row.references));
  // The export quota remains a separate canonical gate; use all three fields
  // with bounded UTF-16 wording and explicit valid occurrence identities.
  assert.ok(new TextEncoder().encode(JSON.stringify(prepared, null, 2)).byteLength > 16_384);
  assert.equal(scopeDraftJson(prepared, large), null);
});

test("malformed context or field shape yields opaque unavailable feedback without echoing values", () => {
  const ctx = context();
  for (const input of [null, [], {}, { ...fields(), privateCanary: "PRIVATE" }, new Proxy(fields(), { get() { throw Error("PRIVATE"); } })])
    assert.equal(scopeDraftFieldFeedback(input, ctx), null);
  assert.equal(scopeDraftFieldFeedback(fields(), {}), null);
  assert.equal(scopeDraftFieldFeedback(fields(), new Proxy({}, { get() { throw Error("PRIVATE"); } })), null);
});
