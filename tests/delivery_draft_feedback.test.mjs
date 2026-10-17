import assert from "node:assert/strict";
import test from "node:test";
import { deliveryDraftFeedbackFromEntries, deliveryDraftFromEntries, deliveryStages } from "../src/delivery-draft.ts";
import { collectedPreparationControls } from "../src/preparation-control-values.ts";
import { deliveryContext, deliveryFormEntries } from "./helpers/delivery_draft_fixture.mjs";
const edit = (pairs, key, value) => pairs.map(([name, old]) => [name, name === key ? value : old]);
const hints = (pairs, c, rows = [1]) => deliveryDraftFeedbackFromEntries(pairs, rows, c);
const blank = () => ({ value: false, references: false });
test("delivery correction hints identify each supplied field's missing references without accepting the draft", () => {
  const c = deliveryContext(); let pairs = deliveryFormEntries(c).filter(([name]) => name !== "1.stageReferences");
  pairs = edit(edit(pairs, "1.description", "Invented source-described service"), "1.coverage", "Invented local coverage");
  const before = structuredClone(pairs), value = hints(pairs, c);
  for (const field of ["stage", "description", "coverage"]) assert.deepEqual(value[1].fields[field], { value: false, references: true });
  assert.equal(value[1].statement, false); assert.equal(deliveryDraftFromEntries(pairs, [1], c), null); assert.deepEqual(pairs, before);
  assert.doesNotMatch(JSON.stringify(value), /Invented|claimId|2030|accepted|eligible|approved|87000000/);
});
test("all source-described stages retain authoritative vocabulary and do not infer coverage or dates", () => {
  const c = deliveryContext(), base = deliveryFormEntries(c);
  for (const stage of Object.keys(deliveryStages)) {
    const pairs = edit(base, "1.stage", stage), before = structuredClone(pairs);
    assert.deepEqual(hints(pairs, c)[1].fields.stage, blank());
    const draft = deliveryDraftFromEntries(pairs, [1], c); assert.equal(draft.entries[0].fields.stage.value, stage);
    assert.equal(draft.entries[0].fields.coverage, null); assert.equal(draft.entries[0].fields.reportedDate, null); assert.deepEqual(pairs, before);
  }
  assert.equal(hints(edit(base, "1.stage", "PRIVATE_UNKNOWN_STAGE"), c)[1].fields.stage.value, true);
});
test("blank source fields remain unknown only without references and whitespace-only wording is not a value", () => {
  const c = deliveryContext(), ref = `${c.claims[0].id}:1`;
  const base = edit(deliveryFormEntries(c).filter(([name]) => name !== "1.stageReferences"), "1.stage", "");
  assert.deepEqual(hints(base, c)[1].fields, { stage: blank(), description: blank(), coverage: blank() });
  assert.equal(deliveryDraftFromEntries(base, [1], c).entries[0].fields.stage, null);
  for (const field of ["stage", "description", "coverage"]) {
    const pairs = [...base, [`1.${field}References`, ref]]; assert.equal(hints(pairs, c)[1].fields[field].value, true);
    assert.equal(deliveryDraftFromEntries(pairs, [1], c), null);
  }
  for (const field of ["description", "coverage"]) assert.deepEqual(hints(edit(base, `1.${field}`, " \t "), c)[1].fields[field], { value: true, references: true });
});
test("wording uses the original post-trim code-point limit without shortening source input", () => {
  const c = deliveryContext(), ref = `${c.claims[0].id}:1`;
  for (const field of ["description", "coverage"]) for (const [value, invalid] of [["x".repeat(1200), false], ["  " + "x".repeat(1200) + "  ", false],
    ["x".repeat(1201), true], ["😀".repeat(1200), false], ["😀".repeat(1201), true]]) {
    const pairs = [...edit(deliveryFormEntries(c), `1.${field}`, value), [`1.${field}References`, ref]], before = structuredClone(pairs);
    assert.deepEqual(hints(pairs, c)[1].fields[field], { value: invalid, references: false }); assert.deepEqual(pairs, before);
    assert.equal(deliveryDraftFromEntries(pairs, [1], c) === null, invalid);
  }
});
test("malformed values cannot conceal independently foreign duplicate or missing references", () => {
  const c = deliveryContext(), base = edit(deliveryFormEntries(c), "1.stage", "PRIVATE_STAGE");
  for (const refs of [[], ["PRIVATE_REF"], [`${c.claims[0].id}:1`, `${c.claims[0].id}:1`], Array(13).fill(`${c.claims[0].id}:1`)]) {
    const pairs = [...base.filter(([name]) => name !== "1.stageReferences"), ...refs.map(value => ["1.stageReferences", value])];
    assert.deepEqual(hints(pairs, c)[1].fields.stage, { value: true, references: true }); assert.equal(deliveryDraftFromEntries(pairs, [1], c), null);
  }
});
test("associated statement must be a captured delivery statement and original source roles confer no new support", () => {
  const c = deliveryContext(), base = deliveryFormEntries(c);
  for (const claim of ["", "PRIVATE_CLAIM"]) assert.equal(hints(edit(base, "1.claim", claim), c)[1].statement, true);
  const wrongType = structuredClone(c); wrongType.claims[0].type = "funding"; assert.equal(hints(base, wrongType)[1].statement, true);
  const conflict = edit(base, "1.stageReferences", `${c.claims[0].id}:2`);
  assert.deepEqual(hints(conflict, c)[1].fields.stage, blank()); assert.equal(c.claims[0].evidence[1].relation, "contradicts");
  assert.equal(deliveryDraftFromEntries(conflict, [1], c).entries[0].fields.stage.references[0].referenceNumber, 2);
});
test("field hints are not validation and remain independent of malformed date values", () => {
  const c = deliveryContext(), pairs = edit(edit(deliveryFormEntries(c), "1.eventValue", "PRIVATE_DATE"), "1.coverage", "Local scope");
  assert.deepEqual(hints(pairs, c)[1].fields.coverage, { value: false, references: true }); assert.equal(deliveryDraftFromEntries(pairs, [1], c), null);
  const onlyDate = edit(deliveryFormEntries(c), "1.eventValue", "PRIVATE_DATE");
  assert.deepEqual(hints(onlyDate, c)[1].fields, { stage: blank(), description: blank(), coverage: blank() });
  assert.equal(deliveryDraftFromEntries(onlyDate, [1], c), null);
});
test("missing repeated or unknown controls and row/input faults preserve fixed generic fallback", () => {
  const c = deliveryContext(), pairs = deliveryFormEntries(c);
  for (const input of [pairs.filter(([name]) => name !== "1.coverage"), [...pairs, ["1.claim", c.claims[0].id]], [...pairs, ["1.PRIVATE", "PRIVATE"]],
    [["1.coverage", 12]], new Proxy([], { get() { throw Error("PRIVATE"); } })]) assert.equal(hints(input, c), null);
  for (const rows of [[1, 1], [0], [-1], [1.5], Array.from({ length: 9 }, (_, i) => i + 1)]) assert.equal(hints(pairs, c, rows), null);
  assert.equal(hints(edit(pairs, "1.description", "x".repeat(16_385)), c), null);
});
test("shared collection snapshots lengths rows and context before item getters and never uses input iterators", () => {
  const c = deliveryContext(), pairs = deliveryFormEntries(c), rows = [1]; let inputLengths = 0, rowLengths = 0;
  const observed = new Proxy(pairs, { get(target, key) { if (key === Symbol.iterator) assert.fail("Input iterator observed");
    if (key === "length") { inputLengths++; return target.length; } return Reflect.get(target, key); } });
  const observedRows = new Proxy(rows, { get(target, key) { if (key === Symbol.iterator) assert.fail("Row iterator observed");
    if (key === "length") { rowLengths++; return target.length; } return Reflect.get(target, key); } });
  assert.deepEqual(hints(observed, c, observedRows)[1].fields.stage, blank()); assert.equal(inputLengths, 1); assert.equal(rowLengths, 1);
  const oversized = new Proxy(new Array(545), { get(target, key) { if (key !== "length") assert.fail("Over-limit item observed"); return 545; } });
  assert.equal(collectedPreparationControls(oversized, [1], c, "delivery"), null);
  const original = pairs[0][1]; Object.defineProperty(pairs[0], 1, { get() { c.claims[0].evidence = []; rows[0] = 99; return original; } });
  assert.deepEqual(hints(pairs, c, rows)[1].fields.stage, blank()); assert.equal(hints(pairs, c, [1]), null);
});
