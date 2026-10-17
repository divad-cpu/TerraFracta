import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setImmediate as turn } from "node:timers/promises";
import test from "node:test";
import * as react from "react";
import ts from "typescript";
import { FictionalUpdateRequestError } from "../src/fictional-update-request.ts";
import { observeClientError } from "../src/client-error-diagnostics.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
const revised = JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json", import.meta.url), "utf8"));
const receipt = (later = false) => ({ execution: { id: later ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  kind: "local_fictional", scenario: later ? "revised_value" : "standard", executedAt: later ? "2026-10-05T10:01:00Z" : "2026-10-05T10:00:00Z", durationMs: 1 },
  report: structuredClone(later ? revised : saved) });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object"
  ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object"
  ? text(value.props?.children) : String(value ?? "");
function operationHarness(request, prior = null, report = async () => null, dispatch = null) {
  const path = new URL("../app/update-preview/operation.tsx", import.meta.url), nativeRequire = createRequire(path);
  const states = [], refs = [], effects = []; let index = 0, refIndex = 0, effectIndex = 0, cleanup, layoutIndex = 0; const layouts = [];
  const hooks = { ...react, useId: () => "operation-port", useState: (initial) => {
    const id = index++, value = id === 2 ? prior : initial;
    states[id] ??= { value, writes: [] };
    return [states[id].value, (next) => {
      const reducer = (old, action) => typeof action === "function" ? action(old) : action;
      if (dispatch && !dispatch({ lanes: 0, alternate: null }, { lastRenderedReducer: reducer, lastRenderedState: states[id].value }, next, 2)) return;
      states[id].writes.push(next); states[id].value = reducer(states[id].value, next);
    }];
  }, useRef: (value) => { const id = refIndex++; refs[id] ??= { current: value }; return refs[id]; }, useLayoutEffect: (fn, deps) => { const i = layoutIndex++, old = layouts[i]; if (!old || deps.some((v,j) => v !== old.deps[j])) layouts[i] = { fn, deps, cleanup: old?.cleanup, pending: true }; }, useEffect: callback => { effects[effectIndex++] = callback; } };
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const PreviewChild = () => null;
  const children = { "./candidate": { FictionalCandidate: PreviewChild }, "./history": { FictionalHistory: PreviewChild },
    "./comparison": { FictionalComparison: PreviewChild } };
  const require = (name) => name === "react" ? hooks :
    name.endsWith("fictional-update-request") ? { requestFictionalUpdate: request, FictionalUpdateRequestError } :
    name.endsWith("client-error-diagnostics.ts") ? { reportClientError: report, observeClientError: code => observeClientError(code, report) } :
    name.endsWith("fictional-decision-labels") || name.endsWith("update-run-report") ? nativeRequire(name + ".ts") :
    Object.hasOwn(children, name) ? children[name] : nativeRequire(name);
  new Function("require", "exports", compiled)(require, exports);
  const render = () => { index = 0; refIndex = 0; effectIndex = 0; layoutIndex = 0; const tree = exports.UpdateOperation({ initialReport: saved }); for (const e of layouts) if (e.pending) { e.cleanup?.(); e.cleanup = e.fn(); e.pending = false; } return tree; };
  function find(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "form") return node;
    for (const child of react.Children.toArray(node.props?.children)) { const match = find(child);if (match) return match; }
  }

  function history(node) {
    if (!node || typeof node !== "object") return;
    if (typeof node.props?.onInspect === "function") return node;
    for (const child of react.Children.toArray(node.props?.children)) { const match = history(child); if (match) return match; }
  }
  const h = { render, states, refs,
    submit: () => find(render()).props.onSubmit({ preventDefault() {} }),
    inspect: row => history(render()).props.onInspect(row),
    retainedSubmit: () => find(render()).props.onSubmit,
    retainedInspect: () => history(render()).props.onInspect,
    presentationEffect(target) { render(); refs[1].current = target; return effects[1]; },
    mount() { for (const e of layouts) e.pending = true; render(); cleanup = effects[0]?.(); render(); }, unmount() { for (const e of layouts) e.cleanup?.(); cleanup?.(); },
    field(type) { function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : []; }
      return nodes(render()).filter(node => node.type === type).map(node => node.props); },
  };
  h.mount(); if (prior) { h.inspect(prior); for (const state of states) state.writes.length = 0; }
  return h;
}

function installedReactPrimitive(name, next, parameters, dependencies) {
  const source = readFileSync(new URL("../node_modules/react-dom/cjs/react-dom-client.development.js", import.meta.url), "utf8");
  const start = source.indexOf(`function ${name}(`), end = source.indexOf(`function ${next}(`, start);
  assert.ok(start >= 0 && end > start, "Installed React primitive unavailable");
  return new Function(...parameters, `return (${source.slice(start, end).trim()});`)(...dependencies);
}
function commitPresentation(create) {
  const errors = [], commit = installedReactPrimitive("commitHookEffectListMount", "commitHookEffectListUnmount",
    ["Insertion", "NoFlags", "Layout", "runWithFiberInDEV", "callCreateInDEV", "captureCommitPhaseError"],
    [2, 0, 4, (_fiber, callback, value) => callback(value), effect => effect.create(), () => errors.push("commit_phase_error")]);
  const effect = { tag: 9, create, next: null }; effect.next = effect;
  commit(9, { updateQueue: { lastEffect: effect }, return: {} }); return errors;
}
function installedReactDispatch() {
  return installedReactPrimitive("dispatchSetStateInternal", "dispatchOptimisticSetState",
    ["isRenderPhaseUpdate", "enqueueRenderPhaseUpdate", "ReactSharedInternals", "InvalidNestedHooksDispatcherOnUpdateInDEV",
      "objectIs", "enqueueUpdate$1", "workInProgressRoot", "finishQueueingConcurrentUpdates", "enqueueConcurrentHookUpdate",
      "scheduleUpdateOnFiber", "entangleTransitionUpdate"],
    [() => false, () => assert.fail("Unexpected render-phase update"), { H: null }, {}, Object.is,
      () => {}, null, () => {}, () => ({}), () => {}, () => {}]);
}

test("saved update inspection contains scroll/focus faults without losing its checked report", async () => {
  for (const failure of ["scroll", "focus", "both"]) {
    const original = receipt(true), before = JSON.stringify(original), calls = [], codes = [];
    const h = operationHarness(() => assert.fail("Inspection started a rehearsal"), original, code => { codes.push(code); return null; });
    const effect = h.presentationEffect({ scrollIntoView(options) { calls.push("scroll"); assert.deepEqual(options, { behavior: "auto", block: "start" });
      if (failure !== "focus") throw new Error("PRIVATE_PRESENTATION_CANARY"); },
    focus(options) { calls.push("focus"); assert.deepEqual(options, { preventScroll: true }); if (failure !== "scroll") throw new Error("PRIVATE_PRESENTATION_CANARY"); } });
    assert.deepEqual(commitPresentation(effect), []); assert.deepEqual(calls, ["scroll", "focus"]);
    await turn(); assert.deepEqual(codes, ["browser_runtime"]); assert.equal(JSON.stringify(original), before);
    assert.deepEqual(h.states[2].value, original); assert.equal(h.states[4].value, false); assert.equal(h.refs[0].current, null);
    const tree = h.render(), panel = nodes(tree).find(node => node.props?.className === "update-execution");
    assert.equal(panel.props.id, "selected-rehearsal-execution");
    assert.match(text(tree), /Automatic navigation was unavailable/); assert.match(text(tree), /zero|Public changes: 0/);
    assert.ok(nodes(tree).some(node => node.type === "a" && node.props.href === "#selected-rehearsal-execution"));
    assert.ok(nodes(tree).some(node => node.props?.candidate?.observation?.value === "28.1"));
    assert.doesNotMatch(text(tree), /PRIVATE_PRESENTATION_CANARY/);
    assert.deepEqual(commitPresentation(effect), []); await turn(); assert.deepEqual(codes, ["browser_runtime"]); h.unmount();
  }
});

test("normal saved update inspection keeps both optional navigation operations silent", async () => {
  const calls = [], codes = [], h = operationHarness(() => assert.fail("Inspection started a rehearsal"), receipt(), code => { codes.push(code); });
  assert.deepEqual(commitPresentation(h.presentationEffect({ scrollIntoView() { calls.push("scroll"); }, focus() { calls.push("focus"); } })), []);
  await turn(); assert.deepEqual(calls, ["scroll", "focus"]); assert.deepEqual(codes, []);
  assert.doesNotMatch(text(h.render()), /Automatic navigation was unavailable/); h.unmount();
});

test("a superseded saved update effect is inert before the next render and after unmount", async () => {
  const original = receipt(), calls = [], codes = [], h = operationHarness(() => assert.fail("Inspection started a rehearsal"), original, code => { codes.push(code); });
  const inspect = h.retainedInspect(), old = h.presentationEffect({ scrollIntoView() { calls.push("scroll"); throw new Error("PRIVATE_CANARY"); }, focus() { calls.push("focus"); } });
  inspect(original); assert.deepEqual(commitPresentation(old), []); assert.deepEqual(calls, []);
  const current = h.presentationEffect({ scrollIntoView() { calls.push("current"); }, focus() {} });
  h.unmount(); assert.deepEqual(commitPresentation(current), []); await turn(); assert.deepEqual(calls, []); assert.deepEqual(codes, []);
});

test("starting a rehearsal during optional scroll retires that display effect while keeping physical request ownership", async () => {
  let finish, requests = 0; const codes = [], calls = [], original = receipt();
  const h = operationHarness(() => { requests++; return new Promise(resolve => { finish = resolve; }); }, original, code => { codes.push(code); });
  const effect = h.presentationEffect({ scrollIntoView() { calls.push("scroll"); h.submit(); throw new Error("PRIVATE_CANARY"); }, focus() { calls.push("retired focus"); } });
  assert.deepEqual(commitPresentation(effect), []); await turn(); assert.deepEqual(calls, ["scroll"]); assert.deepEqual(codes, []);
  assert.equal(requests, 1); assert.ok(h.refs[0].current instanceof AbortController); assert.equal(h.states[4].value, true);
  assert.deepEqual(h.states[2].value, original); h.submit(); assert.equal(requests, 1);
  finish(receipt(true)); await turn(); assert.equal(h.refs[0].current, null); assert.equal(h.states[4].value, false);
  assert.deepEqual(h.states[2].value, receipt(true)); assert.doesNotMatch(text(h.render()), /Automatic navigation was unavailable/); h.unmount();
});

test("same saved update object schedules a new display visit with installed React eager bailout", async () => {
  const original = receipt(), codes = [], h = operationHarness(() => assert.fail("Inspection started a rehearsal"), original,
    code => { codes.push(code); }, installedReactDispatch());
  const target = { scrollIntoView() { throw new Error("PRIVATE_CANARY"); }, focus() {} }, old = h.presentationEffect(target);
  assert.deepEqual(commitPresentation(old), []); await turn(); assert.deepEqual(codes, ["browser_runtime"]);
  for (const state of h.states) state.writes.length = 0;
  h.retainedInspect()(original);
  assert.equal(h.states.reduce((count, state) => count + state.writes.length, 0), 1,
    "Reselecting the same history object must admit a fresh display visit");
  assert.deepEqual(commitPresentation(old), []); await turn(); assert.deepEqual(codes, ["browser_runtime"]);
  assert.doesNotMatch(text(h.render()), /Automatic navigation was unavailable/);
  assert.deepEqual(commitPresentation(h.presentationEffect(target)), []); await turn(); assert.deepEqual(codes, ["browser_runtime", "browser_runtime"]);
  assert.deepEqual(h.states[2].value, original); h.unmount();
});

test("unavailable navigation diagnostics cannot replace saved update selection or normal recovery status", async () => {
  for (const report of [() => { throw new Error("PRIVATE_CANARY"); }, () => Promise.reject(new Error("PRIVATE_CANARY")), () => new Promise(() => {})]) {
    const original = receipt(), h = operationHarness(() => assert.fail("Inspection started a rehearsal"), original, report), message = h.states[5].value;
    assert.deepEqual(commitPresentation(h.presentationEffect({ scrollIntoView() {}, focus() { throw new Error("PRIVATE_CANARY"); } })), []);
    await turn(); assert.deepEqual(h.states[2].value, original); assert.equal(h.states[5].value, message); assert.equal(h.states[6].value, null);
    assert.match(text(h.render()), /Automatic navigation was unavailable/); assert.doesNotMatch(text(h.render()), /PRIVATE_CANARY/); h.unmount();
  }
});

// Instrument only hooks/imports and invoke actual form handlers. This proves
// synchronous ownership and explicit effect setup/cleanup through persistent
// hook cells. This is not actual React lifecycle, DOM, Browser or hydration.
test("two synchronous submissions share one controller before any rerender", async () => {
  let calls = 0, finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const h = operationHarness(async () => { calls++;return pending; });
  const submit = h.retainedSubmit(); submit({ preventDefault() {} }); submit({ preventDefault() {} }); assert.equal(calls, 1);assert.ok(h.refs[0].current instanceof AbortController);
  finish({ report: saved, execution: { scenario: "standard" } });await turn();
  assert.equal(h.refs[0].current, null);assert.equal(h.states[4].value, false);
});

test("an unconfirmed response retains the previous result and directs the user to saved runs", async () => {
  let calls = 0;const prior = { report: saved, execution: { scenario: "standard", executedAt: "2026-10-02T14:00:00Z", durationMs: 1 } };
  const h = operationHarness(async () => { calls++;throw new FictionalUpdateRequestError("unconfirmed"); }, prior);
  h.submit();h.submit();await turn();
  assert.equal(calls, 1);assert.deepEqual(h.states[2].value, prior);assert.deepEqual(h.states[2].writes, []);
  assert.ok(h.states[6].value.includes("A saved receipt may exist"));
  assert.ok(h.states[6].value.includes("Load recent runs"));
  assert.equal(h.refs[0].current, null);assert.equal(h.states[4].value, false);
});
test("a response deadline notice does not release the rehearsal slot or replace the prior result", async () => {
  let calls = 0, notice, reject;
  const prior = { report: saved, execution: { scenario: "standard", executedAt: "2026-10-02T14:00:00Z", durationMs: 1 } };
  const h = operationHarness(async (_trigger, _scenario, _signal, onDeadline) => {
    calls++; notice = onDeadline; return new Promise((_resolve, fail) => { reject = fail; });
  }, prior);
  h.submit(); notice(); h.submit();
  assert.equal(calls, 1); assert.ok(h.refs[0].current instanceof AbortController); assert.equal(h.states[4].value, true);
  assert.match(h.states[5].value, /response deadline elapsed/); assert.deepEqual(h.states[2].writes, []);
  reject(new FictionalUpdateRequestError("unconfirmed")); await turn();
  assert.equal(h.refs[0].current, null); assert.equal(h.states[4].value, false);
  assert.match(h.states[6].value, /saved receipt may exist/);
});
test("expected busy and full archives retain recovery notices without automatic client fault records", async () => {
  for (const reason of ['busy', 'archive_full']) {
    const codes = [], prior = { report: saved, execution: { scenario: 'standard', executedAt: '2026-10-02T14:00:00Z', durationMs: 1 } };
    const h = operationHarness(async () => { throw new FictionalUpdateRequestError(reason); }, prior, async code => { codes.push(code); return null; });
    h.submit(); await turn(); assert.deepEqual(h.states[2].value, prior); assert.equal(h.states[4].value, false);
    assert.match(h.states[6].value, reason === 'busy' ? /already running/ : /archive is full/);
    assert.deepEqual(codes, []);
  }
});
test("a failing or stalled diagnostic reporter cannot replace an unconfirmed update's recovery state", async () => {
  for (const report of [() => { throw new Error('PRIVATE_LOGGER_CANARY'); }, async () => { throw new Error('PRIVATE_LOGGER_CANARY'); }, () => new Promise(() => {})]) {
    const codes = [], h = operationHarness(async () => { throw new FictionalUpdateRequestError('unconfirmed'); }, null,
      code => { codes.push(code); return report(code); });
    h.submit(); await turn(); assert.equal(h.refs[0].current, null); assert.equal(h.states[4].value, false);
    assert.match(h.states[6].value, /response could not be confirmed/); assert.match(h.states[5].value, /No fresh result was confirmed/);
    assert.deepEqual(codes, ['update_request']); assert.ok(!JSON.stringify(h.states).includes('PRIVATE_LOGGER_CANARY'));
  }
});


test("a saved-history inspection cannot replace the display during a synchronously admitted rehearsal", async () => {
  let finish; const prior = { report: saved, execution: { scenario: "standard", executedAt: "2026-10-02T14:00:00Z", durationMs: 1 } };
  const h = operationHarness(() => new Promise(resolve => { finish = resolve; }), prior);
  const other = { ...prior, execution: { ...prior.execution, executedAt: "2026-10-02T15:00:00Z" } };
  const inspect = h.retainedInspect(), viewingSaved = h.states[3].value;
  h.submit(); inspect(other);
  assert.deepEqual(h.states[2].writes, []); assert.equal(h.states[3].value, viewingSaved);
  finish(other); await turn(); assert.deepEqual(h.states[2].value, other);
  h.inspect(prior); assert.deepEqual(h.states[2].value, prior); assert.equal(h.states[3].value, true);
});

test("retired update forms and saved inspection cannot dispatch or change a successor visit", async () => {
  let calls = 0;
  const prior = { report: saved, execution: { scenario: "standard", executedAt: "2026-10-02T14:00:00Z", durationMs: 1 } };
  const h = operationHarness(async () => { calls++; return prior; }, prior);
  const oldSubmit = h.retainedSubmit(), oldInspect = h.retainedInspect(), oldScenario = h.field("select")[0], oldTrigger = h.field("input")[1];
  h.unmount(); const writes = () => h.states.reduce((n, state) => n + state.writes.length, 0), retired = writes();
  oldSubmit({ preventDefault() {} }); oldInspect(prior); oldScenario.onChange({ target: { value: "revised_value" } }); oldTrigger.onChange();
  assert.equal(calls, 0); assert.equal(writes(), retired);
  h.mount(); const successor = writes();
  oldSubmit({ preventDefault() {} }); oldInspect(prior); oldScenario.onChange({ target: { value: "revised_value" } }); oldTrigger.onChange();
  assert.equal(calls, 0); assert.equal(writes(), successor); assert.equal(h.states[2].value, null);
  h.submit(); await turn(); assert.equal(calls, 1); assert.deepEqual(h.states[2].value, prior); h.unmount();
});

test("retired pending update retains its physical slot and transfers only availability after settlement", async () => {
  let calls = 0, finish, notice; const codes = [];
  const prior = { report: saved, execution: { scenario: "standard", executedAt: "2026-10-02T14:00:00Z", durationMs: 1 } };
  const h = operationHarness((_trigger, _scenario, _signal, deadline) => {
    calls++; notice = deadline; return new Promise(resolve => { finish = resolve; });
  }, prior, async code => { codes.push(code); return null; });
  const oldSubmit = h.retainedSubmit(); h.submit(); const owned = h.refs[0].current;
  h.unmount(); assert.equal(owned.signal.aborted, true); h.mount(); assert.equal(h.states[4].value, true);
  h.submit(); oldSubmit({ preventDefault() {} }); assert.equal(calls, 1);
  const successor = h.states.map(state => state.writes.length); notice(); assert.deepEqual(h.states.map(state => state.writes.length), successor);
  finish(prior); await turn(); assert.equal(h.refs[0].current, null); assert.equal(h.states[4].value, false);
  assert.equal(h.states[2].value, null); assert.deepEqual(codes, []);
  oldSubmit({ preventDefault() {} }); assert.equal(calls, 1);
  h.submit(); assert.equal(calls, 2); finish(prior); await turn(); assert.deepEqual(h.states[2].value, prior); h.unmount();
});
