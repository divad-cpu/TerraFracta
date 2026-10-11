import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { makeDiagnosticEvent } from "../src/error-diagnostics.ts";
import { buildDiagnosticReport, selectDiagnosticEvents } from "../src/diagnostic-report.ts";
import { readDiagnosticExport, DIAGNOSTIC_IMPORT_BYTES } from "../src/diagnostic-import.ts";

const bytes = value => new TextEncoder().encode(JSON.stringify(value)).buffer;
const event = (n, code = "server_route") => makeDiagnosticEvent(code, `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
  new Date(Date.UTC(2026, 9, 4, 12, 0, n)));
const report = (events = [event(1), event(2, "browser_runtime")]) => buildDiagnosticReport({ events,
  unreadable: 0, filesObserved: events.length, stable: true, locked: false }, new Date("2026-10-04T13:00:00.000Z"));
const selected = { code: "", origin: "", reference: "", page: 1 };
const settle = () => new Promise(resolve => setImmediate(resolve));

function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
function harness() {
  let cursor = 0, effect, cleanup; const cells = [], modules = new Map();
  const hooks = {
    useState(initial) { const index = cursor++; cells[index] ??= initial; return [cells[index], value => { cells[index] = value; }]; },
    useRef(initial) { const index = cursor++; cells[index] ??= { current: initial }; return cells[index]; },
    useId() { return "saved-errors"; }, useEffect(callback) { effect = callback; },
  };
  function load(path) {
    if (modules.has(path.href)) return modules.get(path.href);
    const native = createRequire(path), exports = {}; modules.set(path.href, exports);
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    new Function("require", "exports", compiled)(name => name === "react" ? hooks
      : name.endsWith(".tsx") ? load(new URL(name, path)) : native(name), exports);
    return exports;
  }
  const component = load(new URL("../src/diagnostic-import-view.tsx", import.meta.url)).DiagnosticImportView;
  const render = () => { cursor = 0; return component(); };
  return { markup: () => renderToStaticMarkup(render()), mount() { render(); cleanup = effect(); }, unmount() { cleanup?.(); },
    input(type = "file") { return nodes(render()).find(item => item.type === "input" && (item.props.type ?? "text") === type).props; },
    button(text) { return nodes(render()).find(item => item.type === "button" && nodesText(item.props.children) === text).props; },
    controls(type) { return nodes(render()).filter(item => item.type === type).map(item => item.props); } };
}
function nodesText(value) { return Array.isArray(value) ? value.map(nodesText).join("") : typeof value === "string" ? value : ""; }
function choose(ui, file) {
  const input = { files: file ? [file] : [], value: "PRIVATE_FILENAME_CANARY" };
  ui.input().onChange({ currentTarget: input }); assert.equal(input.value, "");
}
const file = value => new File([JSON.stringify(value)], "PRIVATE_FILENAME_CANARY.json", { type: "application/json" });

test("saved diagnostic decoder retains only closed records and admits a full bounded archive", () => {
  assert.deepEqual(readDiagnosticExport(bytes(report())), report());
  const full = report(Array.from({ length: 1001 }, (_, n) => event(n)));
  assert.ok(bytes(full).byteLength < DIAGNOSTIC_IMPORT_BYTES);
  const parsed = readDiagnosticExport(bytes(full)); assert.equal(parsed.events.length, 1001); assert.equal(parsed.capacityReached, true);
  assert.equal(selectDiagnosticEvents(parsed, selected).events.length, 25);
});
test("saved diagnostic decoder refuses malformed, non UTF-8, oversized and private extra data", () => {
  for (const raw of [new ArrayBuffer(0), new ArrayBuffer(1), new ArrayBuffer(DIAGNOSTIC_IMPORT_BYTES + 1),
    new Uint8Array([0xc3, 0x28]).buffer, bytes({}), bytes([]), bytes({ ...report(), privateText: "PRIVATE_CANARY" }),
    bytes({ ...report(), events: [{ ...event(1), stack: "PRIVATE_CANARY" }] }), bytes({ ...report(), captureCompleteness: "complete" })])
    assert.throws(() => readDiagnosticExport(raw));
});
test("saved diagnostic ordering and group dates are derived from timestamps even when input records are shuffled", () => {
  const shuffled = report([event(1), event(2), event(3)]); shuffled.events = [event(3), event(1), event(2)];
  const selection = selectDiagnosticEvents(readDiagnosticExport(bytes(shuffled)), selected);
  assert.deepEqual(selection.events.map(item => item.eventId), [event(3), event(2), event(1)].map(item => item.eventId));
  assert.equal(selection.groups[0].firstAt, event(1).occurredAt); assert.equal(selection.groups[0].lastAt, event(3).occurredAt);
});
test("actual saved-file callback shows historical references with no upload, filename, link or archive write", async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = () => { calls++; throw new Error("Upload forbidden"); };
  const ui = harness();
  try {
    ui.mount(); choose(ui, file(report())); await settle();
    const markup = ui.markup(); assert.match(markup, /2 validated records/); assert.match(markup, /dated claims, not an authenticated archive/);
    assert.match(markup, new RegExp(event(1).eventId)); assert.doesNotMatch(markup, /PRIVATE_FILENAME_CANARY|\/api\/|<a /);
    assert.equal(calls, 0); ui.button("Clear saved error export").onClick(); assert.match(ui.markup(), /No saved error export/);
    assert.doesNotMatch(ui.markup(), new RegExp(event(1).eventId));
  } finally { ui.unmount(); globalThis.fetch = original; }
});
test("saved-file selection exposes each new closed export action and keeps historical generic events unattributed", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Saved diagnostic import uploaded or read an archive"));
  const ui = harness(), actions = ["saved_run_export", "weekly_assessment_export"],
    events = [event(1, actions[0]), event(2, actions[1]), event(3, "browser_runtime")];
  try {
    ui.mount(); choose(ui, file(report(events))); await settle();
    for (const [index, code] of actions.entries()) {
      ui.controls("select")[0].onChange({ target: { value: code } });
      const html = ui.markup(); assert.match(html, /1 matching records across 1 functions/);
      assert.ok(html.includes(events[index].eventId)); assert.ok(!html.includes(events[2].eventId));
      assert.doesNotMatch(html, /PRIVATE_FILENAME_CANARY|\/api\/|<a /);
    }
    const historical = JSON.parse(readFileSync(new URL("../fixtures/diagnostics/report-v2.sample.json", import.meta.url), "utf8"));
    choose(ui, file(historical)); await settle();
    assert.match(ui.markup(), /7 validated records/);
    for (const code of actions) {
      ui.controls("select")[0].onChange({ target: { value: code } });
      assert.match(ui.markup(), /0 matching records across 0 functions/);
      assert.match(ui.markup(), /No matching recorded event/);
    }
    ui.controls("select")[0].onChange({ target: { value: "browser_runtime" } });
    assert.match(ui.markup(), /1 matching records across 1 functions/);
    assert.ok(ui.markup().includes(historical.events.find(value => value.code === "browser_runtime").eventId));
  } finally { ui.unmount(); }
});
test("saved-file metadata bounds precede I/O and a refused replacement removes prior contents", async () => {
  const ui = harness(); let slices = 0;
  try {
    ui.mount(); choose(ui, file(report())); await settle(); assert.match(ui.markup(), /2 validated records/);
    for (const size of [NaN, -1, 1, DIAGNOSTIC_IMPORT_BYTES + 1]) {
      choose(ui, { size, slice() { slices++; throw new Error("Must not read"); } }); await settle();
      assert.match(ui.markup(), /Previous contents are withheld/); assert.doesNotMatch(ui.markup(), /2 validated records/);
    }
    assert.equal(slices, 0);
    const buffer = bytes(report()); choose(ui, { size: buffer.byteLength - 1, slice(start, end) {
      assert.equal(start, 0); assert.equal(end, DIAGNOSTIC_IMPORT_BYTES + 1); return { arrayBuffer: async () => buffer };
    } }); await settle(); assert.match(ui.markup(), /could not be read/);
    choose(ui, { size: 2, slice() { return { arrayBuffer: async () => { throw new Error("PRIVATE_FAULT_CANARY"); } }; } }); await settle();
    assert.doesNotMatch(ui.markup(), /PRIVATE_FAULT_CANARY/);
  } finally { ui.unmount(); }
});
test("saved-file ownership prevents parallel reads and a late reply cannot restore cleared, superseded or unmounted content", async () => {
  const ui = harness(); let resolve, slices = 0;
  const buffer = bytes(report()), delayed = { size: buffer.byteLength, slice() {
    slices++; return { arrayBuffer: () => new Promise(done => { resolve = done; }) };
  } };
  try {
    ui.mount(); choose(ui, delayed); choose(ui, delayed); assert.equal(slices, 1); assert.match(ui.markup(), /previous file read is still finishing/);
    resolve(buffer); await settle(); assert.doesNotMatch(ui.markup(), /2 validated records/);
    assert.equal(ui.input().disabled, false);
    assert.doesNotMatch(ui.markup(), /read is still finishing|read still owns its slot/);
    assert.match(ui.markup(), /previous read has finished.*choose the file again/i);
    choose(ui, delayed); ui.button("Clear saved error export").onClick(); choose(ui, delayed); assert.equal(slices, 2);
    resolve(buffer); await settle(); assert.doesNotMatch(ui.markup(), /2 validated records/);
    choose(ui, delayed); const handler = ui.input().onChange; ui.unmount(); resolve(buffer); await settle();
    assert.doesNotMatch(ui.markup(), /2 validated records/); handler({ currentTarget: { files: [delayed], value: "" } }); assert.equal(slices, 3);
  } finally { ui.unmount(); }
});
test("saved reference, origin, function and page filters stay local and cannot expose an invalid reference", async () => {
  const ui = harness(), value = report(Array.from({ length: 30 }, (_, n) => event(n, n % 2 ? "server_route" : "browser_runtime")));
  try {
    ui.mount(); choose(ui, file(value)); await settle(); assert.match(ui.markup(), /Page 1 of 2/);
    ui.button("Next saved records").onClick(); assert.match(ui.markup(), /Page 2 of 2/);
    ui.controls("select")[1].onChange({ target: { value: "browser" } }); assert.match(ui.markup(), /15 matching records/); assert.match(ui.markup(), /Page 1 of 1/);
    ui.input("text").onChange({ target: { value: event(2).eventId } }); let prevented = 0;
    ui.controls("form")[0].onSubmit({ preventDefault() { prevented++; } }); assert.equal(prevented, 1); assert.match(ui.markup(), /1 matching records/);
    ui.input("text").onChange({ target: { value: "PRIVATE_INVALID_CANARY" } }); ui.controls("form")[0].onSubmit({ preventDefault() {} });
    assert.match(ui.markup(), /previous filter is preserved/); assert.match(ui.markup(), /1 matching records/);
    ui.button("Reset saved filters").onClick(); assert.match(ui.markup(), /30 matching records/); assert.doesNotMatch(ui.markup(), /PRIVATE_INVALID_CANARY/);
  } finally { ui.unmount(); }
});
test("a rejected superseded file read releases ownership and explicitly permits a fresh selection", async () => {
  const ui = harness(); let reject, firstReads = 0, refusedReads = 0;
  const original = { size: 2, slice() { firstReads++; return { arrayBuffer: () => new Promise((_, fail) => { reject = fail; }) }; } };
  const refused = { size: 2, slice() { refusedReads++; throw new Error('Must remain unread'); } };
  try {
    ui.mount(); choose(ui, original); choose(ui, refused);
    assert.equal(ui.input().disabled, true); assert.equal(firstReads, 1); assert.equal(refusedReads, 0);
    reject(new Error('PRIVATE_ERROR_CANARY')); await settle();
    assert.equal(ui.input().disabled, false); assert.match(ui.markup(), /previous read has finished.*choose the file again/i);
    assert.doesNotMatch(ui.markup(), /still finishing|still owns|PRIVATE_ERROR_CANARY|validated records/);
    choose(ui, file(report())); await settle(); assert.match(ui.markup(), /2 validated records/);
    assert.doesNotMatch(ui.markup(), /previous read has finished/); assert.equal(refusedReads, 0);
  } finally { ui.unmount(); }
});

test("failed diagnostic import deadline setup withholds contents and releases its unused file slot", async t => {
  const ui = harness(); let slices = 0;
  const unhandled = [], notice = error => unhandled.push(error);
  process.on("unhandledRejection", notice);
  try {
    ui.mount(); choose(ui, file(report())); await settle(); assert.match(ui.markup(), /2 validated records/);
    t.mock.method(globalThis, "setTimeout", () => { throw new Error("PRIVATE_TIMER_SETUP"); });
    choose(ui, { size: 2, slice() { slices++; throw new Error("Must not read a file before the deadline exists"); } }); await settle();
    assert.equal(slices, 0); assert.equal(ui.input().disabled, false); assert.equal(unhandled.length, 0);
    assert.match(ui.markup(), /could not be read/); assert.doesNotMatch(ui.markup(), /validated records|PRIVATE_TIMER_SETUP|still owns/);
    t.mock.restoreAll(); choose(ui, file(report())); await settle(); assert.match(ui.markup(), /2 validated records/);
  } finally { t.mock.restoreAll(); ui.unmount(); process.removeListener("unhandledRejection", notice); }
});

test("the import deadline withholds a pending file without releasing physical read ownership", async t => {
  const ui = harness(), timers = []; let resolve, slices = 0;
  const buffer = bytes(report()), delayed = { size: buffer.byteLength, slice() {
    slices++; return { arrayBuffer: () => new Promise(done => { resolve = done; }) };
  } };
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => { assert.equal(milliseconds, 8000); timers.push(callback); return timers.length; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  try {
    ui.mount(); choose(ui, delayed); await settle(); assert.equal(slices, 1);
    timers[0](); await settle(); assert.equal(ui.input().disabled, true);
    assert.match(ui.markup(), /could not be read.*Previous contents are withheld/);
    assert.match(ui.markup(), /still owns its slot/); assert.doesNotMatch(ui.markup(), /validated records/);
    ui.button("Clear saved error export").onClick(); choose(ui, delayed); assert.equal(slices, 1);
    resolve(buffer); await settle(); assert.equal(ui.input().disabled, false);
    assert.match(ui.markup(), /previous read has finished/); assert.doesNotMatch(ui.markup(), /validated records/);
    t.mock.restoreAll(); choose(ui, file(report())); await settle(); assert.match(ui.markup(), /2 validated records/);
  } finally { resolve?.(buffer); await settle(); t.mock.restoreAll(); ui.unmount(); }
});

test("retired import visit cannot revive its file/clear handlers or historical contents after effect recreation", async () => {
  const ui = harness(); let slices = 0;
  try {
    ui.mount(); choose(ui, file(report())); await settle();
    const oldFile = ui.input().onChange, oldClear = ui.button("Clear saved error export").onClick;
    ui.unmount(); assert.doesNotMatch(ui.markup(), /validated records/);
    ui.mount(); assert.doesNotMatch(ui.markup(), /validated records/);
    oldFile({ currentTarget: { files: [{ size: 2, slice() { slices++; throw Error("Retired read"); } }], value: "" } });
    assert.equal(slices, 0);
    choose(ui, file(report([event(40)]))); await settle();
    const current = ui.markup(); oldClear(); assert.equal(ui.markup(), current);
  } finally { ui.unmount(); }
});

test("saved report actions are denied synchronously once a replacement starts and after its settlement", async () => {
  const ui = harness(), first = report(Array.from({ length: 30 }, (_, n) => event(n, n % 2 ? "server_route" : "browser_runtime")));
  const second = report(Array.from({ length: 30 }, (_, n) => event(n + 60, n % 2 ? "server_route" : "browser_runtime")));
  let finish;
  try {
    ui.mount(); choose(ui, file(first)); await settle();
    const retained = [
      () => uiFirst.code.onChange({ target: { value: "browser_runtime" } }),
      () => uiFirst.origin.onChange({ target: { value: "worker" } }),
      () => { uiFirst.reference.onChange({ target: { value: event(2).eventId } }); uiFirst.form.onSubmit({ preventDefault() {} }); },
      () => uiFirst.group.onClick(), () => uiFirst.page.onClick(),
    ];
    const uiFirst = { code: ui.controls("select")[0], origin: ui.controls("select")[1], reference: ui.input("text"), form: ui.controls("form")[0],
      group: ui.button("Show saved records for this function"), page: ui.button("Next saved records") };
    const buffer = bytes(second);
    choose(ui, { size: buffer.byteLength, slice() { return { arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }; } });
    const pending = ui.markup(); for (const action of retained) action(); assert.equal(ui.markup(), pending);
    finish(buffer); await settle();
    const current = ui.markup(); assert.match(current, /30 matching records/); assert.match(current, /Page 1 of 2/);
    for (const action of retained) { action(); assert.equal(ui.markup(), current); }
    ui.controls("select")[1].onChange({ target: { value: "browser" } }); assert.match(ui.markup(), /15 matching records/);
  } finally { finish?.(bytes(second)); await settle(); ui.unmount(); }
});

test("retired import may transfer only slot availability to a successor after actual file settlement", async () => {
  const ui = harness(); let finish, slices = 0;
  const buffer = bytes(report()); const delayed = { size: buffer.byteLength, slice() { slices++; return { arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }; } };
  try {
    ui.mount(); choose(ui, delayed); const oldFile = ui.input().onChange;
    ui.unmount(); ui.mount(); assert.equal(ui.input().disabled, true);
    choose(ui, delayed); oldFile({ currentTarget: { files: [delayed], value: "" } }); assert.equal(slices, 1);
    finish(buffer); await settle(); assert.equal(ui.input().disabled, false); assert.doesNotMatch(ui.markup(), /validated records/);
    oldFile({ currentTarget: { files: [delayed], value: "" } }); assert.equal(slices, 1);
    choose(ui, file(report([event(40)]))); await settle(); assert.match(ui.markup(), /1 validated records/);
  } finally { finish?.(buffer); await settle(); ui.unmount(); }
});
