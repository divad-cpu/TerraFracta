import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { handleFictionalHistoryPageRequest } from "../src/server/fictional-receipt-page.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const report = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url)));
const entries = [1, 2].map(number => ({ execution: { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, "0")}`,
  kind: "local_fictional", scenario: "standard", executedAt: `2026-10-01T12:00:00.00000${number}Z`, durationMs: 1 }, report: structuredClone(report) }));
const inventory = () => ({ entries, totalReceipts: 2, unreadableReceipts: 0, pendingReceipts: 0, stableSnapshot: true });
const turn = () => new Promise(resolve => setImmediate(resolve));
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object"
  ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object"
  ? text(value.props?.children) : String(value ?? "");
function history() {
  let cursor = 0, effect, cleanup, layout, layoutCleanup; const cells = [], inspected = [], logs = [];
  const hooks = { useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial;
    return [cells[i], value => { cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useLayoutEffect(callback) { layout = callback; }, useEffect(callback) { effect = callback; } };
  const component = loadTsx(new URL("../app/update-preview/history.tsx", import.meta.url), name => name === "react" ? hooks :
    name.endsWith("client-error-diagnostics.ts") ? { observeClientError: code => logs.push(code) } : undefined).FictionalHistory;
  const render = () => { cursor = 0; return component({ onInspect: value => inspected.push(value) }); };
  return { markup: () => renderToStaticMarkup(render()), inspected, logs,
    mount() { render(); layoutCleanup = layout?.(); cleanup = effect(); }, unmount() { layoutCleanup?.(); cleanup?.(); },
    load() { nodes(render()).find(node => node.type === "button" && text(node) === "Load filtered runs").props.onClick(); },
    inspect() { nodes(render()).find(node => node.type === "button" && text(node).startsWith("Inspect saved run")).props.onClick(); },
  };
}
function disclosures(html) {
  const groups = [...html.matchAll(/<details><summary>Exact saved run reference<\/summary>([\s\S]*?)<\/details>/g)];
  assert.equal(groups.length, 2, "each checked saved-history row needs a visible optional exact reference");
  return groups.map(group => group[1]);
}

test("history exposes exact UTC microseconds and immutable saved execution references beside the unchanged human overview", async t => {
  const before = JSON.stringify(entries), calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push([url, options.method]);
    return handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => inventory());
  });
  const ui = history(); ui.mount();
  try {
    ui.load(); await turn(); const html = ui.markup(), visible = disclosures(html);
    assert.ok(html.includes("Oslo · weekly rehearsal"));
    for (const [index, row] of [...entries].reverse().entries()) {
      assert.ok(visible[index].includes(`<code>${row.execution.id}</code>`));
      assert.ok(visible[index].includes(`<time dateTime="${row.execution.executedAt}">${row.execution.executedAt}</time>`));
    }
    ui.inspect(); assert.deepEqual(ui.inspected, [entries[1]]);
    assert.deepEqual(calls, [["/api/dev/update-rehearsal/history/page", "GET"]]);
    assert.equal(JSON.stringify(entries), before); assert.deepEqual(ui.logs, []);
  } finally { ui.unmount(); }
});

test("changed archive refresh removes all old visible execution references with the existing held rows", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async url => ++calls === 1
    ? handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => inventory())
    : Response.json({ error: "fictional_history_changed" }, { status: 409 }));
  const ui = history(); ui.mount();
  try {
    ui.load(); await turn(); disclosures(ui.markup());
    ui.load(); assert.ok(!ui.markup().includes("Exact saved run reference")); await turn();
    const held = ui.markup(); assert.ok(held.includes("saved archive changed between pages"));
    for (const row of entries) assert.ok(!held.includes(row.execution.id) && !held.includes(row.execution.executedAt));
    assert.ok(!held.includes("Exact saved run reference") && !held.includes("Inspect saved run"));
    assert.equal(calls, 2); assert.deepEqual(ui.logs, []);
  } finally { ui.unmount(); }
});
