import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === "object" ? [x, ...nodes(x.props?.children)] : [];
const text = x => Array.isArray(x) ? x.map(text).join("") : x && typeof x === "object" ? text(x.props?.children) : String(x ?? "");
const baseline = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url)));
function receipt(later = false) {
  return { execution: { id: later ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "local_fictional", scenario: later ? "revised_value" : "standard", executedAt: later ? "2026-10-10T10:01:00Z" : "2026-10-10T10:00:00Z", durationMs: 1 },
    report: later ? JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json", import.meta.url))) : structuredClone(baseline) };
}
function desk() {
  let cursor = 0, effects = [], cleanups = []; const cells = [], updates = [];
  const hooks = { useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial;
    return [cells[i], value => { const next = typeof value === "function" ? value(cells[i]) : value;
      updates.push({ before: cells[i], after: next }); cells[i] = next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useEffect(callback) { effects.push(callback); } };
  const saved = loadTsx(new URL("../src/fictional-saved-run-view.tsx", import.meta.url));
  const pair = loadTsx(new URL("../app/editorial-preview/saved-run-comparison.tsx", import.meta.url));
  const comparison = loadTsx(new URL("../app/update-preview/comparison.tsx", import.meta.url));
  const History = () => null;
  const parent = loadTsx(new URL("../app/editorial-preview/fictional-review-desk.tsx", import.meta.url), name =>
    name === "react" ? hooks : name === "../update-preview/history" ? { FictionalHistory: History } :
    name === "../../src/fictional-saved-run-view" ? saved : name === "./saved-run-comparison" ? pair :
    name === "../update-preview/comparison" ? comparison : undefined);
  const render = () => { cursor = 0; effects = []; return parent.FictionalReviewDesk({ baseline }); };
  const history = () => nodes(render()).find(x => x.type === History).props;
  return { render, updates, mount() { render(); cleanups = effects.map(fn => fn()).filter(fn => typeof fn === "function"); },
    unmount() { for (const fn of cleanups) fn(); }, inspect(value) { history().onInspect(value); }, earlier(value) { history().onUseEarlier(value); },
    clear() { nodes(render()).find(x => x.type === "button" && text(x.props.children) === "Clear comparison selection").props.onClick(); },
    guard(kind) { const type = kind === "pair" ? pair.SavedRunComparison : kind === "baseline" ? comparison.FictionalComparison : saved.FictionalSavedRunView;
      const node = nodes(render()).find(x => x.type === type); assert.ok(node); return node.props.isCurrent ?? (() => true); } };
}
test("selected archive replacement retires the earlier pair while preserving the new selected result", () => {
  const ui = desk(); ui.mount(); ui.earlier(receipt()); ui.inspect(receipt(true)); const guard = ui.guard("pair");
  assert.equal(guard(), true); ui.inspect(receipt(true)); assert.equal(guard(), false); assert.equal(ui.guard("selected")(), true); ui.unmount();
});
test("earlier selection and clearing retire old paired exports without retiring the selected full run", () => {
  const ui = desk(); ui.mount(); ui.earlier(receipt()); ui.inspect(receipt(true));
  const pair = ui.guard("pair"), selected = ui.guard("selected"); ui.earlier(receipt());
  assert.equal(pair(), false); assert.equal(selected(), true);
  const next = ui.guard("pair"); ui.clear(); assert.equal(next(), false); assert.equal(selected(), true); ui.unmount();
});
test("reselecting the same earlier object creates a new state owner rather than an equal-reference bailout", () => {
  const ui = desk(), earlier = receipt(); ui.mount(); ui.earlier(earlier); ui.inspect(receipt(true)); const guard = ui.guard("pair");
  ui.earlier(earlier); const update = ui.updates.at(-1);
  assert.notStrictEqual(update.before, update.after); assert.equal(guard(), false); assert.equal(ui.guard("pair")(), true); ui.unmount();
});
test("baseline and paired comparison guards retire on parent unmount", () => {
  const first = desk(); first.mount(); first.inspect(receipt(true)); const baseline = first.guard("baseline");
  first.unmount(); assert.equal(baseline(), false);
  const second = desk(); second.mount(); second.earlier(receipt()); second.inspect(receipt(true)); const pair = second.guard("pair");
  second.unmount(); assert.equal(pair(), false);
});
