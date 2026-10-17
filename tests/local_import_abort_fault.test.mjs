import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { exportFictionalSavedRun } from "../src/fictional-saved-run-export.ts";
import { buildDiagnosticReport } from "../src/diagnostic-report.ts";
import { makeDiagnosticEvent } from "../src/error-diagnostics.ts";
import { DIAGNOSTIC_IMPORT_BYTES } from "../src/diagnostic-import.ts";
import { SAVED_RUN_FILE_BYTE_LIMIT } from "../src/fictional-saved-run-import.ts";

const variants = [
  { file: "diagnostic-import-view", component: "DiagnosticImportView", suffix: "-file", clear: "Clear saved error export", loaded: /1 validated records/, limit: DIAGNOSTIC_IMPORT_BYTES },
  { file: "fictional-saved-run-import-view", component: "FictionalSavedRunImportView", suffix: "-selected-file", clear: "Clear selected file", loaded: /Inspect the selected historical file/, limit: SAVED_RUN_FILE_BYTE_LIMIT },
  { file: "fictional-saved-run-import-view", component: "FictionalSavedRunImportView", suffix: "-earlier-file", clear: "Clear earlier file", loaded: /Inspect the earlier historical file/, limit: SAVED_RUN_FILE_BYTE_LIMIT },
];
function body(v) {
  if (v.file.startsWith("diagnostic")) return JSON.stringify(buildDiagnosticReport({
    events: [makeDiagnosticEvent("weekly_assessment_export", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", new Date("2026-10-03T12:00:00Z"))],
    unreadable: 0, filesObserved: 1, stable: true, locked: false,
  }, new Date("2026-10-03T13:00:00Z")));
  return exportFictionalSavedRun({ execution: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "local_fictional", scenario: "standard", executedAt: "2026-10-10T10:00:00Z", durationMs: 1 },
    report: JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url))) });
}
function harness(v) {
  let cursor = 0; const cells = [], effects = [], layouts = [];
  const register = (list, fn, deps) => { const i = cursor++, old = list[i];
    if (!old || deps.some((d, j) => d !== old.deps[j])) list[i] = { deps, fn, cleanup: old?.cleanup, pending: true };
  };
  const hooks = { useId: () => "import-abort", useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
      return [cells[i], next => { cells[i] = typeof next === "function" ? next(cells[i]) : next; }]; },
    useLayoutEffect(fn, deps) { register(layouts, fn, deps); }, useEffect(fn, deps) { register(effects, fn, deps); } };
  const View = loadTsx(new URL(`../src/${v.file}.tsx`, import.meta.url), name => name === "react" ? hooks : undefined)[v.component];
  const render = () => { cursor = 0; return View(); }, run = list => { for (const e of list) if (e?.pending) { e.cleanup?.(); e.cleanup = e.fn(); e.pending = false; } };
  return { markup: () => renderToStaticMarkup(render()), input: () => elements(render()).find(n => n.props.id?.endsWith(v.suffix)).props,
    clear: () => elements(render()).find(n => n.type === "button" && [n.props.children].flat(Infinity).join("") === v.clear).props.onClick,
    mount() { render(); run(layouts); run(effects); }, layout() { for (const e of layouts) e?.cleanup?.(); },
    passive() { for (const e of effects) e?.cleanup?.(); },
    admitAgain() { for (const list of [layouts, effects]) { for (const e of list) if (e) { e.cleanup = undefined; e.pending = true; } run(list); } },
    unmount() { for (const e of layouts) e?.cleanup?.(); for (const e of effects) e?.cleanup?.(); } };
}
const turn = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
function choose(h, file, callback = h.input().onChange) {
  const input = { files: [file], value: "PRIVATE_LOCAL_NAME" }; callback({ currentTarget: input }); assert.equal(input.value, "");
}
function fixture(t, v, fault = true) {
  const NativeController = globalThis.AbortController, text = body(v), buffer = new TextEncoder().encode(text).buffer;
  const h = harness(v), file = new File([text], "PRIVATE_NAME.json"); let outer, aborts = 0, reads = 0, resolve;
  const physical = new Promise(ok => { resolve = ok; });
  t.mock.method(globalThis, "fetch", () => assert.fail("Local import used a transport"));
  t.mock.method(globalThis, "AbortController", function () {
    const controller = new NativeController();
    if (!outer) { outer = controller; if (fault) t.mock.method(controller, "abort", () => { aborts++; throw Error("PRIVATE_ABORT_FAILURE"); }); }
    return controller;
  });
  t.mock.method(file, "slice", (start, end) => { assert.equal(start, 0); assert.equal(end, v.limit + 1); reads++;
    const blob = new Blob([buffer]); t.mock.method(blob, "arrayBuffer", () => physical); return blob;
  });
  t.after(async () => { resolve(buffer); await turn(); h.unmount(); }); h.mount();
  return { h, file, resolve: () => resolve(buffer), fresh: () => new File([text], "PRIVATE_FRESH.json"), outer: () => outer, aborts: () => aborts, reads: () => reads };
}

for (const v of variants) {
  test(`${v.suffix} clear completes despite abort failure and cannot release or restore its pending file`, async t => {
    const f = fixture(t, v), { h } = f; choose(h, f.file); const oldFile = h.input().onChange, oldClear = h.clear();
    assert.doesNotThrow(oldClear); assert.equal(f.aborts(), 1); assert.equal(f.outer().signal.aborted, false);
    assert.match(h.markup(), /No (saved error export is selected|selected file is open|earlier file is open)/); assert.equal(h.input().disabled, true);
    oldFile({ currentTarget: { files: [f.fresh()], value: "" } }); assert.equal(f.reads(), 1);
    f.resolve(); await turn(); assert.equal(h.input().disabled, false); assert.doesNotMatch(h.markup(), v.loaded);
    choose(h, f.fresh()); await turn(); oldClear(); assert.match(h.markup(), v.loaded); assert.doesNotMatch(h.markup(), /PRIVATE_/);
  });
  test(`${v.suffix} deadline notice survives outer abort failure while the actual read keeps its slot`, async t => {
    const f = fixture(t, v), { h } = f, timers = [];
    t.mock.method(globalThis, "setTimeout", (callback, delay) => { assert.equal(delay, 8_000); timers.push(callback); return timers.length; });
    t.mock.method(globalThis, "clearTimeout", () => {});
    choose(h, f.file); assert.equal(timers.length, 1); timers[0](); assert.equal(f.aborts(), 1);
    assert.equal(f.outer().signal.aborted, false); assert.match(h.markup(), /could not be read/); assert.equal(h.input().disabled, true);
    assert.equal(f.reads(), 1); assert.doesNotMatch(h.markup(), /PRIVATE_/);
    f.resolve(); await turn(); assert.equal(h.input().disabled, false); assert.doesNotMatch(h.markup(), v.loaded);
    choose(h, f.fresh()); await turn(); timers[0](); assert.match(h.markup(), v.loaded);
  });
  test(`${v.suffix} layout retirement survives abort failure and recreated admission awaits its physical read`, async t => {
    const f = fixture(t, v), { h } = f; choose(h, f.file); const oldFile = h.input().onChange;
    assert.doesNotThrow(() => h.layout()); assert.equal(f.aborts(), 1); assert.doesNotThrow(() => h.passive());
    h.admitAgain(); assert.equal(h.input().disabled, true); assert.doesNotMatch(h.markup(), v.loaded);
    oldFile({ currentTarget: { files: [f.fresh()], value: "" } }); assert.equal(f.reads(), 1);
    f.resolve(); await turn(); assert.equal(h.input().disabled, false); assert.doesNotMatch(h.markup(), v.loaded);
    choose(h, f.fresh()); await turn(); assert.match(h.markup(), v.loaded); assert.doesNotMatch(h.markup(), /PRIVATE_/);
  });
  test(`${v.suffix} native cancellation retains ordinary signal semantics and explicit reselection`, async t => {
    const f = fixture(t, v, false), { h } = f; choose(h, f.file); h.clear()(); assert.equal(f.outer().signal.aborted, true);
    assert.equal(h.input().disabled, true); f.resolve(); await turn(); assert.equal(h.input().disabled, false); assert.doesNotMatch(h.markup(), v.loaded);
    choose(h, f.fresh()); await turn(); assert.match(h.markup(), v.loaded); assert.doesNotMatch(h.markup(), /PRIVATE_/);
  });
}
