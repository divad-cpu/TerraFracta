import assert from "node:assert/strict";
import test from "node:test";
import { indicatorDraftFieldFeedback, indicatorDraftFeedbackFromEntries, indicatorDraftFromEntries, checkIndicatorDraft, indicatorDraftJson,
  indicatorFieldLabels } from "../src/indicator-draft.ts";
import { indicatorContext, indicatorEntry, emptyIndicatorDraft, indicatorFormEntries } from "./helpers/indicator_draft_fixture.mjs";
const sample = () => { const context = indicatorContext(), draft = emptyIndicatorDraft(context); draft.entries.push(indicatorEntry(context)); return { context, draft }; };
const clean = feedback => feedback.entries.every(row => !row.statement && !row.duplicate && !row.valueAndMissingReason && Object.values(row.fields).every(field => !field.value && !field.references));
test("valid fixed indicator feedback contains only booleans and size classes without changing or qualifying the draft", () => {
  const { context, draft } = sample(), before = structuredClone(draft), feedback = indicatorDraftFieldFeedback(draft, context);
  assert.ok(clean(feedback)); assert.equal(feedback.size, null); assert.equal(feedback.tooMany, false); assert.deepEqual(draft, before);
  assert.doesNotMatch(JSON.stringify(feedback), /fictional|definition 2|9007199254740993|claimId|accepted|eligible|approved/);
});
test("an invalid value does not hide a separately foreign reference on the same field", () => {
  const { context, draft } = sample(); draft.entries[0].fields.value.value = "1e6"; draft.entries[0].fields.value.references[0].referenceNumber = 12;
  const hint = indicatorDraftFieldFeedback(draft, context).entries[0]; assert.deepEqual(hint.fields.value, { value: true, references: true });
  assert.deepEqual(hint.fields.unit, { value: false, references: false }); assert.equal(checkIndicatorDraft(draft, context), null);
});
test("each supplied field uses its existing schema and independently reports missing distinct exact references", () => {
  const { context, draft } = sample();
  for (const name of Object.keys(indicatorFieldLabels)) {
    const input = structuredClone(draft);
    if (name === "missingReason") { input.entries[0].fields.value = null; input.entries[0].fields.missingReason = { value: "withheld", references: [] }; }
    else input.entries[0].fields[name].references = [];
    const feedback = indicatorDraftFieldFeedback(input, context); assert.equal(feedback.entries[0].fields[name].references, true, name);
    assert.equal(checkIndicatorDraft(input, context), null);
  }
  draft.entries[0].fields.unit.references.push(draft.entries[0].fields.unit.references[0]);
  assert.equal(indicatorDraftFieldFeedback(draft, context).entries[0].fields.unit.references, true);
});
test("supplied value and missing reason both receive fixed feedback without deleting either interpretation", () => {
  const { context, draft } = sample(); draft.entries[0].fields.missingReason = { value: "withheld", references: draft.entries[0].fields.value.references };
  const before = structuredClone(draft), row = indicatorDraftFieldFeedback(draft, context).entries[0];
  assert.equal(row.valueAndMissingReason, true); assert.equal(row.fields.value.value, true); assert.equal(row.fields.missingReason.value, true);
  assert.deepEqual(draft, before); assert.equal(checkIndicatorDraft(draft, context), null);
});
test("association duplication and row limits stay separate from field grammar", () => {
  const { context, draft } = sample(); draft.entries.push(structuredClone(draft.entries[0]));
  let feedback = indicatorDraftFieldFeedback(draft, context); assert.deepEqual(feedback.entries.map(row => row.duplicate), [false, true]);
  draft.entries[0].claimId = ""; feedback = indicatorDraftFieldFeedback(draft, context); assert.equal(feedback.entries[0].statement, true);
  draft.entries = Array.from({ length: 5 }, () => indicatorEntry(context));
  assert.deepEqual(indicatorDraftFieldFeedback(draft, context), { entries: [], tooMany: true, size: null });
});
test("individual valid fields are not marked wrong when the whole encoded copy is too large", () => {
  const { context, draft } = sample(); draft.entries = Array.from({ length: 3 }, (_, i) => {
    const entry = indicatorEntry(context, String(i)); entry.fields.definition.value = "😀".repeat(600);
    for (const field of Object.values(entry.fields)) if (field) field.references = [1, 2].map(referenceNumber => ({ claimId: context.claims[0].id, referenceNumber })); return entry;
  });
  assert.ok(checkIndicatorDraft(draft, context)); assert.equal(indicatorDraftJson(draft, context), null);
  const feedback = indicatorDraftFieldFeedback(draft, context); assert.equal(feedback.size, "copy"); assert.ok(clean(feedback));
});
test("named input feedback preserves empty-value with selected references as an editing error while authoritative output stays refused", () => {
  const c = indicatorContext(), pairs = indicatorFormEntries(c).map(([key, value]) => [key, key === "1.unit" ? "" : value]);
  assert.equal(indicatorDraftFromEntries(pairs, [1], c), null);
  const feedback = indicatorDraftFeedbackFromEntries(pairs, [1], c); assert.equal(feedback.entries[0].fields.unit.value, true);
  assert.equal(feedback.entries[0].fields.unit.references, false);
  assert.deepEqual(indicatorDraftFeedbackFromEntries([["1.claim", "x".repeat(16_385)]], [1], c), { entries: [], tooMany: false, size: "input" });
});
test("unknown keys malformed control structure throwing values and changed bindings get only the generic fallback", () => {
  const { context, draft } = sample();
  for (const mutate of [value => { value.private = "PRIVATE"; }, value => { value.entries[0].fields.private = null; },
    value => { value.binding.comparisonSha256 = "c".repeat(64); }, value => { value.entries[0].fields.unit = "PRIVATE"; }]) {
    const value = structuredClone(draft); mutate(value); assert.equal(indicatorDraftFieldFeedback(value, context), null);
  }
  assert.equal(indicatorDraftFieldFeedback(new Proxy({}, { get() { throw Error("PRIVATE"); }, ownKeys() { throw Error("PRIVATE"); } }), context), null);
  assert.equal(indicatorDraftFeedbackFromEntries([["1.private", "PRIVATE"]], [1], context), null);
  assert.deepEqual(indicatorDraftFeedbackFromEntries({ *[Symbol.iterator]() { while (true) yield ["1.claim", context.claims[0].id]; } }, [1], context), { entries: [], tooMany: false, size: "input" });
});
test("valid controlled entries and captured context are observed consistently and preserve the previous exact exported format", () => {
  const c = indicatorContext(), pairs = indicatorFormEntries(c), before = structuredClone(c), original = indicatorDraftFromEntries(pairs, [1], c);
  assert.ok(original); assert.ok(clean(indicatorDraftFeedbackFromEntries(pairs, [1], c))); assert.deepEqual(c, before);
  assert.equal(indicatorDraftJson(original, c), JSON.stringify({ schemaVersion: 1, kind: "indicator_preparation", binding: c.binding, entries: [indicatorEntry(c)] }, null, 2));
});
