import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const baseline = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url)));
const revised = JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json", import.meta.url)));
const receipt = later => ({ execution: { id: later ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  kind: "local_fictional", scenario: later ? "revised_value" : "standard",
  executedAt: later ? "2026-10-05T10:01:00Z" : "2026-10-05T10:00:00Z", durationMs: 1 }, report: structuredClone(later ? revised : baseline) });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object"
  ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object"
  ? text(value.props?.children) : String(value ?? "");

function desk() {
  let cursor = 0, changes = 0;
  const cells = [], pending = [], cleanups = [], layouts = [], diagnostics = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial;
      return [cells[i], value => { changes++; cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useLayoutEffect(callback) { const i = cursor++; if (!(i in cells)) { cells[i] = true; layouts.push(callback()); } },
    useEffect(callback, dependencies) { const i = cursor++, old = cells[i];
      if (!old || dependencies.some((value, index) => !Object.is(value, old[index]))) {
        cells[i] = dependencies; pending.push(callback);
      }
    },
  };
  const History = () => null, Saved = () => null, Pair = () => null, Observation = () => null;
  const component = loadTsx(new URL("../app/editorial-preview/fictional-review-desk.tsx", import.meta.url), name =>
    name === "react" ? hooks : name === "../update-preview/history" ? { FictionalHistory: History } :
    name === "../../src/fictional-saved-run-view" ? { FictionalSavedRunView: Saved } :
    name === "./saved-run-comparison" ? { SavedRunComparison: Pair } :
    name === "../update-preview/comparison" ? { FictionalComparison: Observation } :
    name === "../../src/client-error-diagnostics.ts" ? { observeClientError: code => diagnostics.push(code) } : undefined).FictionalReviewDesk;
  const render = () => { cursor = 0; return component({ baseline }); };
  const find = (type, tree = render()) => nodes(tree).find(node => node.type === type);
  const flush = () => { for (const callback of pending.splice(0)) { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); } };
  render(); flush();
  return { render, diagnostics, changes: () => changes, flush,
    inspect(value) { find(History).props.onInspect(value); }, earlier(value) { find(History).props.onUseEarlier(value); },
    selected: () => find(Saved), pair: () => find(Pair) ?? find(Observation),
    clear() { const action = nodes(render()).find(node => node.type === "button" && text(node) === "Clear inspected run and comparison");
      assert.ok(action, "an inspected saved run needs an explicit local clear action"); return action.props.onClick; },
    oldNavigation(target) { const tree = render(); const panel = nodes(tree).find(node => node.props?.tabIndex === -1);
      assert.ok(panel); panel.props.ref.current = target; return pending.pop(); },
    unmount() { for (const cleanup of layouts.splice(0)) cleanup?.(); pending.length = 0; for (const cleanup of cleanups.splice(0)) cleanup(); },
  };
}

test("explicit clear retires saved result and pair before render while preserving complete saved input bytes", () => {
  const ui = desk(), earlier = receipt(false), later = receipt(true), before = JSON.stringify({ earlier, later });
  ui.earlier(earlier); ui.inspect(later);
  const saved = ui.selected(), pair = ui.pair(), clear = ui.clear();
  assert.equal(saved.props.isCurrent(), true); assert.equal(pair.props.isCurrent(), true);
  clear();
  assert.equal(saved.props.isCurrent(), false); assert.equal(pair.props.isCurrent(), false);
  const tree = ui.render();
  assert.ok(text(tree).includes("No saved run selected"));
  assert.ok(!ui.selected() && !ui.pair());
  assert.ok(!text(tree).includes("Earlier run selected"));
  assert.equal(JSON.stringify({ earlier, later }), before); assert.deepEqual(ui.diagnostics, []);
});

test("captured clear callbacks cannot remove a successor saved run or a newer earlier-run pairing", () => {
  for (const replace of [ui => ui.inspect(receipt(false)), ui => ui.earlier(receipt(false))]) {
    const ui = desk(); ui.inspect(receipt(true)); const old = ui.clear();
    replace(ui); const current = ui.selected(), changes = ui.changes();
    old();
    assert.equal(ui.changes(), changes); assert.equal(current.props.isCurrent(), true);
    assert.ok(ui.selected()); assert.deepEqual(ui.diagnostics, []);
  }
});

test("clear retires pending optional navigation and its notice then an explicit new selection works", () => {
  const ui = desk(), calls = []; ui.inspect(receipt(true));
  const effect = ui.oldNavigation({ scrollIntoView() { calls.push("scroll"); }, focus() { calls.push("focus"); } });
  ui.clear()(); effect(); assert.deepEqual(calls, []); assert.deepEqual(ui.diagnostics, []);
  ui.inspect(receipt(false)); assert.equal(ui.selected().props.isCurrent(), true);
  ui.flush(); assert.ok(!text(ui.render()).includes("Automatic navigation was unavailable"));
});

test("clear is available for invalid selected data and stale clear after unmount cannot update state", () => {
  const ui = desk(); ui.inspect({ ...receipt(false), privateNote: "PRIVATE_CANARY" });
  assert.equal(ui.selected().props.input, null);
  const clear = ui.clear(); assert.ok(!text(ui.render()).includes("PRIVATE_CANARY"));
  clear(); assert.ok(text(ui.render()).includes("No saved run selected"));
  ui.inspect(receipt(true)); const retired = ui.clear(); ui.unmount(); const changes = ui.changes();
  retired(); assert.equal(ui.changes(), changes); assert.deepEqual(ui.diagnostics, []);
});

test("empty desk retains its existing history controls and has no clear action or request", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("local clear must not request history or an update"));
  const ui = desk(); assert.ok(text(ui.render()).includes("No saved run selected"));
  assert.ok(!text(ui.render()).includes("Clear inspected run and comparison"));
  assert.deepEqual(ui.diagnostics, []);
});
