import assert from "node:assert/strict";
import test from "node:test";
import { checkDeliveryDraft, deliveryDraftJson, reopenDeliveryDraftJson,
  deliveryDraftFromEntries, DELIVERY_DRAFT_BYTES, deliveryStages } from "../src/delivery-draft.ts";
import { preparedEventDateLabel } from "../src/policy-event-draft.ts";
import { publicIssueProjectionSchema } from "../src/public-issue-projection.ts";
import { checkResponsibilityDraft } from "../src/responsibility-draft.ts";
import { deliveryContext, emptyDeliveryDraft, deliveryEntry, deliveryFormEntries } from "./helpers/delivery_draft_fixture.mjs";
const sample = () => { const context = deliveryContext(), draft = emptyDeliveryDraft(context); draft.entries.push(deliveryEntry(context)); return { context, draft }; };

test("a completed source-described stage does not fill missing coverage authority dates or other stages", () => {
  const { context, draft } = sample(); draft.entries[0].fields = { stage: { value: "completed", references: [{ claimId: context.claims[0].id, referenceNumber: 1 }] },
    description: null, coverage: null, eventDate: null, reportedDate: null };
  const out = checkDeliveryDraft(draft, context); assert.deepEqual(out, draft);
  assert.equal(out.entries[0].fields.coverage, null); assert.equal(out.entries[0].fields.eventDate, null);
  assert.doesNotMatch(deliveryDraftJson(draft, context), /currentGovernment|funding|population|percentComplete|inferred|operating/);
});
test("documented coverage stays exact and separately referenced rather than being inferred from stage or source publisher", () => {
  const { context, draft } = sample();
  draft.entries[0].fields.coverage = { wording: "Only two fictional districts, excluding other areas", references: [{ claimId: context.claims[0].id, referenceNumber: 1 }] };
  assert.equal(checkDeliveryDraft(draft, context).entries[0].fields.coverage.wording, "Only two fictional districts, excluding other areas");
  for (const mutate of [v => { v.entries[0].fields.coverage.references = []; }, v => { v.entries[0].fields.coverage.references[0].referenceNumber = 12; },
    v => { v.entries[0].fields.coverage.wording = " "; }, v => { v.entries[0].fields.coverage.national = true; }]) {
    const next = structuredClone(draft); mutate(next); assert.equal(checkDeliveryDraft(next, context), null);
  }
});

test("captured delivery-event preparation preserves separate event and reporting dates unknowns and original conflicting references", () => {
  const { context, draft } = sample(), before = structuredClone(draft), out = checkDeliveryDraft(draft, context);
  assert.deepEqual(out, before); assert.deepEqual(draft, before);
  assert.equal(out.entries[0].fields.eventDate.date.value, "2030"); assert.equal(out.entries[0].fields.reportedDate.date.value, "2026-09-27");
  assert.equal(context.claims[0].evidence[1].relation, "contradicts"); assert.equal(out.entries[0].fields.stage.references[0].referenceNumber, 2);
  assert.equal(out.entries[0].fields.description, null);
});
test("each documented delivery stage remains distinct with no chronology status or clock inference", () => {
  const { context, draft } = sample(); draft.entries = Object.keys(deliveryStages).map(value => ({ ...deliveryEntry(context), fields: { ...deliveryEntry(context).fields,
    stage: { ...deliveryEntry(context).fields.stage, value } } }));
  assert.deepEqual(checkDeliveryDraft(draft, context).entries.map(entry => entry.fields.stage.value), Object.keys(deliveryStages));
  draft.entries.reverse(); assert.deepEqual(checkDeliveryDraft(draft, context).entries.map(entry => entry.fields.stage.value), Object.keys(deliveryStages).reverse());
  assert.doesNotMatch(deliveryDraftJson(draft, context), /approved|accepted|publicationId|retrievedAt|progressScore/);
});
test("known precision stays exact and invalid calendar aliases unknown placeholders or extra private dates are refused", () => {
  const { context, draft } = sample();
  for (const [date, expected] of [[{ precision: "day", value: "2024-02-29" }, "2024-02-29 (exact day)"],
    [{ precision: "month", value: "2026-08" }, "2026-08 (month only)"], [{ precision: "year", value: "2030" }, "2030 (year only)"],
    [{ precision: "period", label: "Source-defined winter term" }, "Source-defined winter term (stated period)"]]) {
    draft.entries[0].fields.eventDate.date = date; assert.ok(checkDeliveryDraft(draft, context)); assert.equal(preparedEventDateLabel(date), expected);
  }
  for (const date of [{ precision: "day", value: "2023-02-29" }, { precision: "month", value: "2026-13" }, { precision: "year", value: "2030-01-01" },
    { precision: "day", value: "2030-01-01T00:00:00Z" }, { precision: "period", label: " " }, { precision: "not_supplied" }, { precision: "year", value: "2030", private: true }]) {
    draft.entries[0].fields.eventDate.date = date; assert.equal(checkDeliveryDraft(draft, context), null);
  }
});
test("all-null fields and empty lists preserve unknowns without inventing absence of action", () => {
  const { context, draft } = sample(); draft.entries[0].fields = { stage: null, description: null, coverage: null, eventDate: null, reportedDate: null };
  assert.deepEqual(checkDeliveryDraft(draft, context), draft); draft.entries = []; assert.deepEqual(checkDeliveryDraft(draft, context), draft);
});
test("only delivery statement associations and exact distinct field occurrences can be prepared", () => {
  const { context, draft } = sample();
  for (const mutate of [v => { v.entries[0].claimId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; },
    v => { v.entries[0].fields.stage.references = []; }, v => { v.entries[0].fields.eventDate.references[0].referenceNumber = 12; },
    v => { v.entries[0].fields.reportedDate.references.push(v.entries[0].fields.reportedDate.references[0]); },
    v => { v.entries[0].fields.stage.value = "funded"; }, v => { v.entries.push(structuredClone(v.entries[0])); },
    v => { v.entries[0].accepted = true; }, v => { v.privateNote = "PRIVATE"; }]) {
    const value = structuredClone(draft); mutate(value); assert.equal(checkDeliveryDraft(value, context), null);
  }
  const other = structuredClone(context); other.claims[0].type = "condition"; assert.equal(checkDeliveryDraft(draft, other), null);
});
test("every captured binding participates and case-alias statement identities remain refused", () => {
  const { context, draft } = sample(), json = deliveryDraftJson(draft, context);
  for (const field of Object.keys(context.binding)) {
    const changed = structuredClone(context); changed.binding[field] = field.endsWith("Sha256") ? "c".repeat(64) : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assert.equal(checkDeliveryDraft(draft, changed), null); assert.equal(reopenDeliveryDraftJson(json, changed), null);
  }
  const aliases = structuredClone(context); aliases.claims.push({ ...aliases.claims[0], id: aliases.claims[0].id.toUpperCase() }); assert.equal(checkDeliveryDraft(draft, aliases), null);
});
test("only exact canonical copied JSON reopens and cannot become another preparation or public contract", () => {
  const { context, draft } = sample(), json = deliveryDraftJson(draft, context);
  assert.deepEqual(reopenDeliveryDraftJson(json, context), draft);
  for (const text of [json + "\n", JSON.stringify(draft), json.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'),
    json.replace('"value": "2030"', '"value": "\\u0032030"'), json.replace('"delivery_preparation"', '"responsibility_preparation"')])
    assert.equal(reopenDeliveryDraftJson(text, context), null);
  assert.equal(checkResponsibilityDraft(draft, context), null); assert.equal(publicIssueProjectionSchema.safeParse(draft).success, false);
});
test("entry code-point and total UTF8 limits hold independently", () => {
  const { context, draft } = sample(); draft.entries[0].fields.description = { wording: "😀".repeat(1200), references: draft.entries[0].fields.stage.references };
  assert.ok(deliveryDraftJson(draft, context)); draft.entries[0].fields.description.wording += "😀"; assert.equal(checkDeliveryDraft(draft, context), null);
  draft.entries = Array.from({ length: 8 }, (_, i) => { const entry = deliveryEntry(context); entry.fields.description = { wording: String(i) + "😀".repeat(1199), references: entry.fields.stage.references }; return entry; });
  assert.ok(checkDeliveryDraft(draft, context)); assert.equal(deliveryDraftJson(draft, context), null);
  draft.entries.push(deliveryEntry(context)); assert.equal(checkDeliveryDraft(draft, context), null);
  assert.equal(reopenDeliveryDraftJson(" ".repeat(DELIVERY_DRAFT_BYTES + 1), context), null);
});
test("bounded form entries preserve source precision and refuse duplicate foreign hidden or incomplete controls", () => {
  const context = deliveryContext(), input = deliveryFormEntries(context), value = deliveryDraftFromEntries(input, [1], context);
  assert.equal(value.entries[0].fields.eventDate.date.value, "2030"); assert.equal(value.entries[0].fields.reportedDate, null);
  const variants = [input.slice(1), [...input, input[0]], [...input, ["1.private", "PRIVATE"]], [...input, ["1.descriptionReferences", "UNKNOWN"]],
    input.map(([k, v]) => [k, k === "1.eventPrecision" ? "day" : v]), input.map(([k, v]) => [k, k === "1.reportedValue" ? "2030" : v]), [...input, ["1.coverageReferences", "UNKNOWN"]]];
  for (const entries of variants) assert.equal(deliveryDraftFromEntries(entries, [1], context), null);
  assert.equal(deliveryDraftFromEntries(input, [1, 1], context), null);
  assert.equal(deliveryDraftFromEntries({ *[Symbol.iterator]() { while (true) yield input[0]; } }, [1], context), null);
  assert.equal(deliveryDraftFromEntries({ [Symbol.iterator]() { throw Error("PRIVATE"); } }, [1], context), null);
});
