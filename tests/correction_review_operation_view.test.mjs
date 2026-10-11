import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../src/correction-review-operation.ts";
import { correctionReviewExecution, supervisedCorrectionReviewExecution } from "./helpers/correction_review_execution.mjs";

const path = new URL("../src/correction-review-operation-view.tsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
function harness(initialProps = {}) {
  let props = initialProps;
  let cursor = 0, effect, cleanup; const cells = []; const native = createRequire(path), exports = {};
  const hooks = {
    useState(initial) { const index = cursor++; cells[index] ??= initial; return [cells[index], value => { cells[index] = value; }]; },
    useRef(initial) { const index = cursor++; cells[index] ??= { current: initial }; return cells[index]; },
    useEffect(callback) { effect = callback; },
  };
  new Function("require", "exports", compiled)(name => name === "react" ? hooks : name === "./correction-review-operation.ts" ? contract : native(name), exports);
  const render = () => { cursor = 0; return exports.CorrectionReviewOperationView(props); };
  const markup = () => renderToStaticMarkup(render());
  return { render, markup, mount() { render(); cleanup = effect(); }, unmount() { cleanup?.(); },
    switchMode(supervised) { props = { supervised };const beforeEffects = markup();cleanup?.();cleanup = effect();return beforeEffects; },
    button() { return nodes(render()).find(item => item.type === "button").props; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("actual client callbacks read only, coalesce repeated clicks and render dated redacted counts", async () => {
  const original = globalThis.fetch; let calls = 0, resolve; const response = new Promise(done => { resolve = done; });
  globalThis.fetch = async (url, options) => { calls++; assert.equal(url, "/api/dev/correction-review"); assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store"); assert.ok(!options.body); return response; };
  const h = harness();
  try {
    h.mount(); h.button().onClick(); assert.equal(calls, 1); assert.equal(h.button().disabled, true);
    resolve(Response.json({ state: "checked", result: correctionReviewExecution() })); await settle();
    const markup = h.markup();
    for (const text of ["Four invented reports stayed private", "2 await review", "1 is under review", "1 is closed",
      "does not show current account or process status", "Oslo", correctionReviewExecution().recordedAt]) assert.ok(markup.includes(text), text);
    assert.doesNotMatch(markup, /reportId|eventId|privateEvidenceDirectory|\/home\/dj|<form/);
    assert.equal(h.button().disabled, false);
  } finally { h.unmount(); globalThis.fetch = original; }
});

test("same-instance mode changes withhold previous results before effects and ignore a previous mode's delayed read", async () => {
  const original = globalThis.fetch;
  try {
    for (const initialMode of [false, true]) {
      const replies = [];
      const resultFor = supervised => supervised ? supervisedCorrectionReviewExecution() : correctionReviewExecution();
      globalThis.fetch = async (url, options) => new Promise(resolve => replies.push({ url, resolve, signal: options.signal }));
      const h = harness({ supervised: initialMode });
      try {
        h.mount();replies[0].resolve(Response.json({ state: "checked", result: resultFor(initialMode) }));await settle();
        assert.match(h.markup(), /Four invented reports stayed private/);
        const nextMode = !initialMode;
        assert.doesNotMatch(h.switchMode(nextMode), /Four invented reports|worker had finished|Recorded <time/);
        assert.match(h.markup(), /Reading the saved result/);
        assert.equal(replies[1].url, nextMode ? "/api/dev/supervised-correction-review" : "/api/dev/correction-review");
        // Change back before the second reply; no saved previous-mode state
        // is resurrected while its new observation remains pending.
        assert.doesNotMatch(h.switchMode(initialMode), /Four invented reports|worker had finished|Recorded <time/);
        assert.equal(replies[1].signal.aborted, true);
        assert.equal(replies.length, 2); assert.equal(h.button().disabled, true);
        replies[1].resolve(Response.json({ state: "checked", result: resultFor(nextMode) }));await settle();
        assert.match(h.markup(), /Check the saved result to request a new observation/);
        h.button().onClick(); assert.equal(replies.length, 3);
        replies[2].resolve(Response.json({ state: "checked", result: resultFor(initialMode) }));await settle();
        assert.match(h.markup(), /Four invented reports stayed private/);
        assert.equal(h.markup().includes("worker had finished"), initialMode);
      } finally { h.unmount(); }
    }
  } finally { globalThis.fetch = original; }
});

test("supervised page reads the fixed completed journal and dates its worker-exit evidence", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, "/api/dev/supervised-correction-review"); assert.equal(options.method, "GET"); assert.ok(!options.body);
    return Response.json({ state: "checked", result: supervisedCorrectionReviewExecution() });
  };
  const h = harness({ supervised: true });
  try {
    h.mount(); await settle();
    const markup = h.markup();
    for (const text of ["Saved review and completion", "worker had finished", "does not show current account or process status", "Four invented reports stayed private"])
      assert.ok(markup.includes(text), text);
    h.button().onClick(); await settle(); assert.equal(calls, 2);
    assert.doesNotMatch(markup, /privateEvidenceDirectory|reportId|\/home\/dj|<form/);
  } finally { h.unmount(); globalThis.fetch = original; }
});

test("supervised page cannot promote an older manual result or missing worker-exit evidence", async () => {
  const original = globalThis.fetch;
  try {
    for (const result of [correctionReviewExecution(), { ...supervisedCorrectionReviewExecution(), workerExitObserved: false }]) {
      globalThis.fetch = async () => Response.json({ state: "checked", result });
      const h = harness({ supervised: true });
      try { h.mount(); await settle(); assert.match(h.markup(), /cannot repair or retry/); assert.doesNotMatch(h.markup(), /worker had finished|Four invented reports/); }
      finally { h.unmount(); }
    }
  } finally { globalThis.fetch = original; }
});

test("actual effect cleanup aborts an old page read and a new visit ignores its delayed result", async () => {
  const original = globalThis.fetch; const pending = [];
  globalThis.fetch = async (_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal }));
  const h = harness();
  try {
    h.mount(); h.unmount(); assert.equal(pending[0].signal.aborted, true); h.mount();
    assert.equal(pending.length, 1); assert.equal(h.button().disabled, true);
    pending[0].resolve(Response.json({ state: "checked", result: correctionReviewExecution() })); await settle();
    assert.doesNotMatch(h.markup(), /Four invented reports/);
    h.button().onClick(); pending[1].resolve(Response.json({ state: "idle" })); await settle();
    assert.match(h.markup(), /No retained trial has been started/); assert.doesNotMatch(h.markup(), /Four invented reports/);
  } finally { h.unmount(); globalThis.fetch = original; }
});

test("held, running and malformed observations show useful states without native retry controls or diagnostics", async () => {
  const original = globalThis.fetch;
  try {
    for (const value of [{ state: "held", reason: "private_test_unavailable" }, { state: "running" },
      { state: "checked", result: { ...correctionReviewExecution(), privateBody: "private-canary" } }]) {
      globalThis.fetch = async () => Response.json(value); const h = harness();
      try {
        h.mount(); await settle(); const markup = h.markup();
        assert.match(markup, value.state === "running" ? /manual trial is still running/ : /cannot repair or retry/);
        assert.doesNotMatch(markup, /canary|Start.*trial|Run.*trial|<form/);
      } finally { h.unmount(); }
    }
  } finally { globalThis.fetch = original; }
});

for (const initialMode of [false, true]) {
  test(`retired ${initialMode ? "supervised" : "manual"} controls cannot read the earlier endpoint after a mode successor settles`, async t => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
      calls.push({ url, signal: options.signal });
      return Response.json({ state: "checked", result: url === "/api/dev/supervised-correction-review" ? supervisedCorrectionReviewExecution() : correctionReviewExecution() });
    });
    const h = harness({ supervised: initialMode });
    try {
      h.mount(); await settle(); const retired = h.button().onClick;
      h.switchMode(!initialMode); await settle(); const current = h.markup();
      assert.match(current, /Four invented reports stayed private/);
      retired(); await settle(); assert.equal(calls.length, 2); assert.equal(h.markup(), current);
      h.button().onClick(); await settle(); assert.equal(calls.length, 3);
      assert.equal(calls[2].url, initialMode ? "/api/dev/correction-review" : "/api/dev/supervised-correction-review");
      assert.match(h.markup(), /Four invented reports stayed private/);
    } finally { h.unmount(); }
  });
}

test("same-mode cleanup and effect recreation cannot revive a retired read control", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ state: "checked", result: correctionReviewExecution() }); });
  const h = harness();
  try {
    h.mount(); await settle(); const retired = h.button().onClick;
    h.unmount(); h.mount(); await settle(); const current = h.markup();
    retired(); await settle(); assert.equal(calls, 2); assert.equal(h.markup(), current);
    h.button().onClick(); await settle(); assert.equal(calls, 3); assert.match(h.markup(), /Four invented reports stayed private/);
  } finally { h.unmount(); }
});

test("a control captured before effect admission or retained after cleanup cannot dispatch", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ state: "idle" }); });
  const h = harness(), before = h.button().onClick;
  assert.equal(h.button().disabled, true);
  try {
    h.mount(); await settle(); before(); await settle(); assert.equal(calls, 1);
    const retired = h.button().onClick; h.unmount(); const current = h.markup();
    retired(); await settle(); assert.equal(calls, 1); assert.equal(h.markup(), current);
    h.mount(); await settle(); assert.equal(calls, 2); assert.equal(h.button().disabled, false);
    h.button().onClick(); await settle(); assert.equal(calls, 3);
  } finally { h.unmount(); }
});
