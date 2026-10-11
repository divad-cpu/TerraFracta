import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../src/correction-queue-trial.ts";
const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_correction_queue_snapshot.json", import.meta.url), "utf8"));
function compile(path, replacements) {
  const native = createRequire(path), exports = {};
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  new Function("require", "exports", code)(name => Object.hasOwn(replacements, name) ? replacements[name] : native(name), exports);
  return exports;
}
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
function clientHarness() {
  let current;
  const component = compile(new URL("../app/editorial-preview/correction-queue-sample.tsx", import.meta.url), {
    react: { useState(initial) { current ??= initial; return [current, change => { current = typeof change === "function" ? change(current) : change; }]; } },
    "../../src/correction-queue-trial.ts": contract,
  }).CorrectionQueueSample;
  const render = () => component({ input: saved });
  const text = value => Array.isArray(value) ? value.map(text).join("") : String(value ?? "");
  return { render, button(label) { return nodes(render()).find(item => item.type === "button" && text(item.props.children) === label).props; } };
}
test("actual callback paging is bounded, clears selection and rejects delayed off-page selection", () => {
  const h = clientHarness();
  assert.equal(h.button("Previous page").disabled, true);
  h.button("Inspect sample 1").onClick();
  assert.match(renderToStaticMarkup(h.render()), /Filed against revision 1/);
  const delayed = h.button("Inspect sample 2").onClick;
  h.button("Next page").onClick(); delayed();
  const second = renderToStaticMarkup(h.render());
  assert.match(second, /Showing 3–4 of 5/); assert.doesNotMatch(second, /Filed against revision/);
  h.button("Inspect sample 4").onClick(); assert.match(renderToStaticMarkup(h.render()), /Filed against revision 2/);
  h.button("Next page").onClick();
  assert.equal(h.button("Next page").disabled, true);
  h.button("Next page").onClick(); assert.match(renderToStaticMarkup(h.render()), /Showing 5–5 of 5/);
  h.button("Inspect sample 5").onClick(); assert.match(renderToStaticMarkup(h.render()), /Saved state: awaiting review/);
  h.button("Previous page").onClick(); assert.doesNotMatch(renderToStaticMarkup(h.render()), /Filed against revision/);
  h.button("Previous page").onClick(); delayed();
  assert.match(renderToStaticMarkup(h.render()), /Showing 1–2 of 5/);
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /Filed against revision/);
  h.button("Inspect sample 1").onClick();
  const currentPage = renderToStaticMarkup(h.render());
  h.button("Previous page").onClick(); assert.equal(renderToStaticMarkup(h.render()), currentPage);
});
test("actual server/client markup keeps dated membership distinct from live review and withholds private fields", () => {
  const component = compile(new URL("../app/editorial-preview/correction-queue-sample.tsx", import.meta.url), {
    "../../src/correction-queue-trial.ts": contract,
  }).CorrectionQueueSample;
  const view = compile(new URL("../src/correction-queue-trial-view.tsx", import.meta.url), {
    "./correction-queue-trial.ts": contract,
    "../app/editorial-preview/correction-queue-sample": { CorrectionQueueSample: component },
  }).CorrectionQueueTrialView;
  const markup = renderToStaticMarkup(createElement(view));
  for (const text of ["Before-review sample", "earlier list captured four", "fifth committed report", "before review",
    "make no requests", "not a live queue", "No review or publication action", "Inspect sample 1", saved.capturedAt])
    assert.ok(markup.includes(text), text);
  assert.doesNotMatch(markup, /<form|eventId|reportId|snapshotId|principal|privateEvidenceDirectory|\/home\/dj/);
});
test("dated model rejects private fields, changed counts, invalid order and microsecond future report", () => {
  assert.deepEqual(contract.parseCorrectionQueueTrial(saved), saved);
  for (const changed of [{ liveStatus: true }, { capturedMembers: 4 }, { privateDetailsExported: true }, { sourceRequests: false },
    { reports: saved.reports.toReversed() }, { reportId: "private-canary" },
    { reports: [{ ...saved.reports[0], reportId: "private-canary" }, ...saved.reports.slice(1)] },
    { reports: [{ ...saved.reports[0], reviewState: "closed" }, ...saved.reports.slice(1)] },
    { reports: [...saved.reports.slice(0, 4), { ...saved.reports[4], reportedAt: "2026-10-03T07:12:17.509825+00:00" }] }])
    assert.throws(() => contract.parseCorrectionQueueTrial({ ...saved, ...changed }));
});
