import assert from "node:assert/strict";
import test from "node:test";
import { readScopeDraftFile } from "../src/issue-scope-file.ts";
import { scopeDraftJson, SCOPE_DRAFT_BYTES } from "../src/issue-scope-draft.ts";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport } from "./helpers/proposal_fixture.mjs";
const context = () => capturedScopeDraftContext(proposalReport());
function saved(ctx = context()) { const candidate = { schemaVersion: 1, kind: "issue_scope_preparation", binding: ctx.binding, fields: { population: { wording: "Invented coverage", references: [{ claimId: ctx.claims[0].id, referenceNumber: 1 }] }, period: null, selectionRationale: null } }; return { candidate, json: scopeDraftJson(candidate, ctx), context: ctx }; }
const bytes = text => new TextEncoder().encode(text);
test("native file bytes reopen the exact preparation and own their result independently of later buffer mutation", () => {
 const s = saved(), body = bytes(s.json), result = readScopeDraftFile(body.buffer, body.byteLength, s.context);
 assert.deepEqual(result, s.candidate); body.fill(0); assert.equal(result.fields.population.wording, "Invented coverage");
});
test("intrinsic size and brand gates reject mismatched overquota detached shared and prototype-lookalike buffers", () => {
 const s = saved(), body = bytes(s.json), buffer = body.buffer;
 Object.defineProperty(buffer, "byteLength", { get() { assert.fail("Shadowed length observed"); } });
 assert.deepEqual(readScopeDraftFile(buffer, body.length, s.context), s.candidate);
 for (const size of [body.length + 1, -1, 1, 1.5, NaN, Infinity, SCOPE_DRAFT_BYTES + 1]) assert.equal(readScopeDraftFile(buffer, size, s.context), null);
 for (const value of [new ArrayBuffer(SCOPE_DRAFT_BYTES + 1), new SharedArrayBuffer(body.length), Object.create(ArrayBuffer.prototype), { [Symbol.iterator]() { assert.fail("Lookalike iterated"); } }, body]) assert.equal(readScopeDraftFile(value, body.length, s.context), null);
 const detached = new ArrayBuffer(4); structuredClone(detached, { transfer: [detached] }); assert.equal(readScopeDraftFile(detached, 4, s.context), null);
});
test("file decoding refuses invalid UTF-8 BOM trailing bytes duplicate fields and changed comparison evidence", () => {
 const s = saved();
 for (const text of ["\uFEFF" + s.json, s.json + "\n", s.json.replace('"kind": "issue_scope_preparation"', '"kind": "issue_scope_preparation", "kind": "issue_scope_preparation"')]) {
  const body = bytes(text); assert.equal(readScopeDraftFile(body.buffer, body.byteLength, s.context), null);
 }
 const malformed = Uint8Array.of(0x7b, 0xc3, 0x28, 0x7d); assert.equal(readScopeDraftFile(malformed.buffer, malformed.length, s.context), null);
 const changed = structuredClone(s.context); changed.binding.comparisonSha256 = "c".repeat(64); const body = bytes(s.json);
 assert.equal(readScopeDraftFile(body.buffer, body.length, changed), null);
});
