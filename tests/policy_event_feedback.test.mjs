import assert from "node:assert/strict";
import test from "node:test";
import { policyEventDraftFeedbackFromEntries, policyEventDraftFromEntries, policyEventKinds } from "../src/policy-event-draft.ts";
import { policyEventContext, policyEventFormEntries } from "./helpers/policy_event_fixture.mjs";
const edit = (pairs, key, value) => pairs.map(([name, old]) => [name, name === key ? value : old]);
const feedback = (pairs, context, rows = [1]) => policyEventDraftFeedbackFromEntries(pairs, rows, context);
const clean = () => ({ value: false, references: false });
test("event kind and description need independent exact references without emitting source values", () => {
  const c = policyEventContext(), pairs = edit(policyEventFormEntries(c).filter(([name]) => name !== "1.kindReferences"), "1.description", "PRIVATE_SOURCE_WORDING");
  const before = structuredClone(pairs), hint = feedback(pairs, c);
  assert.deepEqual(hint[1], { statement: false, fields: { kind: { value: false, references: true }, description: { value: false, references: true } } });
  assert.equal(policyEventDraftFromEntries(pairs, [1], c), null); assert.deepEqual(pairs, before);
  assert.doesNotMatch(JSON.stringify(hint), /PRIVATE|claimId|2030|accepted|eligible|approved|87000000/);
});
test("all policy event kinds remain separate source descriptions without inferred occurrence or delivery", () => {
  const c = policyEventContext(), base = policyEventFormEntries(c);
  for (const kind of Object.keys(policyEventKinds)) {
    const pairs = edit(base, "1.kind", kind), hint = feedback(pairs, c), draft = policyEventDraftFromEntries(pairs, [1], c);
    assert.deepEqual(hint[1].fields.kind, clean()); assert.equal(draft.entries[0].fields.kind.value, kind);
    assert.equal(draft.entries[0].fields.description, null); assert.equal(draft.entries[0].fields.reportedDate, null);
    assert.deepEqual(draft.entries[0].fields.eventDate.date, { precision: "year", value: "2030" });
  }
});
test("unknown event fields require blank values and no references while whitespace remains invalid wording", () => {
  const c = policyEventContext(), ref = `${c.claims[0].id}:1`;
  const base = edit(policyEventFormEntries(c).filter(([name]) => name !== "1.kindReferences"), "1.kind", "");
  assert.deepEqual(feedback(base, c)[1].fields, { kind: clean(), description: clean() });
  assert.equal(policyEventDraftFromEntries(base, [1], c).entries[0].fields.kind, null);
  for (const field of ["kind", "description"]) {
    const pairs = [...base, [`1.${field}References`, ref]]; assert.equal(feedback(pairs, c)[1].fields[field].value, true);
    assert.equal(policyEventDraftFromEntries(pairs, [1], c), null);
  }
  assert.deepEqual(feedback(edit(base, "1.description", " \t "), c)[1].fields.description, { value: true, references: true });
});
test("event wording reuses the original code-point and post-trim boundary without input changes", () => {
  const c = policyEventContext(), ref = `${c.claims[0].id}:1`;
  for (const [value, invalid] of [["x".repeat(1200), false], ["x".repeat(1201), true], ["  " + "😀".repeat(1200) + "  ", false], ["😀".repeat(1201), true]]) {
    const pairs = [...edit(policyEventFormEntries(c), "1.description", value), ["1.descriptionReferences", ref]], before = structuredClone(pairs);
    assert.deepEqual(feedback(pairs, c)[1].fields.description, { value: invalid, references: false }); assert.deepEqual(pairs, before);
    assert.equal(policyEventDraftFromEntries(pairs, [1], c) === null, invalid);
  }
});
test("invalid event types and dates cannot conceal missing duplicate or foreign field references", () => {
  const c = policyEventContext(), base = edit(edit(policyEventFormEntries(c), "1.kind", "PRIVATE_KIND"), "1.eventValue", "PRIVATE_DATE");
  for (const refs of [[], ["PRIVATE_REF"], [`${c.claims[0].id}:1`, `${c.claims[0].id}:1`], Array(13).fill(`${c.claims[0].id}:1`)]) {
    const pairs = [...base.filter(([name]) => name !== "1.kindReferences"), ...refs.map(value => ["1.kindReferences", value])];
    assert.deepEqual(feedback(pairs, c)[1].fields.kind, { value: true, references: true }); assert.equal(policyEventDraftFromEntries(pairs, [1], c), null);
  }
});
test("a statement needs the captured policy-action type and a conflict role never establishes new support", () => {
  const c = policyEventContext(), pairs = policyEventFormEntries(c);
  for (const value of ["", "PRIVATE_CLAIM"]) assert.equal(feedback(edit(pairs, "1.claim", value), c)[1].statement, true);
  const wrong = structuredClone(c); wrong.claims[0].type = "delivery"; assert.equal(feedback(pairs, wrong)[1].statement, true);
  assert.equal(c.claims[0].evidence[1].relation, "contradicts"); assert.deepEqual(feedback(pairs, c)[1].fields.kind, clean());
  assert.equal(policyEventDraftFromEntries(pairs, [1], c).entries[0].fields.kind.references[0].referenceNumber, 2);
});
test("event malformed structure and input faults retain generic fallback and clean hints do not imply acceptance", () => {
  const c = policyEventContext(), pairs = policyEventFormEntries(c);
  for (const input of [pairs.filter(([name]) => name !== "1.description"), [...pairs, ["1.claim", c.claims[0].id]], [...pairs, ["1.coverage", "PRIVATE"]],
    [["1.description", null]], new Proxy([], { get() { throw Error("PRIVATE"); } }), edit(pairs, "1.description", "x".repeat(16_385))]) assert.equal(feedback(input, c), null);
  assert.equal(feedback(pairs, c, [1, 1]), null);
  const badDate = edit(pairs, "1.eventValue", "PRIVATE_DATE"); assert.deepEqual(feedback(badDate, c)[1].fields, { kind: clean(), description: clean() });
  assert.equal(policyEventDraftFromEntries(badDate, [1], c), null);
});
