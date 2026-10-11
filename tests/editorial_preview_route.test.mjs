import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const path = new URL("../app/editorial-preview/page.tsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness(mode) {
  const marker = new Error("NEXT_NOT_FOUND"), exports = {};let handedToDesk = 0;const reviewModes = [];
  const baseline = { invented: true }, nativeRequire = createRequire(path);
  const require = (name) => {
    if (name === "next/navigation") return { notFound: () => { throw marker; } };
    if (name.endsWith("/components")) return { PageIntro: () => null };
    if (name.endsWith("review-rehearsal")) return { ReviewRehearsal: () => null };
    if (name.endsWith("read-gate-rehearsal")) return { ReadGateRehearsal: () => null };
    if (name.endsWith("fictional-review-desk")) return { FictionalReviewDesk: () => null };
    if (name.endsWith("fictional-saved-run-import-view.tsx")) return { FictionalSavedRunImportView: () => null };
    if (name.endsWith("correction-intake-trial-view")) return { CorrectionIntakeTrialView: () => null };
    if (name.endsWith("correction-review-trial-view")) return { CorrectionReviewTrialView: () => null };
    if (name.endsWith("correction-review-operation-view")) return { CorrectionReviewOperationView: props => { reviewModes.push(props.supervised);return null; } };
    if (name.endsWith("correction-recovery-trial-view")) return { CorrectionRecoveryTrialView: () => null };
    if (name.endsWith("correction-queue-trial-view")) return { CorrectionQueueTrialView: () => null };
    if (name.endsWith("/example")) return { get fictionalUpdateReport() { handedToDesk++;return baseline; } };
    return nativeRequire(name);
  };
  new Function("require", "exports", "process", compiled)(require, exports, { env: { NODE_ENV: mode } });
  return { page: exports.default, marker, count: () => handedToDesk, reviewModes };
}
test("production and unknown modes refuse before a baseline is handed to the local desk", () => {
  for (const mode of ["production", "test", undefined]) {
    const h = harness(mode);assert.throws(h.page, (error) => error === h.marker);assert.equal(h.count(), 0);
  }
});
test("development renders the shared desk with one fixed invented baseline", () => {
  const h = harness("development");assert.ok(renderToStaticMarkup(h.page()));assert.equal(h.count(), 1);
  assert.deepEqual(h.reviewModes, [true]);
});
