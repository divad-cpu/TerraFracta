import assert from "node:assert/strict";
import test from "node:test";
import { fundingDraftFieldFeedback, fundingDraftFeedbackFromEntries, fundingDraftFromEntries, checkFundingDraft, fundingDraftJson,
  fundingFieldLabels } from "../src/funding-draft.ts";
import { fundingContext, fundingEntry, emptyFundingDraft, fundingFormEntries } from "./helpers/funding_draft_fixture.mjs";
const sample = () => { const context = fundingContext(), draft = emptyFundingDraft(context); draft.entries.push(fundingEntry(context)); return { context, draft }; };
const clean = feedback => feedback.entries.every(row => !row.statement && !row.duplicate && Object.values(row.fields).every(field => !field.value && !field.references));
test("valid fixed funding feedback contains only booleans and size classes without changing or qualifying the draft", () => {
  const { context, draft } = sample(), before = structuredClone(draft), feedback = fundingDraftFieldFeedback(draft, context);
  assert.ok(clean(feedback)); assert.equal(feedback.size, null); assert.equal(feedback.tooMany, false); assert.deepEqual(draft, before);
  assert.doesNotMatch(JSON.stringify(feedback), /fictional|definition 2|9007199254740993|claimId|accepted|eligible|approved/);
});
test("an invalid value does not hide a separately foreign reference on the same field", () => {
  const { context, draft } = sample(); draft.entries[0].fields.amount.value = "1e6"; draft.entries[0].fields.amount.references[0].referenceNumber = 12;
  const hint = fundingDraftFieldFeedback(draft, context).entries[0]; assert.deepEqual(hint.fields.amount, { value: true, references: true });
  assert.deepEqual(hint.fields.financialPeriod, { value: false, references: false }); assert.equal(checkFundingDraft(draft, context), null);
});
test("each supplied field uses its existing schema and independently reports missing distinct exact references", () => {
  const { context, draft } = sample();
  for (const name of Object.keys(fundingFieldLabels)) {
    const input = structuredClone(draft);
    input.entries[0].fields[name].references = [];
    const feedback = fundingDraftFieldFeedback(input, context); assert.equal(feedback.entries[0].fields[name].references, true, name);
    assert.equal(checkFundingDraft(input, context), null);
  }
  draft.entries[0].fields.financialPeriod.references.push(draft.entries[0].fields.financialPeriod.references[0]);
  assert.equal(fundingDraftFieldFeedback(draft, context).entries[0].fields.financialPeriod.references, true);
});
test("association duplication and row limits stay separate from field grammar", () => {
  const { context, draft } = sample(); draft.entries.push(structuredClone(draft.entries[0]));
  let feedback = fundingDraftFieldFeedback(draft, context); assert.deepEqual(feedback.entries.map(row => row.duplicate), [false, true]);
  draft.entries[0].claimId = ""; feedback = fundingDraftFieldFeedback(draft, context); assert.equal(feedback.entries[0].statement, true);
  draft.entries = Array.from({ length: 5 }, () => fundingEntry(context));
  assert.deepEqual(fundingDraftFieldFeedback(draft, context), { entries: [], tooMany: true, size: null });
});
test("individual valid fields are not marked wrong when the whole encoded copy is too large", () => {
  const { context, draft } = sample(); draft.entries = Array.from({ length: 4 }, (_, i) => {
    const entry = fundingEntry(context, String(i)); for (const key of ["financialPeriod", "priceBasePeriod"]) entry.fields[key].value = "😀".repeat(240);
    for (const field of Object.values(entry.fields)) if (field) field.references = [1, 2].map(referenceNumber => ({ claimId: context.claims[0].id, referenceNumber })); return entry;
  });
  assert.ok(checkFundingDraft(draft, context)); assert.equal(fundingDraftJson(draft, context), null);
  const feedback = fundingDraftFieldFeedback(draft, context); assert.equal(feedback.size, "copy"); assert.ok(clean(feedback));
});
test("named input feedback preserves empty-value with selected references as an editing error while authoritative output stays refused", () => {
  const c = fundingContext(), pairs = fundingFormEntries(c).map(([key, value]) => [key, key === "1.financialPeriod" ? "" : value]);
  assert.equal(fundingDraftFromEntries(pairs, [1], c), null);
  const feedback = fundingDraftFeedbackFromEntries(pairs, [1], c); assert.equal(feedback.entries[0].fields.financialPeriod.value, true);
  assert.equal(feedback.entries[0].fields.financialPeriod.references, false);
  assert.deepEqual(fundingDraftFeedbackFromEntries([["1.claim", "x".repeat(16_385)]], [1], c), { entries: [], tooMany: false, size: "input" });
});
test("unknown keys malformed control structure throwing values and changed bindings get only the generic fallback", () => {
  const { context, draft } = sample();
  for (const mutate of [value => { value.private = "PRIVATE"; }, value => { value.entries[0].fields.private = null; },
    value => { value.binding.comparisonSha256 = "c".repeat(64); }, value => { value.entries[0].fields.financialPeriod = "PRIVATE"; }]) {
    const value = structuredClone(draft); mutate(value); assert.equal(fundingDraftFieldFeedback(value, context), null);
  }
  assert.equal(fundingDraftFieldFeedback(new Proxy({}, { get() { throw Error("PRIVATE"); }, ownKeys() { throw Error("PRIVATE"); } }), context), null);
  assert.equal(fundingDraftFeedbackFromEntries([["1.private", "PRIVATE"]], [1], context), null);
  assert.deepEqual(fundingDraftFeedbackFromEntries({ *[Symbol.iterator]() { while (true) yield ["1.claim", context.claims[0].id]; } }, [1], context), { entries: [], tooMany: false, size: "input" });
});
test("valid controlled entries and captured context are observed consistently and preserve the previous exact exported format", () => {
  const c = fundingContext(), pairs = fundingFormEntries(c), before = structuredClone(c), original = fundingDraftFromEntries(pairs, [1], c);
  assert.ok(original); assert.ok(clean(fundingDraftFeedbackFromEntries(pairs, [1], c))); assert.deepEqual(c, before);
  assert.equal(fundingDraftJson(original, c), JSON.stringify({ schemaVersion: 1, kind: "funding_preparation", binding: c.binding, entries: [fundingEntry(c)] }, null, 2));
});

test("monetary spellings are diagnosed without rounding currency guessing or mutation of either interpretation", () => {
  const { context, draft } = sample(); draft.entries[0].fields.amount.value = "1,000.00"; draft.entries[0].fields.currency.value = "nok";
  const before = structuredClone(draft), hint = fundingDraftFieldFeedback(draft, context).entries[0];
  assert.deepEqual(hint.fields.amount, { value: true, references: false });
  assert.deepEqual(hint.fields.currency, { value: true, references: false }); assert.deepEqual(draft, before);
  assert.equal(checkFundingDraft(draft, context), null);
  for (const amount of ["-0.00", "9007199254740993.000000001", "999999999999999999999999.123456789"]) {
    const value = structuredClone(before); value.entries[0].fields.amount.value = amount; value.entries[0].fields.currency.value = "NOK";
    assert.ok(clean(fundingDraftFieldFeedback(value, context))); assert.equal(checkFundingDraft(value, context).entries[0].fields.amount.value, amount);
  }
});
