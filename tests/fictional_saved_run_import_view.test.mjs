import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { exportFictionalSavedRun } from "../src/fictional-saved-run-export.ts";
import { SAVED_RUN_FILE_BYTE_LIMIT } from "../src/fictional-saved-run-import.ts";

const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === "object" ? [x, ...nodes(x.props?.children)] : [];
const text = x => Array.isArray(x) ? x.map(text).join("") : x && typeof x === "object" ? text(x.props?.children) : String(x ?? "");
const tick = () => new Promise(resolve => setImmediate(resolve));
function result(later = false) {
  return { execution: { id: later ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "local_fictional", scenario: later ? "revised_value" : "standard", executedAt: later ? "2026-10-10T10:01:00Z" : "2026-10-10T10:00:00Z", durationMs: 1 },
    report: JSON.parse(readFileSync(new URL(`../fixtures/${later ? "fictional_revised_update_report" : "fictional_update_report"}.json`, import.meta.url))) };
}
const file = later => new File([exportFictionalSavedRun(result(later))], "PRIVATE_FILE_NAME.json", { type: "application/json" });
function harness() {
  let cursor = 0, effect, cleanup, layout, layoutCleanup; const cells = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
      return [cells[i], value => { cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useId() { return "local-files"; }, useEffect(fn) { effect = fn; }, useLayoutEffect(fn) { layout = fn; },
  };
  const saved = loadTsx(new URL("../src/fictional-saved-run-view.tsx", import.meta.url));
  const comparison = loadTsx(new URL("../app/editorial-preview/saved-run-comparison.tsx", import.meta.url));
  const component = loadTsx(new URL("../src/fictional-saved-run-import-view.tsx", import.meta.url), name =>
    name === "react" ? hooks : name === "./fictional-saved-run-view.tsx" ? saved : name === "../app/editorial-preview/saved-run-comparison.tsx" ? comparison : undefined);
  const render = () => { cursor = 0; return component.FictionalSavedRunImportView(); };
  const props = (type, fragment) => nodes(render()).find(x => x.type === type && String(x.props.id ?? "").includes(fragment))?.props;
  return { render, markup: () => renderToStaticMarkup(render()),
    mount() { render(); layoutCleanup = layout?.(); cleanup = effect(); render(); }, unmount() { layoutCleanup?.(); cleanup?.(); }, remount() { layoutCleanup?.(); cleanup?.(); layoutCleanup = layout?.(); cleanup = effect(); render(); },
    input: side => props("input", `-${side}-file`),
    clear(side) { nodes(render()).find(x => x.type === "button" && text(x.props.children).includes(side === "selected" ? "Clear selected" : "Clear earlier")).props.onClick(); },
    choose(side, selected) { const input = { files: selected ? [selected] : [], value: "PRIVATE_FILE_NAME" };
      this.input(side).onChange({ currentTarget: input }); assert.equal(input.value, ""); },
    resultGuard(side = "selected") { return nodes(render()).find(x => x.type === saved.FictionalSavedRunView && String(x.key).startsWith(side)).props.isCurrent; },
    comparisonGuard() { return nodes(render()).find(x => x.type === comparison.SavedRunComparison)?.props.isCurrent; },
  };
}
function delayed(later = true) {
  const body = new TextEncoder().encode(exportFictionalSavedRun(result(later))).buffer;
  let resolve, reject, reads = 0;
  return { body, get reads() { return reads; }, resolve() { resolve(body); }, reject() { reject(new Error("PRIVATE_READ_ERROR")); },
    file: { size: body.byteLength, slice(start, end) { assert.equal(start, 0); assert.equal(end, SAVED_RUN_FILE_BYTE_LIMIT + 1);
      reads++; return { arrayBuffer: () => new Promise((yes, no) => { resolve = yes; reject = no; }) }; } } };
}
test("exported native Files reopen into actual saved draft and ordered comparison presenters without a request", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Local file inspection dispatched network work"));
  const ui = harness(); ui.mount();
  try {
    ui.choose("selected", file(true)); ui.choose("earlier", file(false)); await tick();
    const html = ui.markup();
    for (const value of ["28.1", "27.4", "+0.7 percentage points", "2 held", "Zero published", "unauthenticated historical material", "Current publication unavailable"]) assert.ok(html.includes(value), value);
    assert.doesNotMatch(html, /PRIVATE_FILE_NAME/); assert.equal(ui.resultGuard()(), true); assert.equal(ui.comparisonGuard()(), true);
  } finally { ui.unmount(); }
});
test("oversize, malformed and private-field files immediately withhold previous contents and actions", async () => {
  const ui = harness(); ui.mount();
  try {
    ui.choose("selected", file(true)); await tick(); const guard = ui.resultGuard(); let slices = 0;
    ui.choose("selected", { size: SAVED_RUN_FILE_BYTE_LIMIT + 1, slice() { slices++; throw new Error("PRIVATE_SIZE"); } });
    assert.equal(guard(), false); await tick(); assert.equal(slices, 0); assert.doesNotMatch(ui.markup(), /28\.1/);
    for (const body of ["bad JSON", JSON.stringify({ ...result(true), privatePath: "PRIVATE_PATH" })]) {
      ui.choose("selected", new File([body], "PRIVATE_FILE_NAME")); await tick();
      assert.match(ui.markup(), /could not be read/); assert.doesNotMatch(ui.markup(), /PRIVATE_PATH|PRIVATE_FILE_NAME|28\.1/);
    }
  } finally { ui.unmount(); }
});
test("clear retires result and comparison permissions before React rerenders", async () => {
  const ui = harness(); ui.mount();
  try {
    ui.choose("selected", file(true)); ui.choose("earlier", file(false)); await tick();
    const selected = ui.resultGuard(), earlier = ui.resultGuard("earlier"), pair = ui.comparisonGuard();
    ui.clear("selected"); assert.equal(selected(), false); assert.equal(pair(), false); assert.equal(earlier(), true);
    assert.doesNotMatch(ui.markup(), /28\.1|percentage points/); assert.match(ui.markup(), /27\.4/);
  } finally { ui.unmount(); }
});
test("replacement keeps the old physical read slot until settlement and starts no implicit retry", async () => {
  const ui = harness(), first = delayed(), second = delayed(false); ui.mount();
  try {
    ui.choose("selected", first.file); ui.choose("selected", second.file);
    assert.equal(first.reads, 1); assert.equal(second.reads, 0); assert.match(ui.markup(), /still finishing/);
    first.resolve(); await tick(); assert.equal(second.reads, 0); assert.match(ui.markup(), /Choose the file again/); assert.doesNotMatch(ui.markup(), /28\.1/);
    ui.choose("selected", second.file); second.resolve(); await tick(); assert.equal(second.reads, 1); assert.match(ui.markup(), /27\.4/);
  } finally { ui.unmount(); }
});
test("a cleared pending read cannot republish and cannot release its physical slot early", async () => {
  const ui = harness(), first = delayed(), next = delayed(false); ui.mount();
  try {
    ui.choose("selected", first.file); ui.clear("selected"); assert.match(ui.markup(), /previous read still owns its slot/);
    ui.choose("selected", next.file); assert.equal(next.reads, 0); first.resolve(); await tick();
    assert.doesNotMatch(ui.markup(), /28\.1|27\.4/); ui.choose("selected", file(false)); await tick(); assert.match(ui.markup(), /27\.4/);
  } finally { ui.unmount(); }
});
test("unmount and recreated effects deny retained chooser and result callbacks", async () => {
  const ui = harness(); ui.mount();
  ui.choose("selected", file(true)); await tick(); const guard = ui.resultGuard(), handler = ui.input("selected").onChange;
  ui.remount(); assert.equal(guard(), false); const next = delayed(false);
  handler({ currentTarget: { files: [next.file], value: "" } }); assert.equal(next.reads, 0); assert.doesNotMatch(ui.markup(), /28\.1/);
  ui.choose("selected", file(false)); await tick(); const current = ui.resultGuard(); ui.unmount(); assert.equal(current(), false);
  assert.doesNotMatch(ui.markup(), /27\.4/);
});
test("remount during an old read preserves ownership and discards that read on settlement", async () => {
  const ui = harness(), first = delayed(), next = delayed(false); ui.mount();
  try {
    ui.choose("selected", first.file); ui.remount(); ui.choose("selected", next.file); assert.equal(next.reads, 0);
    first.resolve(); await tick(); assert.doesNotMatch(ui.markup(), /28\.1/); assert.equal(next.reads, 0);
    ui.choose("selected", file(false)); await tick(); assert.match(ui.markup(), /27\.4/);
  } finally { ui.unmount(); }
});
test("deadline notice holds the result while physical read continues and late bytes remain refused", async t => {
  const timers = []; t.mock.method(globalThis, "setTimeout", (fn, ms) => { assert.equal(ms, 8_000); timers.push(fn); return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const ui = harness(), first = delayed(); ui.mount();
  try {
    ui.choose("selected", first.file); timers[0](); assert.match(ui.markup(), /could not be read/);
    assert.equal(ui.input("selected").disabled, true); first.resolve(); await tick();
    assert.doesNotMatch(ui.markup(), /28\.1/); assert.equal(ui.input("selected").disabled, false);
  } finally { ui.unmount(); }
});
test("size disagreement and arbitrary file read faults remain generic and suppress filenames", async () => {
  const ui = harness(); ui.mount();
  try {
    const first = delayed(); ui.choose("selected", { ...first.file, size: first.file.size - 1 }); first.resolve(); await tick();
    assert.match(ui.markup(), /could not be read/); const second = delayed(); ui.choose("selected", second.file); second.reject(); await tick();
    assert.match(ui.markup(), /could not be read/); assert.doesNotMatch(ui.markup(), /PRIVATE_READ_ERROR|PRIVATE_FILE_NAME|28\.1/);
  } finally { ui.unmount(); }
});
test("reversed and same execution choices expose only the existing held comparison", async () => {
  const ui = harness(); ui.mount();
  try {
    ui.choose("selected", file(false)); ui.choose("earlier", file(true)); await tick();
    assert.match(ui.markup(), /Saved-run comparison held/); assert.doesNotMatch(ui.markup(), /percentage points/);
    ui.choose("earlier", file(false)); await tick(); assert.match(ui.markup(), /Saved-run comparison held/);
  } finally { ui.unmount(); }
});
test("the existing editorial route mounts the local reader only behind its development gate", () => {
  const page = new URL("../app/editorial-preview/page.tsx", import.meta.url);
  const example = loadTsx(new URL("../app/update-preview/example.ts", import.meta.url), name =>
    name === "../../fixtures/fictional_update_report.json" ? { default: result().report } : undefined);
  const intercept = name => name === "../update-preview/example" ? example : undefined;
  const original = loadTsx(page, intercept, { env: { NODE_ENV: "development" } });
  assert.equal(nodes(original.default()).filter(x => x.type?.name === "FictionalSavedRunImportView").length, 1);
  const held = loadTsx(page, intercept, { env: { NODE_ENV: "production" } });
  assert.throws(() => held.default(), /NEXT_HTTP_ERROR_FALLBACK;404/);
});
