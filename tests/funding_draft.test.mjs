import assert from "node:assert/strict";
import test from "node:test";
import { checkFundingDraft, fundingDraftJson, reopenFundingDraftJson, fundingDraftFromEntries, FUNDING_DRAFT_BYTES } from "../src/funding-draft.ts";
import { fundingContext, emptyFundingDraft, fundingEntry, fundingFields, fundingFormEntries } from "./helpers/funding_draft_fixture.mjs";
import { checkPolicyEventDraft } from "../src/policy-event-draft.ts";
import { publicIssueProjectionSchema } from "../src/public-issue-projection.ts";
const sample = () => { const context = fundingContext(), draft = emptyFundingDraft(context); draft.entries.push(fundingEntry(context)); return { context, draft }; };
test("funding retains exact decimal digits beyond Number precision with independent period currency scale and replacement fields", () => {
  const { context, draft } = sample(), before = structuredClone(draft), out = checkFundingDraft(draft, context);
  assert.deepEqual(out, before); assert.deepEqual(draft, before);
  assert.equal(out.entries[0].fields.amount.value, "9007199254740993.000000001");
  assert.equal(out.entries[0].fields.financialPeriod.value, "FY 2026/27"); assert.equal(out.entries[0].fields.scale.value, "millions");
  assert.equal(out.entries[0].fields.coverage.value, "cumulative"); assert.equal(out.entries[0].fields.revisionRelation.value, "replaces_earlier");
});
test("all four funding stages remain separate records without promotion aggregation or inferred expenditure", () => {
  const { context, draft } = sample(); draft.entries = ["announced", "allocated", "disbursed", "spent"].map(value => {
    const entry = fundingEntry(context, "0.00"); entry.fields.stage.value = value; return entry;
  });
  const out = checkFundingDraft(draft, context); assert.deepEqual(out.entries.map(entry => entry.fields.stage.value), ["announced", "allocated", "disbursed", "spent"]);
  assert.ok(out.entries.every(entry => entry.fields.amount.value === "0.00"));
  assert.doesNotMatch(fundingDraftJson(draft, context), /totalAmount|eligible|accepted|publicationId|convertedAmount/);
});
test("unknown amounts and context do not become zero or a default currency price basis period or scale", () => {
  const { context, draft } = sample(); draft.entries[0].fields = fundingFields();
  assert.ok(Object.values(checkFundingDraft(draft, context).entries[0].fields).every(value => value === null));
  draft.entries[0].fields.amount = fundingEntry(context, "0").fields.amount;
  const out = checkFundingDraft(draft, context); assert.equal(out.entries[0].fields.amount.value, "0"); assert.equal(out.entries[0].fields.currency, null);
});
test("signed decimal spelling is preserved while exponents rounding aliases separators and nonfinite values are refused", () => {
  const { context, draft } = sample();
  for (const amount of ["0", "0.00", "-0.00", "-123.456789123", "999999999999999999999999.123456789"]) {
    draft.entries[0].fields.amount.value = amount; assert.equal(checkFundingDraft(draft, context).entries[0].fields.amount.value, amount);
  }
  for (const amount of ["1e6", "+1", "01", "1,000", "1 000", "1.0000000001", "1.", ".5", "NaN", "Infinity", "1000000000000000000000000", 1]) {
    draft.entries[0].fields.amount.value = amount; assert.equal(checkFundingDraft(draft, context), null);
  }
});
test("funding fields require own exact distinct source occurrences and cannot borrow another statement type", () => {
  const { context, draft } = sample();
  for (const mutate of [v => { v.entries[0].fields.amount.references = []; }, v => { v.entries[0].fields.currency.value = "nok"; },
    v => { v.entries[0].fields.amount.references[0].referenceNumber = 12; }, v => { v.entries[0].fields.stage.references.push(v.entries[0].fields.stage.references[0]); },
    v => { v.entries[0].fields.unknownPrivate = null; }, v => { v.entries[0].approved = true; }, v => { v.entries.push(structuredClone(v.entries[0])); }]) {
    const value = structuredClone(draft); mutate(value); assert.equal(checkFundingDraft(value, context), null);
  }
  const other = structuredClone(context); other.claims[0].type = "policy_action"; assert.equal(checkFundingDraft(draft, other), null);
});
test("bound source comparison changes exact copied JSON byte aliases and cross-format substitution remain held", () => {
  const { context, draft } = sample(), json = fundingDraftJson(draft, context); assert.deepEqual(reopenFundingDraftJson(json, context), draft);
  for (const key of Object.keys(context.binding)) { const c = structuredClone(context); c.binding[key] = key.endsWith("Sha256") ? "c".repeat(64) : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; assert.equal(reopenFundingDraftJson(json, c), null); }
  for (const text of [json + "\n", JSON.stringify(draft), json.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'),
    json.replace('"NOK"', '"\\u004eOK"')]) assert.equal(reopenFundingDraftJson(text, context), null);
  assert.equal(checkPolicyEventDraft(draft, context), null); assert.equal(publicIssueProjectionSchema.safeParse(draft).success, false);
});
test("four entries and complete UTF8 copy limits are independent of valid field lengths", () => {
  const { context, draft } = sample(); draft.entries = Array.from({ length: 4 }, (_, i) => {
    const entry = fundingEntry(context, String(i)); for (const key of ["financialPeriod", "priceBasePeriod"]) entry.fields[key].value = "😀".repeat(240);
    for (const field of Object.values(entry.fields)) field.references = [1, 2].map(referenceNumber => ({ claimId: context.claims[0].id, referenceNumber })); return entry;
  });
  assert.ok(checkFundingDraft(draft, context)); assert.equal(fundingDraftJson(draft, context), null);
  draft.entries.push(fundingEntry(context, "8")); assert.equal(checkFundingDraft(draft, context), null);
  assert.equal(reopenFundingDraftJson(" ".repeat(FUNDING_DRAFT_BYTES + 1), context), null);
});
test("bounded named controls preserve exact monetary strings and hold missing duplicated foreign or stray unknown-field inputs", () => {
  const c = fundingContext(), pairs = fundingFormEntries(c), out = fundingDraftFromEntries(pairs, [1], c);
  assert.equal(out.entries[0].fields.amount.value, "9007199254740993.000000001");
  for (const value of [pairs.slice(1), [...pairs, pairs[0]], [...pairs, ["1.private", "PRIVATE"]],
    pairs.map(([key, value]) => [key, key === "1.currency" ? "" : value]), pairs.map(([key, value]) => [key, key === "1.amount" ? "1e6" : value])])
    assert.equal(fundingDraftFromEntries(value, [1], c), null);
  assert.equal(fundingDraftFromEntries({ *[Symbol.iterator]() { while (true) yield pairs[0]; } }, [1], c), null);
});
