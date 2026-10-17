import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { handleFictionalHistoryPageRequest } from "../src/server/fictional-receipt-page.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const report = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url)));
const entries = Array.from({ length: 12 }, (_, i) => ({ execution: {
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`, kind: "local_fictional", scenario: "standard",
  executedAt: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z`, durationMs: 1,
}, report: { ...structuredClone(report), trigger: "manual", scheduledDueAt: null } }));
const inventory = () => ({ entries, totalReceipts: 12, unreadableReceipts: 0, pendingReceipts: 0, stableSnapshot: true });
const turn = () => new Promise(resolve => setImmediate(resolve));
const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === "object" ? [x, ...nodes(x.props?.children)] : [];
const text = x => Array.isArray(x) ? x.map(text).join("") : x && typeof x === "object" ? text(x.props?.children) : String(x ?? "");
function history() {
  let cursor = 0, effect, cleanup, layout, layoutCleanup, writes = 0; const cells = [], logs = [], inspected = [], earlier = [];
  const hooks = { useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial;
    return [cells[i], value => { writes++; cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useLayoutEffect(callback) { layout = callback; }, useEffect(callback) { effect = callback; } };
  const Component = loadTsx(new URL("../app/update-preview/history.tsx", import.meta.url), name => name === "react" ? hooks :
    name.endsWith("client-error-diagnostics.ts") ? { observeClientError: code => logs.push(code) } : undefined).FictionalHistory;
  const render = () => { cursor = 0; return Component({ onInspect: value => inspected.push(value), onUseEarlier: value => earlier.push(value) }); };
  const buttons = () => nodes(render()).filter(n => n.type === "button");
  return { render, logs, inspected, earlier, writes: () => writes,
    mount() { render(); layoutCleanup = layout?.(); cleanup = effect(); }, unmount() { layoutCleanup?.(); cleanup?.(); },
    button(label) { const result = buttons().find(n => text(n).startsWith(label)); assert.ok(result, label); return result.props; },
    hasButton: label => buttons().some(n => text(n).startsWith(label)),
    change(index, value) { nodes(render()).filter(n => n.type === "select")[index].props.onChange({ target: { value } }); },
    selections: () => nodes(render()).filter(n => n.type === "select").map(n => n.props.value),
    submit() { nodes(render()).find(n => n.type === "form").props.onSubmit({ preventDefault() {} }); },
    html: () => renderToStaticMarkup(render()),
  };
}
function transport(t, beforeRead = async () => {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push([url, options.method, options.body]); await beforeRead(calls.length);
    return handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), {
      headers: { "sec-fetch-site": "same-origin" }, signal: options.signal,
    }), "development", async () => inventory());
  });
  return calls;
}

test("show-all resets both draft history filters and reads a fresh first page without selecting or modifying a receipt", async t => {
  const calls = transport(t), before = JSON.stringify(entries), ui = history(); ui.mount();
  try {
    ui.change(0, "missing_source"); ui.change(1, "scheduled"); assert.equal(calls.length, 0);
    assert.ok(ui.hasButton("Show all saved runs")); ui.button("Show all saved runs").onClick();
    assert.deepEqual(ui.selections(), ["", ""]); await turn();
    assert.deepEqual(calls, [["/api/dev/update-rehearsal/history/page", "GET", undefined]]);
    assert.ok(ui.html().includes("Page 1 of 2") && ui.html().includes("12 readable runs match all examples / all triggers"));
    assert.ok(!ui.hasButton("Show all saved runs"));
    assert.deepEqual(ui.inspected, []); assert.deepEqual(ui.earlier, []); assert.deepEqual(ui.logs, []);
    assert.equal(JSON.stringify(entries), before);
  } finally { ui.unmount(); }
});

test("show-all leaves an observed filtered older page without carrying its filter or snapshot and immediately retires its row controls", async t => {
  let finish; const calls = transport(t, async n => { if (n === 3) await new Promise(resolve => { finish = resolve; }); });
  const ui = history(); ui.mount();
  try {
    ui.change(0, "standard"); ui.change(1, "manual"); ui.submit(); await turn();
    ui.button("Older matching runs").onClick(); await turn(); assert.ok(ui.html().includes("Page 2 of 2"));
    assert.ok(calls[1][0].includes("page=2&scenario=standard&trigger=manual&snapshot="));
    const inspect = ui.button("Inspect saved run").onClick, earlier = ui.button("Use as earlier run").onClick;
    const oldPage = ui.button("Newer matching runs").onClick;
    // Empty draft controls do not erase the observed filter scope until a read.
    ui.change(0, ""); ui.change(1, ""); assert.ok(ui.hasButton("Show all saved runs"));
    const clear = ui.button("Show all saved runs").onClick; clear(); inspect(); earlier(); oldPage(); clear();
    assert.equal(calls.length, 3); assert.equal(calls[2][0], "/api/dev/update-rehearsal/history/page");
    assert.deepEqual(ui.inspected, []); assert.deepEqual(ui.earlier, []); assert.ok(!ui.html().includes("Exact saved run reference"));
    finish(); await turn(); inspect(); earlier(); oldPage();
    assert.equal(calls.length, 3); assert.ok(ui.html().includes("Page 1 of 2"));
    ui.button("Inspect saved run").onClick(); assert.deepEqual(ui.inspected, [entries[11]]); assert.deepEqual(ui.logs, []);
  } finally { finish?.(); await turn(); ui.unmount(); }
});

test("a retained show-all control cannot overlap an unfinished deadline read or write after cleanup", async t => {
  let fire, settle, calls = 0;
  t.mock.method(globalThis, "setTimeout", (callback, ms) => { assert.equal(ms, 5000); fire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Promise(resolve => { settle = resolve; }); });
  const ui = history(); ui.mount(); ui.change(0, "standard");
  const clear = ui.button("Show all saved runs").onClick; ui.submit(); const busyWrites = ui.writes();
  clear(); assert.equal(calls, 1); assert.equal(ui.writes(), busyWrites); assert.deepEqual(ui.selections(), ["standard", ""]);
  fire(); await turn(); const afterDeadline = ui.writes(); clear();
  assert.equal(calls, 1); assert.equal(ui.writes(), afterDeadline); assert.ok(ui.html().includes("original history read is still finishing"));
  ui.unmount(); const afterUnmount = ui.writes(); clear(); settle(Response.json({})); await turn();
  assert.equal(ui.writes(), afterUnmount); assert.equal(calls, 1); assert.deepEqual(ui.logs, []);
});

test("an unfiltered first page has no reset control and keeps the existing explicit load and filters", async t => {
  const calls = transport(t), ui = history(); ui.mount();
  try {
    assert.ok(!ui.hasButton("Show all saved runs")); ui.button("Load filtered runs").onClick(); await turn();
    assert.ok(!ui.hasButton("Show all saved runs")); assert.deepEqual(ui.selections(), ["", ""]);
    assert.equal(calls.length, 1); assert.ok(ui.html().includes("Apply history filters"));
    assert.ok(ui.html().includes("Page 1 of 2")); assert.deepEqual(ui.logs, []);
  } finally { ui.unmount(); }
});
