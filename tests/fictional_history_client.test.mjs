import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { handleFictionalHistoryPageRequest } from "../src/server/fictional-receipt-page.ts";
import { observeClientError } from "../src/client-error-diagnostics.ts";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
const rows = () => Array.from({ length: 10 }, (_, i) => ({ execution: { id: randomUUID(), kind: "local_fictional", scenario: "standard", executedAt: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`, durationMs: 1 }, report: structuredClone(fixture) }));
const inventory = entries => ({ entries, totalReceipts: entries.length, unreadableReceipts: 0, pendingReceipts: 0, stableSnapshot: true });
const turn = () => new Promise(resolve => setImmediate(resolve));
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : []; }
function text(node) { return Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : String(node ?? ""); }
// Actual component callbacks/parsers with only hook cells, notifications and
// transport replaced. This is in-process behavior, not DOM/hydration proof.
function harness(props = {}) {
  const file = new URL("../app/update-preview/history.tsx", import.meta.url), native = createRequire(file), exports = {}, cells = [], logs = [];
  let cursor = 0, effect, cleanup, writes = 0;
  const hooks = { useState(initial) { const id = cursor++; if (!(id in cells)) cells[id] = initial;
    return [cells[id], value => { writes++; cells[id] = typeof value === "function" ? value(cells[id]) : value; }]; },
    useRef(initial) { const id = cursor++; if (!(id in cells)) cells[id] = { current: initial }; return cells[id]; }, useEffect(callback) { effect = callback; } };
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", code)(name => name === "react" ? hooks : name.endsWith("client-error-diagnostics.ts") ? {
    observeClientError: code => observeClientError(code, async code => { logs.push(code); return null; }) }
    : name.startsWith(".") && existsSync(new URL(name + ".ts", file)) ? native(name + ".ts") : native(name), exports);
  const render = () => { cursor = 0; return exports.FictionalHistory({ onInspect() {}, ...props }); };
  return { render, setProps(next) { props = { ...props, ...next }; }, markup: () => renderToStaticMarkup(render()), mount() { render(); cleanup = effect(); }, unmount() { cleanup?.(); }, logs,
    get writes() { return writes; }, button(label) { const found = nodes(render()).find(node => node.type === "button" && text(node).startsWith(label)); assert.ok(found, label); return found.props; },
    submit() { nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); },
    select(index, value) { nodes(render()).filter(node => node.type === "select")[index].props.onChange({ target: { value } }); } };
}

test("shared history view loads older exact receipts and passes them to both inspection callbacks without starting a job", async t => {
  const entries = rows(), urls = [], inspected = [], earlier = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { urls.push(url); assert.equal(options.method, "GET"); assert.equal(options.body, undefined);
    return handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => inventory(entries)); });
  const ui = harness({ onInspect: row => inspected.push(row), onUseEarlier: row => earlier.push(row) });
  try {
    ui.mount(); ui.button("Load filtered").onClick(); await turn();
    assert.match(ui.markup(), /Page 1 of 2/); ui.button("Older matching").onClick(); await turn();
    assert.match(ui.markup(), /Page 2 of 2/); assert.ok(urls[1].includes('page=2&snapshot='));
    ui.button("Inspect saved").onClick(); ui.button("Use as earlier").onClick();
    assert.deepEqual(inspected, [entries[1]]); assert.deepEqual(earlier, [entries[1]]);
    ui.button("Newer matching").onClick(); await turn(); assert.match(ui.markup(), /Page 1 of 2/); assert.deepEqual(ui.logs, []);
  } finally { ui.unmount(); }
});
test("history filtering stays explicit and empty filtered observations never infer absent attempts", async t => {
  const entries = rows(), urls = [];
  t.mock.method(globalThis, "fetch", async url => { urls.push(url); return handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => inventory(entries)); });
  const ui = harness();
  try {
    ui.mount(); ui.select(0, "missing_source"); ui.select(1, "manual"); assert.equal(urls.length, 0);
    ui.submit(); await turn(); assert.ok(urls[0].includes('scenario=missing_source&trigger=manual'));
    assert.match(ui.markup(), /No readable run matches these filters/); assert.match(ui.markup(), /does not establish that earlier or incomplete attempts are absent/);
    assert.doesNotMatch(ui.markup(), /Older matching runs/);
  } finally { ui.unmount(); }
});
test("changed archive withholds an old page, asks for fresh loading and records no expected-change fault", async t => {
  let entries = rows();
  t.mock.method(globalThis, "fetch", async url => handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => inventory(entries)));
  const ui = harness();
  try {
    ui.mount(); ui.submit(); await turn(); entries = entries.slice(1);
    ui.button("Older matching").onClick(); await turn(); assert.match(ui.markup(), /archive changed between pages/);
    assert.doesNotMatch(ui.markup(), /Inspect saved run/); assert.deepEqual(ui.logs, []);
    ui.button("Load filtered").onClick(); await turn(); assert.match(ui.markup(), /Page 1 of 2/);
  } finally { ui.unmount(); }
});
test("history deadline notice retains one physical read, withholds late data and permits refresh only after settlement", async t => {
  let fire, resolve, calls = 0, owned;
  t.mock.method(globalThis, "setTimeout", (callback, ms) => { assert.equal(ms, 5000); fire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  t.mock.method(globalThis, "fetch", async (_url, options) => { calls++; owned = options.signal; return new Promise(done => { resolve = done; }); });
  const ui = harness();
  try {
    ui.mount(); ui.submit(); fire(); await turn();
    assert.equal(owned.aborted, true); assert.match(ui.markup(), /original history read is still finishing/);
    assert.equal(ui.button("Reading").disabled, true); ui.submit(); assert.equal(calls, 1);
    resolve(Response.json({})); await turn(); assert.match(ui.markup(), /Previous entries are withheld/);
    assert.equal(ui.button("Load filtered").disabled, false); assert.deepEqual(ui.logs, []);
  } finally { ui.unmount(); }
});
test("unmount prevents deadline and late-response writes, and synchronous repeat clicks share one history read", async t => {
  let fire, resolve, calls = 0;
  t.mock.method(globalThis, "setTimeout", callback => { fire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Promise(done => { resolve = done; }); });
  const ui = harness(); ui.mount(); ui.submit(); ui.submit(); assert.equal(calls, 1);
  ui.unmount(); const writes = ui.writes; fire(); resolve(Response.json({})); await turn();
  assert.equal(ui.writes, writes); assert.deepEqual(ui.logs, []);
});
test("unstable inventory exposes partial warning and disables page navigation without reading unknown evidence", async t => {
  const input = { ...inventory(rows()), stableSnapshot: false };
  t.mock.method(globalThis, "fetch", async () => handleFictionalHistoryPageRequest(new Request('http://127.0.0.1:3000/api/dev/update-rehearsal/history/page', { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => input));
  const ui = harness();
  try {
    ui.mount(); ui.submit(); await turn(); assert.match(ui.markup(), /partial observation/); assert.equal(ui.button("Older matching").disabled, true);
    assert.match(ui.markup(), /Inspect saved run/);
  } finally { ui.unmount(); }
});


test("history selection is withdrawn synchronously before a replacement read rerenders", async t => {
  const entries = rows(), inspected = [], earlier = [], calls = []; let finish;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 2) await new Promise(resolve => { finish = resolve; });
    return handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => inventory(entries));
  });
  const ui = harness({ onInspect: row => inspected.push(row), onUseEarlier: row => earlier.push(row) });
  try {
    ui.mount(); ui.submit(); await turn();
    const inspect = ui.button("Inspect saved").onClick, pin = ui.button("Use as earlier").onClick;
    const older = ui.button("Older matching").onClick;
    ui.button("Load filtered").onClick(); inspect(); pin(); older();
    assert.equal(calls.length, 2); assert.deepEqual(inspected, []); assert.deepEqual(earlier, []);
    finish(); await turn();
    // A new observation, even for the same archive/page, does not restore old controls.
    inspect(); pin(); older(); await turn();
    assert.equal(calls.length, 2); assert.deepEqual(inspected, []); assert.deepEqual(earlier, []);
    ui.button("Inspect saved").onClick(); ui.button("Use as earlier").onClick();
    assert.deepEqual(inspected, [entries[9]]); assert.deepEqual(earlier, [entries[9]]);
    ui.button("Older matching").onClick(); await turn(); assert.equal(calls.length, 3); assert.match(ui.markup(), /Page 2 of 2/);
  } finally { finish?.(); await turn(); ui.unmount(); }
});

test("a checked older history page cannot be replaced by the earlier page's retained controls", async t => {
  const entries = rows(), calls = [], inspected = [], earlier = [];
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(url); return handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => inventory(entries));
  });
  const ui = harness({ onInspect: row => inspected.push(row), onUseEarlier: row => earlier.push(row) });
  try {
    ui.mount(); ui.submit(); await turn();
    const inspect = ui.button("Inspect saved").onClick, pin = ui.button("Use as earlier").onClick, older = ui.button("Older matching").onClick;
    older(); await turn(); const current = ui.markup();
    inspect(); pin(); older(); await turn();
    assert.equal(calls.length, 2); assert.deepEqual(inspected, []); assert.deepEqual(earlier, []); assert.equal(ui.markup(), current);
    ui.button("Inspect saved").onClick(); ui.button("Use as earlier").onClick();
    assert.deepEqual(inspected, [entries[1]]); assert.deepEqual(earlier, [entries[1]]);
  } finally { ui.unmount(); }
});

test("retired history controls cannot fetch, select or write after cleanup and same-instance effect recreation", async t => {
  const entries = rows(), inspected = [], earlier = []; let calls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    calls++; return handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => inventory(entries));
  });
  const ui = harness({ onInspect: row => inspected.push(row), onUseEarlier: row => earlier.push(row) });
  ui.mount(); ui.submit(); await turn();
  const load = ui.button("Load filtered").onClick, inspect = ui.button("Inspect saved").onClick, pin = ui.button("Use as earlier").onClick;
  ui.unmount(); const beforeWrites = ui.writes;
  load(); inspect(); pin(); await turn();
  assert.equal(calls, 1); assert.equal(ui.writes, beforeWrites); assert.deepEqual(inspected, []); assert.deepEqual(earlier, []);
  try {
    ui.mount(); assert.doesNotMatch(ui.markup(), /Inspect saved run/);
    ui.submit(); await turn(); const current = ui.markup();
    load(); inspect(); pin(); await turn();
    assert.equal(calls, 2); assert.equal(ui.markup(), current); assert.deepEqual(inspected, []); assert.deepEqual(earlier, []);
    ui.button("Inspect saved").onClick(); assert.deepEqual(inspected, [entries[9]]);
  } finally { ui.unmount(); }
});

test("a pre-admission history load and submit cannot be revived by mounting", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    calls++; return handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => inventory([]));
  });
  const ui = harness(), load = ui.button("Load filtered").onClick;
  const submit = nodes(ui.render()).find(node => node.type === "form").props.onSubmit;
  assert.equal(ui.button("Load filtered").disabled, true);
  try {
    ui.mount(); load(); submit({ preventDefault() {} }); await turn(); assert.equal(calls, 0);
    ui.submit(); await turn(); assert.equal(calls, 1); assert.match(ui.markup(), /No readable run matches/);
  } finally { ui.unmount(); }
});

test("effect recreation cannot release a retired physical read or publish its late page", async t => {
  const entries = rows(), pending = []; let fire;
  t.mock.method(globalThis, "setTimeout", callback => { fire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  t.mock.method(globalThis, "fetch", async (url, options) => new Promise(resolve => { pending.push({ url, signal: options.signal, resolve }); }));
  const response = url => handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => inventory(entries));
  const ui = harness();
  try {
    ui.mount(); ui.submit(); assert.equal(pending.length, 1);
    ui.unmount(); assert.equal(pending[0].signal.aborted, true);
    ui.mount(); const writes = ui.writes; fire(); ui.submit(); await turn();
    assert.equal(pending.length, 1); assert.equal(ui.writes, writes); assert.equal(ui.button("Reading").disabled, true);
    pending[0].resolve(await response(pending[0].url)); await turn();
    assert.doesNotMatch(ui.markup(), /Inspect saved run|Page 1 of 2/); assert.deepEqual(ui.logs, []);
    assert.equal(ui.button("Load filtered").disabled, false);
    ui.submit(); assert.equal(pending.length, 2);
    pending[1].resolve(await response(pending[1].url)); await turn(); assert.match(ui.markup(), /Page 1 of 2/);
  } finally { ui.unmount(); }
});

for (const phase of ["byte-overflow", "declared-overflow", "malformed-utf8"]) test(`history withholds ${phase} wire data and its row controls`, async t => {
  const entries = rows();
  if (phase === "malformed-utf8") for (const row of entries) {
    row.report.items[0].source.title = "X";
    row.report.fictionalCandidate.publication.snapshot.claims[0].evidence[0].title = "X";
  }
  const source = await handleFictionalHistoryPageRequest(new Request("http://127.0.0.1:3000/api/dev/update-rehearsal/history/page", { headers: { "sec-fetch-site": "same-origin" } }), "development", async () => inventory(entries));
  let raw = new TextEncoder().encode(await source.text());
  if (phase === "byte-overflow") raw = new TextEncoder().encode(new TextDecoder().decode(raw) + " ".repeat(8 * 65536 + 1025));
  if (phase === "malformed-utf8") { const marker = Buffer.from('"title":"X"'); let at = -1, count = 0;
    while ((at = Buffer.from(raw).indexOf(marker, at + 1)) >= 0) { raw[at + 9] = 255; count++; } assert.equal(count, 16); }
  const response = new Response(raw, { headers: phase === "declared-overflow" ? { "content-length": String(8 * 65536 + 1025) } : {} });
  let calls = 0; t.mock.method(globalThis, "fetch", async () => { calls++; return response; });
  const inspected = [], ui = harness({ onInspect: row => inspected.push(row) });
  try {
    ui.mount(); ui.submit(); await turn(); assert.match(ui.markup(), /history could not be read/);
    assert.doesNotMatch(ui.markup(), /Inspect saved run|Page 1 of 2|PRIVATE_/); assert.deepEqual(inspected, []);
    assert.equal(calls, 1); assert.equal(response.body.locked, false); assert.deepEqual(ui.logs, ["update_history"]);
  } finally { ui.unmount(); }
});
test("an oversized archive-change refusal stays unavailable instead of asserting a checked change", async t => {
  const response = new Response('{"error":"fictional_history_changed"}' + " ".repeat(1025), { status: 409 });
  t.mock.method(globalThis, "fetch", async () => response); const ui = harness();
  try { ui.mount(); ui.submit(); await turn(); assert.match(ui.markup(), /history could not be read/);
    assert.doesNotMatch(ui.markup(), /archive changed between pages/); assert.deepEqual(ui.logs, ["update_history"]); assert.equal(response.body.locked, false);
  } finally { ui.unmount(); }
});
