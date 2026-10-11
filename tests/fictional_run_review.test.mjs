import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";

const source = new URL("../src/fictional-run-review.tsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("require", "exports", compiled)(createRequire(source), exports);
const report = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
function receipt() { return { execution: { id: "11111111-1111-4111-8111-111111111111", kind: "local_fictional",
  scenario: "standard", executedAt: "2026-10-02T14:00:00Z", durationMs: 1 }, report: structuredClone(report) }; }
const render = (input) => renderToStaticMarkup(createElement(exports.FictionalRunReview, { input }));

test("actual presenter shows saved outcome, holds and exact illustrative evidence without approval", () => {
  const input = receipt(), html = render(input);
  assert.ok(html.includes("Rehearsal completed"));
  assert.ok(html.includes("4 items checked · 1 proposed · 2 held · 1 unchanged"));
  assert.ok(html.includes("1 of 1 expected sources"));
  assert.ok(html.includes("Zero published · zero model calls"));
  assert.ok(html.includes(input.report.items[0].source.locator));
  assert.ok(!html.includes(`href="${input.report.items[0].source.url}"`));
  assert.ok(!html.includes("<button"));assert.ok(!html.includes("<form"));
  assert.match(html, /<time datetime="2026-10-02T14:00:00Z"/i);
});
test("missing and invalid references retain incomplete coverage and withhold affected details", () => {
  const missing = receipt();missing.execution.scenario = "missing_source";
  Object.assign(missing.report, { items: [], state: "partial", coveredSourceKeys: [], fictionalCandidate: null });
  const empty = render(missing);
  assert.ok(empty.includes("Rehearsal needs attention"));assert.ok(empty.includes("No items were checked"));
  assert.ok(empty.includes("0 of 1 expected sources"));
  const invalid = receipt();invalid.execution.scenario = "invalid_citation";
  Object.assign(invalid.report.items[0], { outcome: "held", reasonCodes: ["source_reference_invalid"], source: null, sourceBindingValid: false });
  Object.assign(invalid.report, { state: "partial", coveredSourceKeys: [], fictionalCandidate: null });
  const html = render(invalid);
  assert.ok(html.includes("3 held"));assert.ok(html.includes("Source details withheld"));
  assert.ok(html.includes("Source coverage is incomplete"));assert.ok(!html.includes("Saved rehearsal unavailable"));
});
test("private fields or invented live outcomes have no displayed source or diagnostic", () => {
  for (const change of [(v) => { v.rawBody = "private-canary"; }, (v) => { v.report.publicChanges = 1; },
    (v) => { v.execution.kind = "live"; }, (v) => { v.report.items[0].source.url = "https://user:secret@example.org/"; }]) {
    const value = receipt();change(value);const html = render(value);
    assert.ok(html.includes("Saved rehearsal unavailable"));assert.ok(!html.includes("private-canary"));
    assert.ok(!html.includes("Exact location"));assert.ok(!html.includes("secret"));
  }
});
