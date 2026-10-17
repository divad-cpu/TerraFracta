import assert from "node:assert/strict";
import test from "node:test";
import { checkPolicyEventDraft, policyEventDraftJson, reopenPolicyEventDraftJson, preparedEventDateLabel,
  policyEventDraftFromEntries, POLICY_EVENT_DRAFT_BYTES, policyEventKinds } from "../src/policy-event-draft.ts";
import { publicIssueProjectionSchema } from "../src/public-issue-projection.ts";
import { checkResponsibilityDraft } from "../src/responsibility-draft.ts";
import { policyEventContext, emptyPolicyEventDraft, policyEventEntry, policyEventFormEntries } from "./helpers/policy_event_fixture.mjs";
const sample = () => { const context = policyEventContext(), draft = emptyPolicyEventDraft(context); draft.entries.push(policyEventEntry(context)); return { context, draft }; };

test("captured policy-event preparation preserves separate event and reporting dates unknowns and original conflicting references", () => {
  const { context, draft } = sample(), before = structuredClone(draft), out = checkPolicyEventDraft(draft, context);
  assert.deepEqual(out, before); assert.deepEqual(draft, before);
  assert.equal(out.entries[0].fields.eventDate.date.value, "2030"); assert.equal(out.entries[0].fields.reportedDate.date.value, "2026-09-27");
  assert.equal(context.claims[0].evidence[1].relation, "contradicts"); assert.equal(out.entries[0].fields.kind.references[0].referenceNumber, 2);
  assert.equal(out.entries[0].fields.description, null);
});
test("each event kind remains distinct with no chronology status or clock inference", () => {
  const { context, draft } = sample(); draft.entries = Object.keys(policyEventKinds).map(value => ({ ...policyEventEntry(context), fields: { ...policyEventEntry(context).fields,
    kind: { ...policyEventEntry(context).fields.kind, value } } }));
  assert.deepEqual(checkPolicyEventDraft(draft, context).entries.map(entry => entry.fields.kind.value), Object.keys(policyEventKinds));
  draft.entries.reverse(); assert.deepEqual(checkPolicyEventDraft(draft, context).entries.map(entry => entry.fields.kind.value), Object.keys(policyEventKinds).reverse());
  assert.doesNotMatch(policyEventDraftJson(draft, context), /completed|approved|accepted|publicationId|retrievedAt/);
});
test("known precision stays exact and invalid calendar aliases unknown placeholders or extra private dates are refused", () => {
  const { context, draft } = sample();
  for (const [date, expected] of [[{ precision: "day", value: "2024-02-29" }, "2024-02-29 (exact day)"],
    [{ precision: "month", value: "2026-08" }, "2026-08 (month only)"], [{ precision: "year", value: "2030" }, "2030 (year only)"],
    [{ precision: "period", label: "Source-defined winter term" }, "Source-defined winter term (stated period)"]]) {
    draft.entries[0].fields.eventDate.date = date; assert.ok(checkPolicyEventDraft(draft, context)); assert.equal(preparedEventDateLabel(date), expected);
  }
  for (const date of [{ precision: "day", value: "2023-02-29" }, { precision: "month", value: "2026-13" }, { precision: "year", value: "2030-01-01" },
    { precision: "day", value: "2030-01-01T00:00:00Z" }, { precision: "period", label: " " }, { precision: "not_supplied" }, { precision: "year", value: "2030", private: true }]) {
    draft.entries[0].fields.eventDate.date = date; assert.equal(checkPolicyEventDraft(draft, context), null);
  }
});
test("all-null fields and empty lists preserve unknowns without inventing absence of action", () => {
  const { context, draft } = sample(); draft.entries[0].fields = { kind: null, description: null, eventDate: null, reportedDate: null };
  assert.deepEqual(checkPolicyEventDraft(draft, context), draft); draft.entries = []; assert.deepEqual(checkPolicyEventDraft(draft, context), draft);
});
test("only policy-action statement associations and exact distinct field occurrences can be prepared", () => {
  const { context, draft } = sample();
  for (const mutate of [v => { v.entries[0].claimId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; },
    v => { v.entries[0].fields.kind.references = []; }, v => { v.entries[0].fields.eventDate.references[0].referenceNumber = 12; },
    v => { v.entries[0].fields.reportedDate.references.push(v.entries[0].fields.reportedDate.references[0]); },
    v => { v.entries[0].fields.kind.value = "implemented"; }, v => { v.entries.push(structuredClone(v.entries[0])); },
    v => { v.entries[0].accepted = true; }, v => { v.privateNote = "PRIVATE"; }]) {
    const value = structuredClone(draft); mutate(value); assert.equal(checkPolicyEventDraft(value, context), null);
  }
  const other = structuredClone(context); other.claims[0].type = "condition"; assert.equal(checkPolicyEventDraft(draft, other), null);
});
test("every captured binding participates and case-alias statement identities remain refused", () => {
  const { context, draft } = sample(), json = policyEventDraftJson(draft, context);
  for (const field of Object.keys(context.binding)) {
    const changed = structuredClone(context); changed.binding[field] = field.endsWith("Sha256") ? "c".repeat(64) : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assert.equal(checkPolicyEventDraft(draft, changed), null); assert.equal(reopenPolicyEventDraftJson(json, changed), null);
  }
  const aliases = structuredClone(context); aliases.claims.push({ ...aliases.claims[0], id: aliases.claims[0].id.toUpperCase() }); assert.equal(checkPolicyEventDraft(draft, aliases), null);
});
test("only exact canonical copied JSON reopens and cannot become another preparation or public contract", () => {
  const { context, draft } = sample(), json = policyEventDraftJson(draft, context);
  assert.deepEqual(reopenPolicyEventDraftJson(json, context), draft);
  for (const text of [json + "\n", JSON.stringify(draft), json.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'),
    json.replace('"value": "2030"', '"value": "\\u0032030"'), json.replace('"policy_event_preparation"', '"responsibility_preparation"')])
    assert.equal(reopenPolicyEventDraftJson(text, context), null);
  assert.equal(checkResponsibilityDraft(draft, context), null); assert.equal(publicIssueProjectionSchema.safeParse(draft).success, false);
});
test("entry code-point and total UTF8 limits hold independently", () => {
  const { context, draft } = sample(); draft.entries[0].fields.description = { wording: "😀".repeat(1200), references: draft.entries[0].fields.kind.references };
  assert.ok(policyEventDraftJson(draft, context)); draft.entries[0].fields.description.wording += "😀"; assert.equal(checkPolicyEventDraft(draft, context), null);
  draft.entries = Array.from({ length: 8 }, (_, i) => { const entry = policyEventEntry(context); entry.fields.description = { wording: String(i) + "😀".repeat(1199), references: entry.fields.kind.references }; return entry; });
  assert.ok(checkPolicyEventDraft(draft, context)); assert.equal(policyEventDraftJson(draft, context), null);
  draft.entries.push(policyEventEntry(context)); assert.equal(checkPolicyEventDraft(draft, context), null);
  assert.equal(reopenPolicyEventDraftJson(" ".repeat(POLICY_EVENT_DRAFT_BYTES + 1), context), null);
});
test("bounded form entries preserve source precision and refuse duplicate foreign hidden or incomplete controls", () => {
  const context = policyEventContext(), input = policyEventFormEntries(context), value = policyEventDraftFromEntries(input, [1], context);
  assert.equal(value.entries[0].fields.eventDate.date.value, "2030"); assert.equal(value.entries[0].fields.reportedDate, null);
  const variants = [input.slice(1), [...input, input[0]], [...input, ["1.private", "PRIVATE"]], [...input, ["1.descriptionReferences", "UNKNOWN"]],
    input.map(([k, v]) => [k, k === "1.eventPrecision" ? "day" : v]), input.map(([k, v]) => [k, k === "1.reportedValue" ? "2030" : v])];
  for (const entries of variants) assert.equal(policyEventDraftFromEntries(entries, [1], context), null);
  assert.equal(policyEventDraftFromEntries(input, [1, 1], context), null);
  assert.equal(policyEventDraftFromEntries({ *[Symbol.iterator]() { while (true) yield input[0]; } }, [1], context), null);
  assert.equal(policyEventDraftFromEntries({ [Symbol.iterator]() { throw Error("PRIVATE"); } }, [1], context), null);
});
