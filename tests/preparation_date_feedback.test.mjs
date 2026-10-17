import assert from "node:assert/strict";
import test from "node:test";
import { preparationDateFeedback } from "../src/preparation-date-feedback.ts";
import { policyEventContext, policyEventFormEntries } from "./helpers/policy_event_fixture.mjs";
import { deliveryContext, deliveryFormEntries } from "./helpers/delivery_draft_fixture.mjs";
import { policyEventDraftFromEntries } from "../src/policy-event-draft.ts";
const edit = (pairs, key, value) => pairs.map(([name, old]) => [name, name === key ? value : old]);
const clean = () => ({ precision: false, value: false, references: false });
const sample = () => { const c = policyEventContext(); return { c, pairs: policyEventFormEntries(c) }; };
test("date feedback is fixed booleans only and leaves original source controls unchanged for both private layouts", () => {
  for (const [c, pairs, mode] of [[policyEventContext(), policyEventFormEntries(policyEventContext()), "policy_event"], [deliveryContext(), deliveryFormEntries(deliveryContext()), "delivery"]]) {
    const before = structuredClone(pairs), value = preparationDateFeedback(pairs, [1], c, mode);
    assert.deepEqual(value, { 1: { eventDate: clean(), reportedDate: clean() } }); assert.deepEqual(pairs, before);
    assert.doesNotMatch(JSON.stringify(value), /2030|claimId|supports|accepted|eligible|approved|87000000/);
  }
});
test("invalid date value never hides independently foreign or missing exact date references", () => {
  const { c, pairs } = sample(); let input = edit(edit(pairs, "1.eventPrecision", "month"), "1.eventValue", "2030-13");
  input = edit(input, "1.eventDateReferences", "foreign-private-reference");
  assert.deepEqual(preparationDateFeedback(input, [1], c, "policy_event")[1].eventDate, { precision: false, value: true, references: true });
  input = input.filter(([name]) => name !== "1.eventDateReferences"); assert.equal(preparationDateFeedback(input, [1], c, "policy_event")[1].eventDate.references, true);
  assert.equal(policyEventDraftFromEntries(input, [1], c), null);
});
test("missing precision is not guessed from a year-shaped value and blank unknown dates cannot retain selected references", () => {
  const { c, pairs } = sample(); let input = edit(pairs, "1.eventPrecision", "");
  assert.deepEqual(preparationDateFeedback(input, [1], c, "policy_event")[1].eventDate, { precision: true, value: false, references: false });
  input = edit(input, "1.eventValue", ""); assert.deepEqual(preparationDateFeedback(input, [1], c, "policy_event")[1].eventDate, { precision: true, value: true, references: false });
  input = input.filter(([name]) => name !== "1.eventDateReferences"); assert.deepEqual(preparationDateFeedback(input, [1], c, "policy_event")[1].eventDate, clean());
  assert.equal(policyEventDraftFromEntries(input, [1], c).entries[0].fields.eventDate, null);
});
test("source day month year and stated-period formats retain their existing distinctions without automatic correction", () => {
  const { c, pairs } = sample();
  for (const [precision, value, invalid] of [["day", "2024-02-29", false], ["day", "2023-02-29", true], ["month", "2030-02", false],
    ["month", "2030-13", true], ["year", "2030", false], ["year", "2030-02", true], ["period", "source interval 2030/31", false], ["period", "   ", true]]) {
    const input = edit(edit(pairs, "1.eventPrecision", precision), "1.eventValue", value), before = structuredClone(input);
    assert.equal(preparationDateFeedback(input, [1], c, "policy_event")[1].eventDate.value, invalid, `${precision}:${value}`); assert.deepEqual(input, before);
    assert.equal(policyEventDraftFromEntries(input, [1], c) === null, invalid);
  }
});
test("each date requires distinct exact captured occurrences but an original conflict role is not upgraded into support", () => {
  const { c, pairs } = sample(), key = `${c.claims[0].id}:2`;
  const conflict = edit(pairs, "1.eventDateReferences", key); assert.deepEqual(preparationDateFeedback(conflict, [1], c, "policy_event")[1].eventDate, clean());
  for (const refs of [[key, key], Array(13).fill(key), ["PRIVATE"]]) {
    const input = [...pairs.filter(([name]) => name !== "1.eventDateReferences"), ...refs.map(value => ["1.eventDateReferences", value])];
    assert.equal(preparationDateFeedback(input, [1], c, "policy_event")[1].eventDate.references, true);
  }
  const unknown = edit(pairs, "1.eventPrecision", "not_supplied"); assert.equal(preparationDateFeedback(unknown, [1], c, "policy_event")[1].eventDate.precision, true);
});
test("malformed rows controls missing or repeated date scalars and private faults retain generic fallback", () => {
  const { c, pairs } = sample();
  for (const input of [pairs.filter(([name]) => name !== "1.eventValue"), [...pairs, ["1.eventPrecision", "year"]], [...pairs, ["1.PRIVATE", "PRIVATE"]],
    [["1.eventValue", 1]], new Proxy([], { get() { throw Error("PRIVATE"); } })]) assert.equal(preparationDateFeedback(input, [1], c, "policy_event"), null);
  for (const ids of [[1, 1], [0], [-1], [1.5], Array.from({ length: 9 }, (_, i) => i + 1)]) assert.equal(preparationDateFeedback(pairs, ids, c, "policy_event"), null);
  assert.equal(preparationDateFeedback(pairs, [1], c, "PRIVATE"), null);
});
test("raw input quota and collection lengths are bounded before item access and iterators are never consulted", () => {
  const { c, pairs } = sample(); assert.equal(preparationDateFeedback(edit(pairs, "1.eventValue", "x".repeat(16_385)), [1], c, "policy_event"), null);
  const oversized = new Proxy(new Array(545), { get(target, key) { if (key !== "length") assert.fail("Over-limit entry observed"); return Reflect.get(target, key); } });
  assert.equal(preparationDateFeedback(oversized, [1], c, "policy_event"), null);
  const rows = [1]; Object.defineProperty(rows, Symbol.iterator, { get() { assert.fail("Row iterator observed"); } });
  Object.defineProperty(pairs, Symbol.iterator, { get() { assert.fail("Control iterator observed"); } });
  assert.deepEqual(preparationDateFeedback(pairs, rows, c, "policy_event")[1].eventDate, clean());
});
test("captured context is detached before collected control getters and contains no approval or old-binding authority", () => {
  const { c, pairs } = sample(); const input = structuredClone(pairs), original = input[0][1];
  Object.defineProperty(input[0], 1, { get() { c.claims[0].evidence = []; return original; } });
  assert.deepEqual(preparationDateFeedback(input, [1], c, "policy_event")[1].eventDate, clean());
  assert.equal(preparationDateFeedback(pairs, [1], c, "policy_event"), null);
});
