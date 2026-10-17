import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const baseline = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url)));
const receipt = id => ({ execution: { id, kind: "local_fictional", scenario: "standard",
  executedAt: "2026-10-01T12:00:00.000001Z", durationMs: 1 }, report: structuredClone(baseline) });
const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === "object" ? [x, ...nodes(x.props?.children)] : [];
const text = x => Array.isArray(x) ? x.map(text).join("") : x && typeof x === "object" ? text(x.props?.children) : String(x ?? "");

function desk() {
  let cursor = 0, admission; const cells = [], diagnostics = [];
  const History = () => null, Saved = () => null, Pair = () => null, Fallback = () => null;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial;
      return [cells[i], value => { cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useLayoutEffect() {}, useEffect(fn, deps) { if (deps.length === 0) admission = fn; },
  };
  const Component = loadTsx(new URL("../app/editorial-preview/fictional-review-desk.tsx", import.meta.url), name =>
    name === "react" ? hooks : name === "../update-preview/history" ? { FictionalHistory: History } :
    name === "../../src/fictional-saved-run-view" ? { FictionalSavedRunView: Saved } :
    name === "./saved-run-comparison" ? { SavedRunComparison: Pair } :
    name === "../update-preview/comparison" ? { FictionalComparison: Fallback } :
    name === "../../src/client-error-diagnostics.ts" ? { observeClientError: code => diagnostics.push(code) } : undefined).FictionalReviewDesk;
  const render = () => { cursor = 0; return Component({ baseline }); };
  const child = type => nodes(render()).find(x => x.type === type);
  render(); admission?.();
  return { diagnostics, html: () => renderToStaticMarkup(render()),
    earlier(value) { child(History).props.onUseEarlier(value); },
    inspect(value) { child(History).props.onInspect(value); },
    hasInspected: () => Boolean(child(Saved)),
    clear(label) { const button = nodes(render()).find(x => x.type === "button" && text(x) === label);
      assert.ok(button); button.props.onClick(); },
  };
}
function reference(html, run) {
  const matches = [...html.matchAll(/<details><summary>Earlier saved execution reference<\/summary>([\s\S]*?)<\/details>/g)];
  assert.equal(matches.length, 1, "the checked earlier-only selection must expose one exact saved execution reference");
  assert.ok(matches[0][1].includes(`<code>${run.execution.id}</code>`));
  assert.ok(html.includes(`<time dateTime="${run.execution.executedAt}">${run.execution.executedAt}</time>`));
}

test("earlier-only selections distinguish different saved executions with the same exact UTC time", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("showing a checked reference must not request or start work"));
  const a = receipt(first), b = receipt(second), before = JSON.stringify({ a, b }), ui = desk();
  ui.earlier(a); const initial = ui.html(); reference(initial, a);
  assert.equal(ui.hasInspected(), false); assert.ok(!initial.includes(second));
  ui.earlier(b); const replacement = ui.html(); reference(replacement, b);
  assert.ok(!replacement.includes(first)); assert.notEqual(initial, replacement);
  assert.equal(ui.hasInspected(), false);
  assert.equal(JSON.stringify({ a, b }), before); assert.deepEqual(ui.diagnostics, []);
});

test("earlier reference is withheld on invalid replacement and removed by either established clear action", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("local selection and clear must not request or start work"));
  for (const action of ["Clear comparison selection", "Clear inspected run and comparison", "invalid"]) {
    const ui = desk(), a = receipt(first); ui.earlier(a); reference(ui.html(), a);
    if (action === "invalid") {
      ui.earlier({ ...receipt(second), privateNote: "PRIVATE_EARLIER_SELECTION_CANARY" });
      const html = ui.html(); assert.ok(html.includes("Earlier run unavailable"));
      assert.ok(!html.includes(first) && !html.includes(second) && !html.includes("PRIVATE_EARLIER_SELECTION_CANARY"));
    } else {
      if (action === "Clear inspected run and comparison") ui.inspect(receipt(second));
      ui.clear(action); assert.ok(!ui.html().includes(first));
    }
    assert.ok(!ui.html().includes("Earlier saved execution reference"));
    assert.deepEqual(ui.diagnostics, []);
  }
});
