import assert from "node:assert/strict";
import test from "node:test";
import { readResponsibilityDraftFile } from "../src/responsibility-file.ts";
import { responsibilityDraftJson, RESPONSIBILITY_DRAFT_BYTES } from "../src/responsibility-draft.ts";
import { scopeDraftJson } from "../src/issue-scope-draft.ts";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";
const context = () => capturedScopeDraftContext(proposalReport());
const sample = c => ({ schemaVersion: 1, kind: "responsibility_preparation", binding: c.binding, entries: [{ claimId: c.claims[0].id,
  fields: { institution: { wording: "Invented æ authority", references: [{ claimId: c.claims[0].id, referenceNumber: 2 }] }, governmentLevel: null, role: null, period: null } }] });
const bytes = value => new TextEncoder().encode(value).buffer;
test("exact native UTF-8 responsibility JSON reopens as detached editable preparation with original nullable fields", () => {
  const c = context(), draft = sample(c), json = responsibilityDraftJson(draft, c), input = bytes(json);
  const result = readResponsibilityDraftFile(input, input.byteLength, c); assert.deepEqual(result, draft);
  new Uint8Array(input).fill(0); assert.deepEqual(result, draft);
});
test("native byte size rather than shadow properties or iterable lookalikes enforces the fixed allocation", () => {
  const c = context(), json = responsibilityDraftJson(sample(c), c), input = bytes(json), size = input.byteLength;
  Object.defineProperty(input, "byteLength", { value: 1 }); assert.ok(readResponsibilityDraftFile(input, size, c));
  const oversized = new ArrayBuffer(RESPONSIBILITY_DRAFT_BYTES + 1); Object.defineProperty(oversized, "byteLength", { value: 2 });
  assert.equal(readResponsibilityDraftFile(oversized, 2, c), null);
  for (const value of [Object.create(ArrayBuffer.prototype), new Uint8Array(bytes(json)), new Proxy({}, { get() { assert.fail("Native buffer lookalike was inspected"); } })]) assert.equal(readResponsibilityDraftFile(value, size, c), null);
});
test("invalid sizes malformed UTF-8 BOM duplicate keys and nonexact JSON refuse without repairing bytes", () => {
  const c = context(), json = responsibilityDraftJson(sample(c), c), original = bytes(json);
  for (const size of [0, 1, -1, NaN, Infinity, 2.5, original.byteLength + 1, "12", RESPONSIBILITY_DRAFT_BYTES + 1]) assert.equal(readResponsibilityDraftFile(original, size, c), null);
  for (const value of [new Uint8Array([0xff, 0xfe]).buffer, bytes("\ufeff" + json), bytes(json + "\n"), bytes(json.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'))]) assert.equal(readResponsibilityDraftFile(value, value.byteLength, c), null);
});
test("scope JSON and changed captured binding or reference membership cannot reopen through the responsibility decoder", () => {
  const c = context(), json = responsibilityDraftJson(sample(c), c), input = bytes(json);
  const scope = bytes(scopeDraftJson({ schemaVersion: 1, kind: "issue_scope_preparation", binding: c.binding, fields: { population: null, period: null, selectionRationale: null } }, c));
  assert.equal(readResponsibilityDraftFile(scope, scope.byteLength, c), null);
  const changed = structuredClone(c); changed.binding.captureId = proposalId(99); assert.equal(readResponsibilityDraftFile(input, input.byteLength, changed), null);
  const foreign = sample(c); foreign.entries[0].fields.institution.references[0].claimId = proposalId(99); const invalid = bytes(JSON.stringify(foreign, null, 2));
  assert.equal(readResponsibilityDraftFile(invalid, invalid.byteLength, c), null);
});
