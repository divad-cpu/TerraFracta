import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createClientErrorReporter, observeClientError } from "../src/client-error-diagnostics.ts";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";
import { createDevelopmentErrorRecorder } from "../src/server/error-diagnostics.ts";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { readDiagnosticExport } from "../src/diagnostic-import.ts";
import { diagnosticSelection, selectDiagnosticEvents } from "../src/diagnostic-report.ts";
import { exportErrorLog } from "../scripts/export_error_log.mjs";

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
const baseline = fixture("fictional_update_report");
const revised = fixture("fictional_revised_update_report");
function receipt(later = false) {
  return { execution: { id: later ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "local_fictional", scenario: later ? "revised_value" : "standard",
    executedAt: later ? "2026-10-05T10:01:00Z" : "2026-10-05T10:00:00Z", durationMs: 1 },
    report: structuredClone(later ? revised : baseline) };
}
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object"
  ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object"
  ? text(value.props?.children) : String(value ?? "");

function compile(file, overrides = {}, cache = new Map()) {
  if (cache.has(file.href)) return cache.get(file.href);
  const native = createRequire(file), exports = {}; cache.set(file.href, exports);
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", code)(name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith(".")) {
      const exact = new URL(name, file), tsx = name.endsWith(".tsx") ? exact : new URL(name + ".tsx", file);
      if (existsSync(tsx)) return compile(tsx, {}, cache);
      const typescript = name.endsWith(".ts") ? exact : new URL(name + ".ts", file);
      if (existsSync(typescript)) return native(typescript.pathname);
    }
    return native(name);
  }, exports);
  return exports;
}

function installedReactStateDispatch() {
  // Use the installed renderer's actual idle-fiber dispatch primitive. This
  // observes its eager same-reference bailout without starting a renderer/DOM.
  const renderer = readFileSync(new URL("../node_modules/react-dom/cjs/react-dom-client.development.js", import.meta.url), "utf8");
  const start = renderer.indexOf("function dispatchSetStateInternal("),
    end = renderer.indexOf("function dispatchOptimisticSetState(", start);
  assert.ok(start >= 0 && end > start, "Installed React state-dispatch primitive unavailable");
  return new Function("isRenderPhaseUpdate", "enqueueRenderPhaseUpdate", "ReactSharedInternals",
    "InvalidNestedHooksDispatcherOnUpdateInDEV", "objectIs", "enqueueUpdate$1", "workInProgressRoot",
    "finishQueueingConcurrentUpdates", "enqueueConcurrentHookUpdate", "scheduleUpdateOnFiber",
    "entangleTransitionUpdate", `return (${renderer.slice(start, end).trim()});`)(
    () => false, () => assert.fail("Unexpected render-phase state change"), { H: null }, {}, Object.is,
    () => {}, null, () => {}, () => ({}), () => {}, () => {});
}
function hookCells(dispatch = null) {
  let cursor = 0, scheduled = 0; const cells = [], effects = [], layouts = [];
  return { hooks: {
    useState(initial) { const index = cursor++; if (!(index in cells)) cells[index] = initial;
      return [cells[index], value => {
        const reducer = (old, action) => typeof action === "function" ? action(old) : action;
        if (!dispatch || dispatch({ lanes: 0, alternate: null }, { lastRenderedReducer: reducer, lastRenderedState: cells[index] }, value, 2)) {
          cells[index] = reducer(cells[index], value); scheduled++;
        }
      }]; },
    useRef(initial) { const index = cursor++; if (!(index in cells)) cells[index] = { current: initial }; return cells[index]; },
    useId() { return "saved-run-export"; }, useLayoutEffect(callback) { layouts.push(callback); }, useEffect(callback) { effects.push(callback); },
  }, scheduled: () => scheduled, clearScheduled() { scheduled = 0; }, begin() { cursor = 0; },
  clearEffects() { effects.length = 0; layouts.length = 0; }, takeEffect() { return effects.pop(); },
  mount() { const cleanups = [...layouts.splice(0), ...effects.splice(0)].map(callback => callback());
    return () => cleanups.forEach(cleanup => cleanup?.()); } };
}
function desk(initialBaseline = baseline, state = hookCells(), observe = null) {
  const diagnostics = [];
  const History = () => createElement("div");
  const { FictionalReviewDesk } = compile(new URL("../app/editorial-preview/fictional-review-desk.tsx", import.meta.url), {
    react: state.hooks, "../update-preview/history": { FictionalHistory: History },
    "../../src/client-error-diagnostics.ts": { observeClientError: code => { diagnostics.push(code); observe?.(code); } },
  });
  const render = () => { state.begin(); return FictionalReviewDesk({ baseline: initialBaseline }); };
  render(); state.mount(); state.clearScheduled();
  return { render, diagnostics, scheduled: state.scheduled, clearScheduled: state.clearScheduled,
    effect(target) {
      state.clearEffects(); const tree = render();
      const panel = nodes(tree).find(node => node.props?.tabIndex === -1);
      if (panel) panel.props.ref.current = target;
      return state.takeEffect();
    },
    markup: () => renderToStaticMarkup(render()), inspect(value) {
    nodes(render()).find(node => node.type === History).props.onInspect(value);
  }, earlier(value) { nodes(render()).find(node => node.type === History).props.onUseEarlier(value); } };
}
function view(initial, allowed = () => true, observe = null) {
  const state = hookCells(), diagnostics = [];
  const { FictionalSavedRunView } = compile(new URL("../src/fictional-saved-run-view.tsx", import.meta.url), {
    react: state.hooks, "./client-error-diagnostics.ts": { observeClientError: code => { diagnostics.push(code); observe?.(code); } },
  });
  let input = initial, cleanup;
  const render = () => { state.begin(); return FictionalSavedRunView({ input, isCurrent: allowed }); };
  return { render, markup: () => renderToStaticMarkup(render()), diagnostics,
    mount() { render(); cleanup = state.mount(); }, unmount() { cleanup?.(); },
    replace(value) { input = value; render(); }, download() {
      const button = nodes(render()).find(node => node.type === "button" && text(node).includes("Download saved run"));
      assert.ok(button); return button.props.onClick;
    } };
}
function downloadTrap(t, fail = "") {
  const calls = [], blobs = [], link = { remove() { calls.push("remove"); }, click() {
    calls.push("click"); if (fail === "click") throw new Error("PRIVATE_CANARY"); } };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  let restored = false;
  const restore = () => { if (restored) return; restored = true;
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else delete globalThis.document; };
  t.after(restore);
  Object.defineProperty(globalThis, "document", { value: { createElement(name) {
    calls.push("create"); assert.equal(name, "a"); if (fail === "create") throw new Error("PRIVATE_CANARY"); return link;
  }, body: { append(value) { calls.push("append"); assert.equal(value, link); } } }, configurable: true });
  t.mock.method(URL, "createObjectURL", blob => { calls.push("url"); blobs.push(blob); return "blob:invented-local"; });
  t.mock.method(URL, "revokeObjectURL", url => { calls.push("revoke"); assert.equal(url, "blob:invented-local"); });
  t.mock.method(globalThis, "fetch", () => assert.fail("Saved-run inspection/export made a network request"));
  return { calls, blobs, link, restore };
}

function commitDeskEffect(create) {
  // Execute the installed renderer's commit primitive with the actual component
  // callback and supplied optional presentation ports, without starting a DOM.
  const renderer = readFileSync(new URL("../node_modules/react-dom/cjs/react-dom-client.development.js", import.meta.url), "utf8");
  const start = renderer.indexOf("function commitHookEffectListMount("),
    end = renderer.indexOf("function commitHookEffectListUnmount(", start);
  assert.ok(start >= 0 && end > start, "Installed React effect-commit primitive unavailable");
  const errors = [];
  const commit = new Function("Insertion", "NoFlags", "Layout", "runWithFiberInDEV", "callCreateInDEV", "captureCommitPhaseError",
    `return (${renderer.slice(start, end).trim()});`)(2, 0, 4,
    (_fiber, callback, value) => callback(value), effect => effect.create(),
    () => errors.push("commit_phase_error"));
  const effect = { tag: 9, create, next: null }; effect.next = effect;
  commit(9, { updateQueue: { lastEffect: effect }, return: {} });
  return errors;
}

test("saved selection survives optional scroll/focus failures through the installed React commit boundary", () => {
  for (const failure of ["scroll", "focus", "both"]) {
    const original = receipt(true), before = JSON.stringify(original), calls = [], ui = desk();
    ui.earlier(receipt()); ui.inspect(original);
    const effect = ui.effect({
      scrollIntoView(options) { calls.push("scroll"); assert.deepEqual(options, { behavior: "auto", block: "start" });
        if (failure !== "focus") throw new Error("PRIVATE_PRESENTATION_CANARY"); },
      focus(options) { calls.push("focus"); assert.deepEqual(options, { preventScroll: true });
        if (failure !== "scroll") throw new Error("PRIVATE_PRESENTATION_CANARY"); },
    });
    assert.deepEqual(commitDeskEffect(effect), []);
    assert.deepEqual(calls, ["scroll", "focus"]);
    const html = ui.markup();
    assert.match(html, /28\.1%/); assert.match(html, /Download saved run/); assert.match(html, /\+0\.7 percentage points/);
    assert.match(html, /Automatic navigation was unavailable/);
    assert.match(html, /href="#selected-saved-run"/); assert.match(html, /id="selected-saved-run"/);
    assert.doesNotMatch(html, /PRIVATE_PRESENTATION_CANARY/);
    assert.equal(JSON.stringify(original), before); assert.deepEqual(ui.diagnostics, ["browser_runtime"]);
    // Strict Mode may mount the same selection effect again. It may attempt
    // navigation again, but should not manufacture another fault reference.
    assert.deepEqual(commitDeskEffect(effect), []); assert.deepEqual(ui.diagnostics, ["browser_runtime"]);
  }
});

test("ordinary saved selection keeps optional navigation and has no failure notice or diagnostic", () => {
  const calls = [], ui = desk(); ui.inspect(receipt());
  assert.deepEqual(commitDeskEffect(ui.effect({ scrollIntoView() { calls.push("scroll"); }, focus() { calls.push("focus"); } })), []);
  assert.deepEqual(calls, ["scroll", "focus"]); assert.deepEqual(ui.diagnostics, []);
  assert.doesNotMatch(ui.markup(), /Automatic navigation was unavailable/);
  assert.match(ui.markup(), /27\.4%/); assert.match(ui.markup(), /Download saved run/);
});

test("retired saved-selection effects cannot navigate or report against a successor", () => {
  const calls = [], ui = desk(); ui.inspect(receipt());
  const old = ui.effect({ scrollIntoView() { calls.push("old scroll"); throw new Error("PRIVATE_CANARY"); }, focus() { calls.push("old focus"); } });
  ui.inspect(receipt(true));
  assert.deepEqual(commitDeskEffect(old), []); assert.deepEqual(calls, []); assert.deepEqual(ui.diagnostics, []);
  assert.match(ui.markup(), /28\.1%/); assert.doesNotMatch(ui.markup(), /Automatic navigation was unavailable/);
});

test("focus cannot continue a retired visit after scroll synchronously selects its successor", () => {
  const calls = [], ui = desk(); ui.inspect(receipt());
  const effect = ui.effect({ scrollIntoView() { calls.push("scroll"); ui.inspect(receipt(true)); throw new Error("PRIVATE_CANARY"); },
    focus() { calls.push("retired focus"); } });
  assert.deepEqual(commitDeskEffect(effect), []); assert.deepEqual(calls, ["scroll"]); assert.deepEqual(ui.diagnostics, []);
  assert.match(ui.markup(), /28\.1%/); assert.doesNotMatch(ui.markup(), /Automatic navigation was unavailable/);
});

test("a new saved visit clears the displayed navigation failure while invalid selection stays withheld", () => {
  const ui = desk(); ui.inspect(receipt());
  assert.deepEqual(commitDeskEffect(ui.effect({ scrollIntoView() {}, focus() { throw new Error("PRIVATE_CANARY"); } })), []);
  assert.match(ui.markup(), /Automatic navigation was unavailable/);
  ui.inspect(receipt(true));
  assert.doesNotMatch(ui.markup(), /Automatic navigation was unavailable/); assert.match(ui.markup(), /28\.1%/);
  ui.inspect({ ...receipt(), privateNote: "PRIVATE_CANARY" });
  let attempted = false;
  assert.deepEqual(commitDeskEffect(ui.effect({ scrollIntoView() { attempted = true; }, focus() { attempted = true; } })), []);
  assert.equal(attempted, false); assert.doesNotMatch(ui.markup(), /Automatic navigation was unavailable|PRIVATE_CANARY|Download saved run/);
  assert.deepEqual(ui.diagnostics, ["browser_runtime"]);
});

test("caught navigation failure preserves the selected result when its diagnostic throws, rejects or stalls", async () => {
  for (const report of [() => { throw new Error("PRIVATE_CANARY"); }, () => Promise.reject(new Error("PRIVATE_CANARY")), () => new Promise(() => {})]) {
    const ui = desk(baseline, hookCells(), code => observeClientError(code, report)); ui.inspect(receipt(true));
    assert.deepEqual(commitDeskEffect(ui.effect({ scrollIntoView() { throw new Error("PRIVATE_CANARY"); }, focus() {} })), []);
    await Promise.resolve(); await Promise.resolve();
    assert.match(ui.markup(), /28\.1%/); assert.match(ui.markup(), /Download saved run/);
    assert.match(ui.markup(), /Automatic navigation was unavailable/); assert.doesNotMatch(ui.markup(), /PRIVATE_CANARY/);
    assert.deepEqual(ui.diagnostics, ["browser_runtime"]);
  }
});

test("optional navigation failure cannot disclose an invalid baseline comparison", () => {
  const damaged = structuredClone(baseline); damaged.fictionalCandidate.observation.value = "27.5";
  const ui = desk(damaged); ui.inspect(receipt(true));
  assert.deepEqual(commitDeskEffect(ui.effect({ scrollIntoView() {}, focus() { throw new Error("PRIVATE_CANARY"); } })), []);
  assert.match(ui.markup(), /28\.1%/); assert.match(ui.markup(), /Saved example unavailable/);
  assert.doesNotMatch(ui.markup(), /\+0\.7 percentage points|PRIVATE_CANARY/);
  assert.deepEqual(ui.diagnostics, ["browser_runtime"]);
});

test("selected saved result shows its actual checked page draft and offers its private run export", () => {
  const ui = desk(); ui.inspect(receipt());
  const html = ui.markup();
  assert.ok(html.includes("In 2025, the fictional share was 27.4%."));
  assert.ok(html.includes("Inspect the proposed fact"));
  assert.ok(html.includes("Download saved run"));
  assert.ok(html.includes("Current publication unavailable"));
  assert.ok(html.includes("Fictional draft"));
});

test("desk validates the whole selected result, both comparison operands and absent draft outcomes", () => {
  const ui = desk(), invalid = receipt();
  invalid.report.items[0].source.contentSha256 = "0".repeat(64);
  ui.inspect(invalid); assert.doesNotMatch(ui.markup(), /27\.4%|Download saved run|PRIVATE_CANARY/);
  ui.inspect({ ...receipt(), privateNote: "PRIVATE_CANARY" }); assert.doesNotMatch(ui.markup(), /27\.4%|Download saved run|PRIVATE_CANARY/);
  ui.inspect(receipt(true)); ui.earlier({ ...receipt(), privateNote: "PRIVATE_CANARY" });
  assert.doesNotMatch(ui.markup(), /\+0\.7 percentage points|PRIVATE_CANARY/);
  assert.match(ui.markup(), /Earlier run unavailable/);
  const damagedBaseline = structuredClone(baseline); damagedBaseline.fictionalCandidate.observation.value = "27.5";
  const other = desk(damagedBaseline); other.inspect(receipt(true));
  assert.doesNotMatch(other.markup(), /\+0\.7 percentage points/);
  assert.match(other.markup(), /Saved example unavailable/);
  const missing = receipt(); missing.execution.scenario = "missing_source";
  missing.report = { ...missing.report, state: "partial", coveredSourceKeys: [], items: [], fictionalCandidate: null };
  ui.inspect(missing); assert.match(ui.markup(), /No checked page draft/); assert.doesNotMatch(ui.markup(), /Inspect the proposed fact/);
});

test("selected draft replacement retains the existing exact saved-run comparison", () => {
  const ui = desk(); ui.earlier(receipt()); ui.inspect(receipt(true));
  assert.match(ui.markup(), /In 2025, the fictional share was 28\.1%\./);
  assert.match(ui.markup(), /\+0\.7 percentage points/);
  assert.match(ui.markup(), /Two saved fictional runs/);
  assert.match(ui.markup(), /zero published/);
});

test("whole-result export preserves exact historical identities and refuses invalid authority/binding/private fields", async () => {
  const { exportFictionalSavedRun } = await import("../src/fictional-saved-run-export.ts");
  const original = receipt(), before = JSON.stringify(original);
  assert.deepEqual(JSON.parse(exportFictionalSavedRun(original)), original);
  assert.equal(JSON.stringify(original), before);
  const badBinding = receipt(); badBinding.report.items[0].source.locator = "wrong location";
  const live = receipt(); live.report.reportKind = "verified_run";
  for (const bad of [null, { ...receipt(), privateNote: "PRIVATE_CANARY" }, badBinding, live])
    assert.throws(() => exportFictionalSavedRun(bad));
});

test("native saved-run download uses checked bytes, fixed filename and cleanup without upload", async t => {
  const trap = downloadTrap(t), original = receipt(), ui = view(original);
  ui.mount(); ui.download()();
  assert.deepEqual(JSON.parse(await trap.blobs[0].text()), original);
  assert.equal(trap.link.download, "terrafracta-fictional-saved-run.json");
  assert.deepEqual(trap.calls, ["create", "url", "append", "click", "remove", "revoke"]);
  assert.match(ui.markup(), /Download requested/); assert.deepEqual(ui.diagnostics, []); ui.unmount();
});

test("retired selection and unmount callbacks cannot touch native download or diagnostics", t => {
  const trap = downloadTrap(t); let current = true; const ui = view(receipt(), () => current);
  ui.mount(); const old = ui.download(); current = false; old();
  assert.deepEqual(trap.calls, []); current = true; ui.unmount(); old();
  assert.deepEqual(trap.calls, []); assert.deepEqual(ui.diagnostics, []);
  const chosen = desk(); chosen.inspect(receipt());
  const savedView = tree => nodes(tree).find(node => node.type?.name === "FictionalSavedRunView").props;
  const first = savedView(chosen.render()); assert.equal(first.isCurrent(), true);
  chosen.inspect(receipt(true)); assert.equal(first.isCurrent(), false);
  chosen.inspect(receipt()); assert.equal(first.isCurrent(), false);
  assert.equal(savedView(chosen.render()).isCurrent(), true);
});

test("reselecting the exact history object schedules a fresh active export with installed React", t => {
  const trap = downloadTrap(t), shared = receipt(), state = hookCells(installedReactStateDispatch()), ui = desk(baseline, state);
  const selectedView = tree => nodes(tree).find(node => node.type?.name === "FictionalSavedRunView");
  ui.inspect(shared); assert.equal(ui.scheduled(), 1);
  const first = selectedView(ui.render());
  let active = view(first.props.input, first.props.isCurrent); active.mount();
  const retired = active.download(); ui.clearScheduled();
  // History closes over one saved entry, so invoke the same entry object again.
  const history = nodes(ui.render()).find(node => typeof node.props?.onInspect === "function");
  history.props.onInspect(shared);
  const scheduledAfterReselect = ui.scheduled();
  assert.equal(first.props.isCurrent(), false); retired(); assert.deepEqual(trap.calls, []);
  if (scheduledAfterReselect > 0) {
    const next = selectedView(ui.render());
    assert.notEqual(next.key, first.key); assert.equal(next.props.isCurrent(), true);
    active.unmount(); active = view(next.props.input, next.props.isCurrent); active.mount();
  }
  active.download()(); active.unmount();
  t.diagnostic(JSON.stringify({ sameObjectReused: true, scheduledAfterReselect,
    initialVisitRetired: !first.props.isCurrent(), nativeClicks: trap.calls.filter(value => value === "click").length }));
  assert.equal(trap.calls.filter(value => value === "click").length, 1,
    "The visible saved-run export must stay usable after selecting the exact same history object");
  assert.equal(scheduledAfterReselect, 1);
  assert.deepEqual(active.diagnostics, []);
});

test("invalid or replaced view input withholds the draft and retires the old export handler", t => {
  const trap = downloadTrap(t), ui = view(receipt()); ui.mount(); const old = ui.download();
  ui.replace({ ...receipt(), privateNote: "PRIVATE_CANARY" }); old();
  assert.deepEqual(trap.calls, []); assert.doesNotMatch(ui.markup(), /27\.4%|Download saved run|PRIVATE_CANARY/);
  const hostile = Object.defineProperty({}, "execution", { enumerable: true, get() { throw new Error("PRIVATE_CANARY"); } });
  ui.replace(hostile); assert.doesNotMatch(ui.markup(), /PRIVATE_CANARY|Download saved run/); ui.unmount();
});

test("unexpected native download failures preserve the selected draft and consume only the closed saved-run action diagnostic", t => {
  for (const failure of ["create", "click"]) {
    const trap = downloadTrap(t, failure), ui = view(receipt()); ui.mount();
    assert.doesNotThrow(() => ui.download()());
    assert.match(ui.markup(), /could not be exported/); assert.match(ui.markup(), /27\.4%/);
    assert.doesNotMatch(ui.markup(), /PRIVATE_CANARY/); assert.deepEqual(ui.diagnostics, ["saved_run_export"]);
    if (failure === "click") { assert.ok(trap.calls.includes("remove")); assert.ok(trap.calls.includes("revoke")); }
    ui.unmount(); trap.restore(); t.mock.restoreAll();
  }
});

test("native saved-run export failure reaches its specific private diagnostic record and saved report view", { timeout: 3000 }, async t => {
  const trap = downloadTrap(t, "click"), parent = await mkdtemp("/tmp/terrafracta-saved-run-diagnostic-"),
    directory = join(parent, "log"), output = join(parent, "export.json"), store = new ErrorLogStore(directory);
  const record = createDevelopmentErrorRecorder(value => store.append(value), () => "development", () => 0),
    intake = createDiagnosticIntake(record, () => 0), wire = [];
  let finish;
  const accepted = new Promise(resolve => { finish = resolve; });
  const reporter = createClientErrorReporter("development", async (url, options) => {
    assert.equal(url, "/api/dev/error-log"); wire.push(JSON.parse(options.body));
    const response = await intake(new Request("http://127.0.0.1:3000" + url, {
      ...options, headers: { ...options.headers, origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
    }), "development");
    finish(response.status); return response;
  }, () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc", () => 0);
  const ui = view(receipt(), () => true, code => observeClientError(code, reporter));
  ui.mount(); ui.download()(); assert.equal(await accepted, 204);
  assert.match(ui.markup(), /could not be exported/); assert.match(ui.markup(), /27\.4%/);
  ui.unmount(); assert.doesNotMatch(ui.markup(), /could not be exported/);
  assert.deepEqual(Object.keys(wire[0]).sort(), ["code", "eventId"]);
  const inspection = await store.inspect(); assert.equal(inspection.events.length, 1);
  const event = inspection.events[0], original = await readFile(join(directory, event.eventId + ".json"));
  await exportErrorLog(directory, output);
  const bytes = await readFile(output), parsed = readDiagnosticExport(new Uint8Array(bytes).buffer);
  t.diagnostic(JSON.stringify({ privateTemporaryArchive: parent, caughtCode: event.code,
    currentReportVersion: parsed.schemaVersion, exactEventFields: Object.keys(event).sort() }));
  assert.equal(event.code, "saved_run_export"); assert.equal(event.origin, "browser"); assert.equal(event.schemaVersion, 1);
  assert.deepEqual(Object.keys(event).sort(), ["code", "eventId", "occurredAt", "origin", "schemaVersion"]);
  assert.equal(parsed.counts.saved_run_export, 1); assert.equal(parsed.counts.browser_runtime, 0);
  assert.equal(parsed.captureCompleteness, "unknown"); assert.equal(parsed.buildBinding, "not_bound_to_a_deployed_build");
  assert.ok(!bytes.toString().includes("PRIVATE_CANARY"));
  assert.deepEqual(await readFile(join(directory, event.eventId + ".json")), original);
  const selection = diagnosticSelection({ code: "saved_run_export", origin: "browser", ref: event.eventId });
  assert.ok(selection); const selected = selectDiagnosticEvents(parsed, selection);
  assert.equal(selected.total, 1); assert.equal(selected.groups[0].location, "editorial preview / download saved run");
  const { DiagnosticWorkspace } = compile(new URL("../src/diagnostic-workspace-view.tsx", import.meta.url));
  const html = renderToStaticMarkup(createElement(DiagnosticWorkspace, { result: { kind: "available", report: parsed }, selection }));
  assert.ok(html.includes("editorial preview / download saved run")); assert.ok(html.includes(event.eventId));
  assert.ok(!html.includes("PRIVATE_CANARY")); assert.deepEqual(ui.diagnostics, ["saved_run_export"]);
});

test("caught desk navigation failure reaches the existing closed private runtime log and saved diagnostic view", { timeout: 3000 }, async t => {
  const parent = await mkdtemp("/tmp/terrafracta-desk-navigation-diagnostic-"), directory = join(parent, "log"),
    output = join(parent, "export.json"), store = new ErrorLogStore(directory), wire = [];
  const record = createDevelopmentErrorRecorder(value => store.append(value), () => "development", () => 0),
    intake = createDiagnosticIntake(record, () => 0);
  let finish;
  const accepted = new Promise(resolve => { finish = resolve; });
  const reporter = createClientErrorReporter("development", async (url, options) => {
    assert.equal(url, "/api/dev/error-log"); wire.push(JSON.parse(options.body));
    const response = await intake(new Request("http://127.0.0.1:3000" + url, {
      ...options, headers: { ...options.headers, origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
    }), "development");
    finish(response.status); return response;
  }, () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd", () => 0);
  const original = receipt(true), before = JSON.stringify(original), ui = desk(baseline, hookCells(), code => observeClientError(code, reporter));
  ui.inspect(original);
  assert.deepEqual(commitDeskEffect(ui.effect({ scrollIntoView() { throw new Error("PRIVATE_PRESENTATION_CANARY"); }, focus() {} })), []);
  assert.equal(await accepted, 204); assert.equal(JSON.stringify(original), before);
  assert.match(ui.markup(), /28\.1%/); assert.match(ui.markup(), /Download saved run/);
  assert.deepEqual(Object.keys(wire[0]).sort(), ["code", "eventId"]);
  const inspection = await store.inspect(); assert.equal(inspection.events.length, 1);
  const event = inspection.events[0], originalEvent = await readFile(join(directory, event.eventId + ".json"));
  await exportErrorLog(directory, output);
  const bytes = await readFile(output), parsed = readDiagnosticExport(new Uint8Array(bytes).buffer);
  assert.equal(event.code, "browser_runtime"); assert.equal(event.origin, "browser"); assert.equal(event.schemaVersion, 1);
  assert.deepEqual(Object.keys(event).sort(), ["code", "eventId", "occurredAt", "origin", "schemaVersion"]);
  assert.equal(parsed.counts.browser_runtime, 1); assert.equal(parsed.counts.saved_run_export, 0);
  assert.equal(parsed.captureCompleteness, "unknown"); assert.equal(parsed.buildBinding, "not_bound_to_a_deployed_build");
  assert.doesNotMatch(bytes.toString(), /PRIVATE_PRESENTATION_CANARY|fictionalCandidate|28\.1/);
  assert.deepEqual(await readFile(join(directory, event.eventId + ".json")), originalEvent);
  const selection = diagnosticSelection({ code: "browser_runtime", origin: "browser", ref: event.eventId }); assert.ok(selection);
  assert.equal(selectDiagnosticEvents(parsed, selection).total, 1);
  const { DiagnosticWorkspace } = compile(new URL("../src/diagnostic-workspace-view.tsx", import.meta.url));
  const html = renderToStaticMarkup(createElement(DiagnosticWorkspace, { result: { kind: "available", report: parsed }, selection }));
  assert.ok(html.includes(event.eventId)); assert.doesNotMatch(html, /PRIVATE_PRESENTATION_CANARY|28\.1/);
  t.diagnostic(JSON.stringify({ privateTemporaryArchive: parent, caughtCode: event.code, captureCompleteness: parsed.captureCompleteness,
    exactEventFields: Object.keys(event).sort(), renderedBrowser: false, networkOrDefaultArchive: false }));
  assert.deepEqual(ui.diagnostics, ["browser_runtime"]);
});
