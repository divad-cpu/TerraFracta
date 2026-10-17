import assert from "node:assert/strict";
import test from "node:test";
import { preparationReferenceValues } from "../src/policy-event-controls.ts";
test("native selected reference reader preserves exact order and method receiver without consulting an iterator", () => {
  const options = { length: 2, item(index) { assert.equal(this, options); return { value: ["Original:2", "Original:1"][index] }; },
    get [Symbol.iterator]() { assert.fail("No implicit iterator"); } };
  assert.deepEqual(preparationReferenceValues({ selectedOptions: options }, () => true), ["Original:2", "Original:1"]);
});
test("retired native selection refuses before target observation and each lookup invocation and value boundary", () => {
  assert.throws(() => preparationReferenceValues(new Proxy({}, { get() { assert.fail("Retired control observed"); } }), () => false));
  for (const boundary of ["options", "length", "lookup", "invoke", "value"]) {
    let current = true, later = 0;
    const options = { get length() { if (boundary === "length") current = false; return 1; },
      get item() { if (boundary === "lookup") current = false; return function () { if (boundary === "invoke") current = false; return { get value() { if (boundary === "value") current = false; else later++; return "exact"; } }; }; } };
    assert.throws(() => preparationReferenceValues({ get selectedOptions() { if (boundary === "options") current = false; return options; } }, () => current));
    assert.equal(later, 0);
  }
});
test("native selection refuses overlimits invalid lengths missing items nontext and failed lookups without a partial result", () => {
  for (const length of [13, -1, 1.5, NaN, Infinity]) assert.throws(() => preparationReferenceValues({ selectedOptions: { length, get item() { assert.fail("Refused length reached item"); } } }, () => true));
  for (const options of [{ length: 1, item: () => null }, { length: 1, item: () => ({ value: 1 }) },
    { length: 1, get item() { throw Error("PRIVATE"); } }]) assert.throws(() => preparationReferenceValues({ selectedOptions: options }, () => true));
  assert.deepEqual(preparationReferenceValues({ selectedOptions: { length: 0 } }, () => true), []);
});
