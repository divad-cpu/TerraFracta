import assert from "node:assert/strict";
import test from "node:test";
import { checkIndicatorDraft, indicatorDraftJson, reopenIndicatorDraftJson, indicatorDraftFromEntries,
  indicatorBasisDifferences, indicatorMissingReasons, INDICATOR_DRAFT_BYTES } from "../src/indicator-draft.ts";
import { indicatorContext, indicatorFields, indicatorEntry, emptyIndicatorDraft, indicatorFormEntries } from "./helpers/indicator_draft_fixture.mjs";
import { publicIssueProjectionSchema } from "../src/public-issue-projection.ts";
import { checkFundingDraft } from "../src/funding-draft.ts";
const sample = () => { const context = indicatorContext(), draft = emptyIndicatorDraft(context); draft.entries.push(indicatorEntry(context)); return { context, draft }; };

test("indicator preparation keeps series definition unit denominator observation period and vintage separate without numeric coercion", () => {
  const { context, draft } = sample(), before = structuredClone(draft), value = checkIndicatorDraft(draft, context);
  assert.deepEqual(value, before); assert.deepEqual(draft, before);
  assert.equal(value.entries[0].fields.value.value, "9007199254740993.000000001");
  assert.equal(value.entries[0].fields.observationPeriod.value, "fieldwork interval 2024/25");
  assert.equal(value.entries[0].fields.vintage.value, "revised edition B");
  assert.equal(value.entries[0].fields.denominator.value, "responding sample, exclusions stated by source");
  assert.doesNotMatch(indicatorDraftJson(value, context), /trend|increase|decrease|eligible|accepted|publicationId|calculated|interpolated/);
});
test("unknown value metadata and reason stay null while explicitly referenced zero remains exact", () => {
  const { context, draft } = sample(); draft.entries[0].fields = indicatorFields();
  assert.ok(Object.values(checkIndicatorDraft(draft, context).entries[0].fields).every(field => field === null));
  for (const text of ["0", "0.00", "-0", "-0.000000000"]) {
    draft.entries[0].fields.value = indicatorEntry(context, text).fields.value;
    const value = checkIndicatorDraft(draft, context); assert.equal(value.entries[0].fields.value.value, text);
    assert.equal(value.entries[0].fields.missingReason, null); assert.equal(value.entries[0].fields.denominator, null);
  }
});
test("all five source-stated missing reasons retain references and exclude a simultaneous observation", () => {
  const { context, draft } = sample();
  for (const reason of Object.keys(indicatorMissingReasons)) {
    draft.entries[0].fields.missingReason = { value: reason, references: [{ claimId: context.claims[0].id, referenceNumber: 2 }] };
    assert.equal(checkIndicatorDraft(draft, context), null);
    draft.entries[0].fields.value = null;
    const out = checkIndicatorDraft(draft, context); assert.equal(out.entries[0].fields.missingReason.value, reason); assert.equal(out.entries[0].fields.value, null);
    draft.entries[0].fields.value = indicatorEntry(context).fields.value;
  }
  draft.entries[0].fields.value = null; draft.entries[0].fields.missingReason.value = "unknown"; assert.equal(checkIndicatorDraft(draft, context), null);
});
test("decimal grammar retains large negative fractional spellings and refuses exponent grouping nonfinite or implicit rounding", () => {
  const { context, draft } = sample();
  for (const value of ["-123.456789123", "999999999999999999999999.123456789", "1.00"]) {
    draft.entries[0].fields.value.value = value; assert.equal(checkIndicatorDraft(draft, context).entries[0].fields.value.value, value);
  }
  for (const value of [1, "01", "+1", "1e3", "1,000", "1 000", ".5", "1.", "NaN", "Infinity", "1.1234567890", "1000000000000000000000000"]) {
    draft.entries[0].fields.value.value = value; assert.equal(checkIndicatorDraft(draft, context), null);
  }
});
test("only measured-condition and attributed-finding statements can own indicator entries without changing reference roles", () => {
  const { context, draft } = sample();
  for (const type of ["condition", "attributed_finding"]) {
    const next = structuredClone(context); next.claims[0].type = type;
    assert.ok(checkIndicatorDraft(draft, next)); assert.equal(next.claims[0].evidence[1].relation, "contradicts");
  }
  for (const type of ["policy_action", "funding", "delivery", "evaluation"]) {
    const next = structuredClone(context); next.claims[0].type = type; assert.equal(checkIndicatorDraft(draft, next), null);
  }
});
test("every supplied field requires exact distinct captured occurrences and strict closed keys", () => {
  const { context, draft } = sample();
  for (const mutate of [v => { v.entries[0].fields.definition.references = []; }, v => { v.entries[0].fields.unit.references[0].referenceNumber = 12; },
    v => { v.entries[0].fields.population.references.push(v.entries[0].fields.population.references[0]); },
    v => { v.entries[0].fields.frequency.references[0].claimId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; },
    v => { v.entries[0].fields.approved = true; }, v => { v.entries[0].reviewed = true; }, v => { v.entries.push(structuredClone(v.entries[0])); }]) {
    const next = structuredClone(draft); mutate(next); assert.equal(checkIndicatorDraft(next, context), null);
  }
});
test("copied indicator JSON reopens only with the exact captured binding spelling format and field representation", () => {
  const { context, draft } = sample(), json = indicatorDraftJson(draft, context);
  assert.deepEqual(reopenIndicatorDraftJson(json, context), draft);
  for (const name of Object.keys(context.binding)) {
    const next = structuredClone(context); next.binding[name] = name.endsWith("Sha256") ? "c".repeat(64) : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assert.equal(reopenIndicatorDraftJson(json, next), null);
  }
  for (const text of [json + "\n", JSON.stringify(draft), json.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'),
    json.replace('"unadjusted"', '"\\u0075nadjusted"')]) assert.equal(reopenIndicatorDraftJson(text, context), null);
  assert.equal(checkFundingDraft(draft, context), null); assert.equal(publicIssueProjectionSchema.safeParse(draft).success, false);
});
test("complete UTF8 copy limit remains separate from valid per-field bounds and four-entry shape", () => {
  const { context, draft } = sample();
  draft.entries = Array.from({ length: 4 }, (_, i) => { const entry = indicatorEntry(context, String(i)); entry.fields.definition.value = "😀".repeat(600); return entry; });
  assert.ok(checkIndicatorDraft(draft, context)); assert.equal(indicatorDraftJson(draft, context), null);
  draft.entries.push(indicatorEntry(context, "5")); assert.equal(checkIndicatorDraft(draft, context), null);
  assert.equal(reopenIndicatorDraftJson(" ".repeat(INDICATOR_DRAFT_BYTES + 1), context), null);
});
test("bounded named input retains independently referenced metadata and refuses foreign duplicated missing and stray unknown-field controls", () => {
  const c = indicatorContext(), pairs = indicatorFormEntries(c), out = indicatorDraftFromEntries(pairs, [1], c);
  assert.equal(out.entries[0].fields.value.value, "9007199254740993.000000001");
  for (const value of [pairs.slice(1), [...pairs, pairs[0]], [...pairs, ["1.private", "PRIVATE"]],
    pairs.map(([key, value]) => [key, key === "1.unit" ? "" : value]), pairs.map(([key, value]) => [key, key === "1.value" ? "1e3" : value])])
    assert.equal(indicatorDraftFromEntries(value, [1], c), null);
  assert.equal(indicatorDraftFromEntries({ *[Symbol.iterator]() { while (true) yield pairs[0]; } }, [1], c), null);
  assert.equal(indicatorDraftFromEntries(pairs, [1, 1], c), null);
});
test("basis inspection separately exposes partial coverage and different supplied definitions without merging versions", () => {
  const { context, draft } = sample(), second = indicatorEntry(context, "2"), third = indicatorEntry(context, "3");
  second.fields.definitionVersion.value = "definition 3"; third.fields.definitionVersion = null;
  draft.entries.push(second, third);
  const out = indicatorBasisDifferences(draft, context), version = out.find(row => row.field === "definitionVersion");
  assert.deepEqual(version, { field: "definitionVersion", values: ["definition 2", "definition 3", null], coverage: "some", spelling: "different_text" });
  assert.deepEqual(out.find(row => row.field === "unit"), { field: "unit", values: Array(3).fill("percent; no multiplication applied"), coverage: "all", spelling: "same_spelling" });
  assert.doesNotMatch(JSON.stringify(out), /comparable|trend|calculation|direction|baseline|causal/);
});
test("zero one and wholly unknown entry bases do not pretend to compare two observations", () => {
  const { context, draft } = sample();
  assert.ok(indicatorBasisDifferences(draft, context).every(row => row.spelling === "one_text"));
  draft.entries[0].fields = indicatorFields();
  assert.ok(indicatorBasisDifferences(draft, context).every(row => row.coverage === "none" && row.spelling === "no_text"));
  draft.entries = []; assert.ok(indicatorBasisDifferences(draft, context).every(row => row.values.length === 0 && row.coverage === "none" && row.spelling === "no_text"));
});
test("metadata inspection keeps source order case revisions and unsupported copies distinct without touching values", () => {
  const { context, draft } = sample(), second = indicatorEntry(context, "-5.000");
  second.fields.sourceSeries.value = "Fictional series A"; second.fields.vintage.value = "earlier-looking label, not a chronology";
  draft.entries.unshift(second); const before = structuredClone(draft), out = indicatorBasisDifferences(draft, context);
  assert.deepEqual(out.find(row => row.field === "sourceSeries").values, ["Fictional series A", "fictional series A"]);
  assert.equal(out.find(row => row.field === "sourceSeries").spelling, "different_text"); assert.deepEqual(draft, before);
  draft.entries[0].fields.value.references = []; assert.equal(indicatorBasisDifferences(draft, context), null);
});
