import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url)));
const baseline = fixture("fictional_update_report"), revised = fixture("fictional_revised_update_report");
const receipt = later => ({ execution: { id: later ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  kind: "local_fictional", scenario: later ? "revised_value" : "standard", executedAt: later ? "2026-10-05T10:01:00Z" : "2026-10-05T10:00:00Z", durationMs: 1 },
  report: structuredClone(later ? revised : baseline) });
const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === "object" ? [x, ...nodes(x.props?.children)] : [];
const text = x => Array.isArray(x) ? x.map(text).join("") : x && typeof x === "object" ? text(x.props?.children) : String(x ?? "");
function desk() {
  let cursor = 0, updates = 0, cleanup, layoutCleanup; const cells = [];
  const History = () => null, Saved = () => null, Pair = () => null, Fallback = () => null;
  const hooks = { useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial;
    return [cells[i], value => { updates++; cells[i] = value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useEffect(callback, deps) { if (deps.length === 0 && !cleanup) cleanup = callback(); },
    useLayoutEffect(callback, deps) { if (deps.length === 0 && !layoutCleanup) layoutCleanup = callback(); } };
  const Component = loadTsx(new URL("../app/editorial-preview/fictional-review-desk.tsx", import.meta.url), name => name === "react" ? hooks :
    name === "../update-preview/history" ? { FictionalHistory: History } : name === "../../src/fictional-saved-run-view" ? { FictionalSavedRunView: Saved } :
    name === "./saved-run-comparison" ? { SavedRunComparison: Pair } : name === "../update-preview/comparison" ? { FictionalComparison: Fallback } :
    name === "../../src/client-error-diagnostics.ts" ? { observeClientError() { assert.fail("clear is not a technical fault"); } } : undefined).FictionalReviewDesk;
  const render = () => { cursor = 0; return Component({ baseline }); };
  const child = type => nodes(render()).find(node => node.type === type);
  render();
  return { updates: () => updates, unmount() { layoutCleanup(); cleanup(); },
    inspect(value) { child(History).props.onInspect(value); }, earlier(value) { child(History).props.onUseEarlier(value); },
    selected: () => child(Saved), pair: () => child(Pair), fallback: () => child(Fallback),
    clear() { const button = nodes(render()).find(node => node.type === "button" && text(node) === "Clear comparison selection"); assert.ok(button); return button.props.onClick; },
  };
}

test("retained earlier-only clear cannot erase a newer earlier run while the inspected run remains", () => {
  const ui = desk(); ui.inspect(receipt(true)); ui.earlier(receipt(false)); const old = ui.clear();
  const next = receipt(false); next.execution.id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; next.execution.executedAt = "2026-10-05T10:00:30Z";
  ui.earlier(next); const pair = ui.pair(), updates = ui.updates(); old();
  assert.equal(ui.updates(), updates); assert.ok(ui.pair());
  assert.equal(pair.props.isCurrent(), true); assert.equal(ui.pair().props.earlier.execution.id, next.execution.id);
  assert.equal(ui.selected().props.isCurrent(), true);
});

test("same-object reselection and a successor inspected run retire an earlier-only clear callback", () => {
  for (const successor of ["earlier", "selected"]) {
    const ui = desk(), earlier = receipt(false); ui.inspect(receipt(true)); ui.earlier(earlier); const old = ui.clear();
    if (successor === "earlier") ui.earlier(earlier); else ui.inspect(receipt(true));
    const pair = ui.pair(), updates = ui.updates(); old();
    assert.equal(ui.updates(), updates); assert.ok(ui.pair()); assert.equal(pair.props.isCurrent(), true);
  }
});

test("current earlier-only clear preserves inspected run and its established baseline fallback without changing saved bytes", () => {
  const ui = desk(), earlier = receipt(false), later = receipt(true), before = JSON.stringify({ earlier, later });
  ui.inspect(later); ui.earlier(earlier); const pair = ui.pair(), selected = ui.selected(); ui.clear()();
  assert.equal(pair.props.isCurrent(), false); assert.equal(selected.props.isCurrent(), true);
  assert.ok(!ui.pair()); assert.ok(ui.fallback()); assert.equal(ui.fallback().props.isCurrent(), true);
  assert.equal(JSON.stringify({ earlier, later }), before);
});

test("unmount retires a retained earlier-only clear without dispatching React state", () => {
  const ui = desk(); ui.inspect(receipt(true)); ui.earlier(receipt(false)); const old = ui.clear();
  ui.unmount(); const updates = ui.updates(); old(); assert.equal(ui.updates(), updates);
});
