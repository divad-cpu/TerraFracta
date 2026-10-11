import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import { compareFictionalSavedRuns } from "../src/fictional-saved-run-comparison.ts";
import * as observation from "../src/fictional-observation-comparison.ts";

function compile(relative, imports = {}) {
  const source = new URL(relative, import.meta.url), nativeRequire = createRequire(source), exports = {};
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", compiled)(name => imports[name] ?? nativeRequire(name), exports);
  return exports;
}
const comparison = compile("../app/update-preview/comparison.tsx", { "../../src/fictional-observation-comparison": observation });
const { SavedRunComparison } = compile("../app/editorial-preview/saved-run-comparison.tsx", { "../update-preview/comparison": comparison });
const standard = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url)));
const revised = JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json", import.meta.url)));
function receipt(later = false) {
  return { execution: { id: later ? "22222222-2222-4222-8222-222222222222" : "11111111-1111-4111-8111-111111111111",
    kind: "local_fictional", scenario: later ? "revised_value" : "standard",
    executedAt: later ? "2026-10-02T16:00:00Z" : "2026-10-02T15:00:00Z", durationMs: 1 },
    report: structuredClone(later ? revised : standard) };
}
const render = (earlier, later) => renderToStaticMarkup(createElement(SavedRunComparison, { earlier, later }));

test("two actual checked receipts reuse exact observation comparison and preserve execution references", () => {
  const earlier = receipt(), later = receipt(true), checked = compareFictionalSavedRuns(earlier, later);
  assert.equal(checked.kind, "comparable");
  assert.equal(observation.compareFictionalObservations(checked.before, checked.after).deltaPercentagePoints, "+0.7");
  const html = render(earlier, later);
  for (const text of [earlier.execution.id, later.execution.id, earlier.execution.executedAt,
    later.execution.executedAt, "27.4%", "28.1%", "+0.7 percentage points", "2 held", "zero published", "invented fixtures"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("<form"));
  assert.ok(!html.includes("Saved-run comparison held"));
});
test("same run and equal or reversed execution dates hold without presenting a numeric difference", () => {
  for (const later of [receipt(), { ...receipt(true), execution: { ...receipt(true).execution, executedAt: "2026-10-02T15:00:00Z" } },
    { ...receipt(true), execution: { ...receipt(true).execution, executedAt: "2026-10-02T14:59:59Z" } }]) {
    assert.deepEqual(compareFictionalSavedRuns(receipt(), later), { kind: "held", reason: "execution_order" });
    assert.ok(!render(receipt(), later).includes("percentage points"));
  }
});
test("execution order cannot override reversed source retrieval chronology", () => {
  const earlier = receipt(true), later = receipt();
  earlier.execution.executedAt = "2026-10-02T14:00:00Z";
  assert.deepEqual(compareFictionalSavedRuns(earlier, later), { kind: "held", reason: "observation_mismatch" });
});
test("a separate later standard run can show an unchanged checked observation", () => {
  const later = receipt();later.execution.id = receipt(true).execution.id;later.execution.executedAt = receipt(true).execution.executedAt;
  const checked = compareFictionalSavedRuns(receipt(), later);
  assert.equal(checked.kind, "comparable");
  assert.equal(observation.compareFictionalObservations(checked.before, checked.after).kind, "unchanged");
  assert.ok(render(receipt(), later).includes("observed value is unchanged"));
});
test("a valid missing-source receipt holds comparison and never treats absent evidence as zero", () => {
  const missing = receipt(true);missing.execution.scenario = "missing_source";
  missing.report = { ...missing.report, state: "partial", items: [], coveredSourceKeys: [], fictionalCandidate: null };
  assert.deepEqual(compareFictionalSavedRuns(receipt(), missing), { kind: "held", reason: "missing_observation" });
  assert.ok(!render(receipt(), missing).includes("0.0 percentage points"));
});
test("unknown and private substitutions withhold all their details", () => {
  for (const later of [null, { ...receipt(true), secret: "DO_NOT_DISPLAY" },
    { ...receipt(true), execution: { ...receipt(true).execution, kind: "live", secret: "DO_NOT_DISPLAY" } }]) {
    assert.deepEqual(compareFictionalSavedRuns(receipt(), later), { kind: "held", reason: "unavailable" });
    const html = render(receipt(), later);assert.ok(!html.includes("DO_NOT_DISPLAY"));assert.ok(!html.includes("28.1%"));
  }
});
test("multiple comparison presenters have distinct accessible heading references", () => {
  const html = renderToStaticMarkup(createElement("div", null,
    createElement(SavedRunComparison, { earlier: receipt(), later: receipt(true) }),
    createElement(comparison.FictionalComparison, { baseline: standard.fictionalCandidate, candidate: revised.fictionalCandidate })));
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(ids.includes(match[1]));
});
