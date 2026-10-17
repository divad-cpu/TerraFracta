import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fictionalUpdateResultSchema } from "../src/fictional-update-result.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";

// Compile the real shared table as an explicit module port. This permits a
// byte-bound original control without mutating the canonical module or source.
const labels = loadTsx(new URL("../src/fictional-decision-labels.ts", import.meta.url));
const intercept = name => name.replace(/\.ts$/, "").endsWith("fictional-decision-labels") ? labels : undefined;
const Review = loadTsx(new URL("../src/fictional-run-review.tsx", import.meta.url), intercept).FictionalRunReview;
const Operation = loadTsx(new URL("../app/update-preview/operation.tsx", import.meta.url), intercept).UpdateOperation;
const report = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url)));
const unknown = ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty", "isPrototypeOf", "toLocaleString", "propertyIsEnumerable"];
const fallback = "Additional review is required.";
function receipt(code) {
  const input = { execution: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "local_fictional",
    scenario: "standard", executedAt: "2026-10-01T10:00:00Z", durationMs: 1 }, report: structuredClone(report) };
  if (code !== undefined) input.report.items[1].reasonCodes = ["material_conflict", code, "ordinary_unknown_code"];
  // Native JSON strings are admitted by the actual closed result grammar.
  return fictionalUpdateResultSchema.parse(JSON.parse(JSON.stringify(input)));
}
const paragraphs = html => [...html.matchAll(/<h3>[^<]*<\/h3><p>([^<]*)<\/p><details><summary>(?:Item reference|Decision codes)<\/summary>/g)].map(m => m[1]);
const renderReview = input => renderToStaticMarkup(createElement(Review, { input }));
const renderOperation = input => renderToStaticMarkup(createElement(Operation, { initialReport: input.report }));

test("saved native JSON reason codes resembling Object properties keep the existing unknown-code explanation", () => {
  for (const code of unknown) {
    const input = receipt(code), before = JSON.stringify(input), html = renderReview(input), rows = paragraphs(html);
    assert.equal(rows.length, 4);
    assert.equal(rows[1], `Another finding conflicts with this one and needs review. ${fallback} ${fallback}`, code);
    assert.ok(html.includes(input.report.items[1].source.locator));
    assert.ok(!html.includes("[native code]") && !html.includes("[object Object]"));
    assert.equal(JSON.stringify(input), before);
  }
});

test("the actual update presenter uses the same safe fallback while preserving each recorded decision code", () => {
  for (const code of unknown) {
    const input = receipt(code), html = renderOperation(input), rows = paragraphs(html);
    assert.equal(rows.length, 4);
    assert.equal(rows[1], `Another finding conflicts with this one and needs review. ${fallback} ${fallback}`, code);
    assert.ok(html.includes(`<code>, ${code}</code>`));
    assert.ok(html.includes("Public changes: 0") && !html.includes("[native code]") && !html.includes("[object Object]"));
  }
});

test("ordinary saved reason explanations and source-withholding output preserve their established meanings", () => {
  const input = receipt(), html = renderReview(input), operation = renderOperation(input);
  const expected = ["The checks passed in rehearsal. Nothing was published.", "Another finding conflicts with this one and needs review.",
    "The source content matches the previous check.", "The observed data mapping differs from the accepted one."];
  assert.deepEqual(paragraphs(html), expected); assert.deepEqual(paragraphs(operation), expected);
  const invalid = { ...input, execution: { ...input.execution, scenario: "invalid_citation" }, report: structuredClone(input.report) };
  Object.assign(invalid.report.items[0], { outcome: "held", reasonCodes: ["source_reference_invalid"], source: null, sourceBindingValid: false });
  Object.assign(invalid.report, { state: "partial", coveredSourceKeys: [], fictionalCandidate: null });
  const hidden = renderReview(fictionalUpdateResultSchema.parse(invalid));
  assert.ok(hidden.includes("The source reference could not be checked. Its details are withheld."));
  assert.ok(hidden.includes("Source details withheld") && !hidden.includes(input.report.items[0].source.locator));
});
