import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../src/correction-intake-trial.ts";

const path = new URL("../src/correction-intake-trial-view.tsx", import.meta.url), native = createRequire(path), exports = {};
const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
new Function("require", "exports", compiled)(name => name === "./correction-intake-trial.ts" ? contract : native(name), exports);
const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_correction_intake_snapshot.json", import.meta.url), "utf8"));

test("actual presenter marks four saved reports as invented, dated and awaiting review", () => {
  const markup = renderToStaticMarkup(createElement(exports.CorrectionIntakeTrialView));
  for (const text of ["Four sample reports", "First edition", "Correction edition", "Awaiting review",
    "no reader contact details", "does not describe a live queue", "Real submission", saved.recordedAt]) assert.ok(markup.includes(text), text);
  assert.ok(markup.includes('href="/connected-preview/issue"'));
  assert.doesNotMatch(markup, /<form|<button|reportId|principal|sourceFingerprint|privateEvidenceDirectory|\/home\/dj/);
});
test("contract refuses private fields, live claims, changed counts and invented review completion", () => {
  assert.deepEqual(contract.parseCorrectionIntakeTrial(saved), saved);
  for (const changed of [{ ...saved, privateReports: 5 }, { ...saved, sourceRequests: 1 }, { ...saved, realReports: 1 },
    { ...saved, contactCollected: true }, { ...saved, liveStatus: true }, { ...saved, publicContentChanged: true },
    { ...saved, reportDetails: "private-canary" }, { ...saved, editions: saved.editions.toReversed() },
    { ...saved, editions: [{ ...saved.editions[0], reviewState: "closed" }, saved.editions[1]] }]) {
    assert.throws(() => contract.parseCorrectionIntakeTrial(changed));
  }
});
