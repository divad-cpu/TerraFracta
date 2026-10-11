import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../src/correction-review-trial.ts";
const path = new URL("../src/correction-review-trial-view.tsx", import.meta.url), native = createRequire(path), exports = {};
const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
new Function("require", "exports", compiled)(name => name === "./correction-review-trial.ts" ? contract : native(name), exports);
const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_correction_review_snapshot.json", import.meta.url), "utf8"));
test("actual review presenter is dated, separate, private and does not imply publication", () => {
  const markup = renderToStaticMarkup(createElement(exports.CorrectionReviewTrialView));
  for (const text of ["Separate invented run", "Awaiting review", "Under review", "Review closed", "private review outcome",
    "does not change displayed facts", "not a live queue", "no reader contact details", "sent no notifications", saved.recordedAt]) {
    assert.ok(markup.includes(text), text);
  }
  assert.doesNotMatch(markup, /<form|<button|reportId|principal|sourceFingerprint|privateEvidenceDirectory|\/home\/dj/);
});
test("dated review model refuses leaked details, mismatched state counts and live claims", () => {
  assert.deepEqual(contract.parseCorrectionReviewTrial(saved), saved);
  for (const changed of [{ ...saved, privateReports: true }, { ...saved, reviewEvents: 2 }, { ...saved, realReports: 1 },
    { ...saved, notificationSent: true }, { ...saved, liveStatus: true }, { ...saved, publicContentChanged: true },
    { ...saved, reportId: "private-canary" }, { ...saved, editions: saved.editions.toReversed() },
    { ...saved, states: { new: 2, in_review: 0, closed: 2 } },
    { ...saved, editions: [{ ...saved.editions[0], states: { new: 2, in_review: 0, closed: 0 } }, saved.editions[1]] }]) {
    assert.throws(() => contract.parseCorrectionReviewTrial(changed));
  }
});
