import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { FictionalUpdateRequestError } from "../src/fictional-update-request.ts";
const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === "object" ? [x, ...nodes(x.props?.children)] : [];
const baseline = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url)));
const tick = () => new Promise(resolve => setImmediate(resolve));
function receipt(id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") {
  return { execution: { id, kind: "local_fictional", scenario: "revised_value", executedAt: "2026-10-10T10:01:00Z", durationMs: 1 },
    report: JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json", import.meta.url))) };
}
function operation() {
  let cursor = 0, effects = [], cleanups = [], resolve, reject; const cells = [], requests = [], codes = [];
  const hooks = { useId: () => "operation-port", useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial;
    return [cells[i], value => { cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useEffect(fn) { effects.push(fn); } };
  const History = () => null, comparison = loadTsx(new URL("../app/update-preview/comparison.tsx", import.meta.url));
  const parent = loadTsx(new URL("../app/update-preview/operation.tsx", import.meta.url), name =>
    name === "react" ? hooks : name === "./history" ? { FictionalHistory: History } : name === "./comparison" ? comparison :
    name === "../../src/client-error-diagnostics.ts" ? { observeClientError: code => codes.push(code) } :
    name === "../../src/fictional-update-request" ? { FictionalUpdateRequestError, requestFictionalUpdate(...args) {
      requests.push(args); return new Promise((yes, no) => { resolve = yes; reject = no; }); } } : undefined);
  const render = () => { cursor = 0; effects = []; return parent.UpdateOperation({ initialReport: baseline }); };
  return { render, requests, codes, mount() { render(); cleanups = effects.map(fn => fn()).filter(fn => typeof fn === "function"); render(); },
    unmount() { for (const fn of cleanups) fn(); }, remount() { this.unmount(); render(); cleanups = effects.map(fn => fn()).filter(fn => typeof fn === "function"); render(); },
    select(value) { nodes(render()).find(x => x.type === History).props.onInspect(value); },
    run() { nodes(render()).find(x => x.type === "form").props.onSubmit({ preventDefault() {} }); },
    guard() { const value = nodes(render()).find(x => x.type === comparison.FictionalComparison); assert.ok(value); return value.props.isCurrent ?? (() => true); },
    key() { return nodes(render()).find(x => x.type === comparison.FictionalComparison).key; },
    finish(value = receipt("cccccccc-cccc-4ccc-8ccc-cccccccccccc")) { resolve(value); }, fail() { reject(new Error("PRIVATE_REQUEST")); } };
}
test("saved-result replacement and same-object reinspection retire the previous comparison owner", () => {
  const ui = operation(), value = receipt(); ui.mount(); ui.select(value); const first = ui.guard(), key = ui.key();
  ui.select(value); assert.equal(first(), false); assert.equal(ui.guard()(), true); assert.notEqual(ui.key(), key); ui.unmount();
});
test("starting a rehearsal retires prior comparison export while the physical request owns its slot", async () => {
  const ui = operation(); ui.mount(); ui.select(receipt()); const old = ui.guard();
  ui.run(); assert.equal(old(), false); assert.equal(ui.guard()(), false); ui.run(); ui.select(receipt());
  assert.equal(ui.requests.length, 1); assert.equal(ui.requests[0][0], "manual"); assert.equal(ui.requests[0][1], "standard");
  ui.finish(); await tick(); assert.equal(old(), false); assert.equal(ui.guard()(), true); ui.unmount();
});
test("an unconfirmed request preserves old displayed result but cannot revive its retired comparison callback", async () => {
  const ui = operation(); ui.mount(); ui.select(receipt()); const old = ui.guard(), key = ui.key();
  ui.run(); ui.fail(); await tick(); assert.equal(old(), false); assert.equal(ui.guard()(), true); assert.notEqual(ui.key(), key);
  assert.equal(ui.requests.length, 1); assert.deepEqual(ui.codes, ["update_request"]); ui.unmount();
});
test("unmount and effect recreation deny prior comparison guards and old physical results", async () => {
  const ui = operation(); ui.mount(); ui.select(receipt()); const old = ui.guard(); ui.run();
  const signal = ui.requests[0][2]; ui.remount(); assert.equal(old(), false); assert.equal(signal.aborted, true);
  ui.finish(); await tick(); assert.equal(nodes(ui.render()).some(x => x.type?.name === "FictionalComparison"), false);
  ui.select(receipt()); assert.equal(ui.guard()(), true); ui.unmount(); assert.equal(old(), false);
});
test("pending-render comparison callbacks cannot revive after a failed physical request settles", async () => {
  const ui = operation(); ui.mount(); ui.select(receipt()); ui.run();
  const pending = ui.guard(), key = ui.key(); assert.equal(pending(), false);
  ui.fail(); await tick();
  assert.equal(pending(), false); assert.equal(ui.guard()(), true); assert.notEqual(ui.key(), key);
  assert.equal(ui.requests.length, 1); assert.deepEqual(ui.codes, ["update_request"]); ui.unmount();
});
