import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../src/correction-recovery-trial.ts";
const path = new URL("../src/correction-recovery-trial-view.tsx", import.meta.url), native = createRequire(path), exports = {};
const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
new Function("require", "exports", compiled)(name => name === "./correction-recovery-trial.ts" ? contract : native(name), exports);
const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_correction_recovery_snapshot.json", import.meta.url), "utf8"));
test("actual dated lookup display distinguishes historical and current state without retry controls", () => {
  const markup = renderToStaticMarkup(createElement(exports.CorrectionRecoveryTrialView));
  for (const text of ["Saved invented trial", "Previous steps found", "Unsent step absent", "Separate account",
    "kept the report closed", "does not authorize a new attempt", "not live status", "writing disabled", saved.recordedAt])
    assert.ok(markup.includes(text), text);
  assert.doesNotMatch(markup, /<form|<button|eventId|reportId|privateEvidenceDirectory|\/home\/dj/);
});
test("saved lookup contract refuses live claims, reordered outcomes and private fields", () => {
  assert.deepEqual(contract.parseCorrectionRecoveryTrial(saved), saved);
  for (const changed of [{ liveStatus: true }, { realReports: 1 }, { sourceRequests: false }, { publicContentChanged: true },
    { privateEventExposedAcrossAccounts: true }, { observations: saved.observations.toReversed() },
    { observations: [{ ...saved.observations[0], eventId: "private-canary" }, ...saved.observations.slice(1)] },
    { observations: [{ ...saved.observations[0], currentState: "in_review" }, ...saved.observations.slice(1)] }])
    assert.throws(() => contract.parseCorrectionRecoveryTrial({ ...saved, ...changed }));
});
