import assert from "node:assert/strict";
import test from "node:test";
import { policyEventControlEntries } from "../src/policy-event-controls.ts";
import { fakePolicyEventControls, policyEventFormEntries, policyEventContext } from "./helpers/policy_event_fixture.mjs";
test("the bounded control adapter preserves text and selected occurrence order without creating a form", () => {
  const pairs = policyEventFormEntries(policyEventContext()), result = policyEventControlEntries(fakePolicyEventControls(pairs), () => true);
  assert.deepEqual(result, pairs);
});
test("retirement precedes root observation and reentrant loss stops before later control values", () => {
  assert.throws(() => policyEventControlEntries(new Proxy({}, { get() { assert.fail("Retired control observation"); } }), () => false), /retired/);
  let active = true, observed = 0;
  const root = { elements: { length: 1, item: () => ({ getAttribute() { active = false; return "1.claim"; }, get tagName() { observed++; return "INPUT"; } }) } };
  assert.throws(() => policyEventControlEntries(root, () => active), /retired/); assert.equal(observed, 0);
});
test("excess controls missing slots unknown element types files and excessive selections are refused", () => {
  for (const root of [{ elements: { length: 129 } }, { elements: { length: 1, item: () => null } },
    { elements: { length: 1, item: () => ({ getAttribute: () => "1.claim", tagName: "IFRAME" }) } },
    { elements: { length: 1, item: () => ({ getAttribute: () => "1.claim", tagName: "INPUT", type: "file" }) } },
    fakePolicyEventControls(Array.from({ length: 13 }, () => ["1.kindReferences", "same"]))])
    assert.throws(() => policyEventControlEntries(root, () => true));
});
test("unnamed structural controls are skipped while native collection or option observation faults remain opaque to callers", () => {
  const root = { elements: { length: 1, item: () => ({ getAttribute: () => null, get tagName() { assert.fail("Unnamed controls need no value inspection"); } }) } };
  assert.deepEqual(policyEventControlEntries(root, () => true), []);
  const bad = { elements: { length: 1, item: () => ({ getAttribute: () => "1.kindReferences", tagName: "SELECT", multiple: true,
    selectedOptions: { length: 1, item: () => null } }) } };
  assert.throws(() => policyEventControlEntries(bad, () => true), /choice unavailable/);
});
test("a collection method getter that retires ownership cannot invoke its returned method", () => {
  let active = true, invoked = 0;
  const root = { elements: { length: 1, get item() { active = false; return () => { invoked++; return {}; }; } } };
  assert.throws(() => policyEventControlEntries(root, () => active)); assert.equal(invoked, 0);
});
test("an attribute method getter that retires ownership cannot invoke its returned method", () => {
  let active = true, invoked = 0;
  const control = { get getAttribute() { active = false; return () => { invoked++; return "1.claim"; }; } };
  assert.throws(() => policyEventControlEntries({ elements: { length: 1, item: () => control } }, () => active)); assert.equal(invoked, 0);
});
test("a selected-option method getter that retires ownership cannot invoke its returned method", () => {
  let active = true, invoked = 0;
  const control = { getAttribute: () => "1.kindReferences", tagName: "SELECT", multiple: true,
    selectedOptions: { length: 1, get item() { active = false; return () => { invoked++; return { value: "PRIVATE" }; }; } } };
  assert.throws(() => policyEventControlEntries({ elements: { length: 1, item: () => control } }, () => active)); assert.equal(invoked, 0);
});
test("a selected-option method that retires ownership cannot observe the returned option value", () => {
  let active = true, observed = 0;
  const control = { getAttribute: () => "1.kindReferences", tagName: "SELECT", multiple: true,
    selectedOptions: { length: 1, item() { active = false; return { get value() { observed++; return "PRIVATE"; } }; } } };
  assert.throws(() => policyEventControlEntries({ elements: { length: 1, item: () => control } }, () => active)); assert.equal(observed, 0);
});
