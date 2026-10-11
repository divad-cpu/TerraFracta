import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { compareFictionalSavedRuns } from "../src/fictional-saved-run-comparison.ts";

const { SavedRunComparison } = loadTsx(new URL("../app/editorial-preview/saved-run-comparison.tsx", import.meta.url));
function receipt(later = false) {
  return { execution: { id: later ? "22222222-2222-4222-8222-222222222222" : "11111111-1111-4111-8111-111111111111",
    kind: "local_fictional", scenario: later ? "revised_value" : "standard",
    executedAt: later ? "2026-10-02T16:00:00Z" : "2026-10-02T15:00:00Z", durationMs: 1 },
    report: JSON.parse(readFileSync(new URL(`../fixtures/${later ? "fictional_revised_update_report" : "fictional_update_report"}.json`, import.meta.url))) };
}
const held = { kind: "held", reason: "unavailable" };
const render = (earlier, later) => renderToStaticMarkup(createElement(SavedRunComparison, { earlier, later }));
function throwing(side, field = "execution") {
  const input = receipt(side === "later");
  Object.defineProperty(input, field, { enumerable: true, get() { throw new Error("PRIVATE_VALIDATION_CANARY"); } });
  return input;
}
test("a throwing earlier result is the existing opaque unavailable comparison", () => {
  assert.deepEqual(compareFictionalSavedRuns(throwing("earlier"), receipt(true)), held);
});
test("a throwing later result is the existing opaque unavailable comparison", () => {
  assert.deepEqual(compareFictionalSavedRuns(receipt(), throwing("later", "report")), held);
});
test("nested validation and key-enumeration exceptions are withheld on either side", () => {
  for (const side of ["earlier", "later"]) {
    const nested = receipt(side === "later");
    Object.defineProperty(nested.execution, "id", { enumerable: true, get() { throw new Error("PRIVATE_VALIDATION_CANARY"); } });
    for (const input of [nested, new Proxy(receipt(side === "later"), { ownKeys() { throw new Error("PRIVATE_VALIDATION_CANARY"); } })])
      assert.deepEqual(compareFictionalSavedRuns(side === "earlier" ? input : receipt(), side === "later" ? input : receipt(true)), held);
  }
});
test("the actual saved-run presenter shows only its existing held notice after a validation exception", () => {
  const expected = render(null, null);
  for (const [earlier, later] of [[throwing("earlier"), receipt(true)], [receipt(), throwing("later", "report")]]) {
    const html = render(earlier, later);
    assert.equal(html, expected);
    assert.doesNotMatch(html, /PRIVATE_VALIDATION_CANARY|27\.4|28\.1|percentage points|Download|22222222/);
  }
});
test("ordinary saved-run classification retains every existing reason", () => {
  assert.deepEqual(compareFictionalSavedRuns(null, receipt(true)), held);
  assert.deepEqual(compareFictionalSavedRuns(receipt(), receipt()), { kind: "held", reason: "execution_order" });
  const missing = receipt(true); missing.execution.scenario = "missing_source";
  missing.report = { ...missing.report, state: "partial", items: [], coveredSourceKeys: [], fictionalCandidate: null };
  assert.deepEqual(compareFictionalSavedRuns(receipt(), missing), { kind: "held", reason: "missing_observation" });
  const earlier = receipt(true), later = receipt(); earlier.execution.executedAt = "2026-10-02T14:00:00Z";
  assert.deepEqual(compareFictionalSavedRuns(earlier, later), { kind: "held", reason: "observation_mismatch" });
});
test("normal checked values and saved-run references remain available", () => {
  const earlier = receipt(), later = receipt(true);
  const checked = compareFictionalSavedRuns(earlier, later);
  assert.equal(checked.kind, "comparable");
  assert.equal(checked.before.observation.value, "27.4"); assert.equal(checked.after.observation.value, "28.1");
  const html = render(earlier, later);
  for (const value of [earlier.execution.id, later.execution.id, earlier.execution.executedAt, later.execution.executedAt,
    "27.4%", "28.1%", "+0.7 percentage points", "invented fixtures", "zero published"]) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /Saved-run comparison held|<form/);
});
