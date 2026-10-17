import assert from "node:assert/strict";
import test from "node:test";
import { responsibilityDraftFieldFeedback, checkResponsibilityDraft, responsibilityDraftJson } from "../src/responsibility-draft.ts";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";
const context = () => capturedScopeDraftContext(proposalReport());
const fields = () => ({ institution: null, governmentLevel: null, role: null, period: null });
const entry = c => ({ claimId: c.claims[0].id, fields: fields() });
const candidate = c => ({ schemaVersion: 1, kind: "responsibility_preparation", binding: c.binding, entries: [entry(c)] });
test("fixed feedback identifies wording and occurrence failures independently without accepting the draft", () => {
 const c = context(), draft = candidate(c); draft.entries[0].fields.institution = { wording: " ", references: [{ claimId: proposalId(99), referenceNumber: 1 }] };
 const before = structuredClone(draft), hints = responsibilityDraftFieldFeedback(draft, c);
 assert.deepEqual(hints.entries[0].fields.institution, { wording: true, references: true });
 assert.deepEqual(hints.entries[0].fields.role, { wording: false, references: false }); assert.equal(hints.entries[0].statement, false);
 assert.equal(checkResponsibilityDraft(draft, c), null); assert.deepEqual(draft, before);
});
test("unknown fields valid multiple roles exact missing statement and repeated entry are distinct editing states", () => {
 const c = context(), draft = candidate(c); const valid = responsibilityDraftFieldFeedback(draft, c);
 assert.ok(Object.values(valid.entries[0].fields).every(hint => !hint.wording && !hint.references));
 draft.entries.push(structuredClone(draft.entries[0])); assert.equal(responsibilityDraftFieldFeedback(draft, c).entries[1].duplicate, true);
 draft.entries[1].fields.role = { wording: "Another invented role", references: [{ claimId: c.claims[0].id, referenceNumber: 1 }] };
 assert.equal(responsibilityDraftFieldFeedback(draft, c).entries[1].duplicate, false); assert.ok(checkResponsibilityDraft(draft, c));
 draft.entries[1].claimId = ""; assert.equal(responsibilityDraftFieldFeedback(draft, c).entries[1].statement, true);
 draft.entries[1].claimId = proposalId(99); assert.equal(responsibilityDraftFieldFeedback(draft, c).entries[1].statement, true);
});
test("opaque malformed headers fields and hostile getters cannot become user text or misleading field approval", () => {
 const c = context(), draft = candidate(c);
 for (const bad of [null, [], { ...draft, secret: "PRIVATE" }, { ...draft, kind: "accepted" }, { ...draft, binding: { ...draft.binding, captureId: proposalId(99) } },
  { ...draft, entries: [{ ...draft.entries[0], fields: { ...fields(), secret: "PRIVATE" } }] }, new Proxy({}, { get() { throw Error("PRIVATE"); } })])
  assert.equal(responsibilityDraftFieldFeedback(bad, c), null);
});
test("field feedback preserves valid 1200-point Unicode wording and leaves the complete UTF8 quota authoritative", () => {
 const c = context(), draft = candidate(c);
 draft.entries = Array.from({ length: 8 }, (_, i) => ({ ...entry(c), fields: { ...fields(), institution: { wording: String(i) + "😀".repeat(1199), references: [{ claimId: c.claims[0].id, referenceNumber: 1 }] } } }));
 const hints = responsibilityDraftFieldFeedback(draft, c); assert.ok(hints.entries.every(entry => !entry.fields.institution.wording && !entry.fields.institution.references && !entry.duplicate));
 assert.ok(checkResponsibilityDraft(draft, c)); assert.equal(responsibilityDraftJson(draft, c), null);
 draft.entries[0].fields.institution.wording += "😀"; assert.equal(responsibilityDraftFieldFeedback(draft, c).entries[0].fields.institution.wording, true);
});
test("excess rows have one fixed global hint while repeated or malformed reference choices flag only their supplied field", () => {
 const c = context(), draft = candidate(c), reference = { claimId: c.claims[0].id, referenceNumber: 1 };
 draft.entries[0].fields.period = { wording: "2024", references: [reference, reference] };
 let hint = responsibilityDraftFieldFeedback(draft, c); assert.deepEqual(hint.entries[0].fields.period, { wording: false, references: true });
 draft.entries[0].fields.period.references = [null]; hint = responsibilityDraftFieldFeedback(draft, c); assert.equal(hint.entries[0].fields.period.references, true);
 draft.entries = Array.from({ length: 9 }, () => entry(c)); assert.deepEqual(responsibilityDraftFieldFeedback(draft, c), { entries: [], tooMany: true });
});
