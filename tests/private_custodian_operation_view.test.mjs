import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { withLocalRequestDeadline } from "../src/local-request-deadline.ts";
import { parsePrivateCustodianOperationStatus } from "../src/private-custodian-operation.ts";
import { observeClientError } from "../src/client-error-diagnostics.ts";
import { inventedCustodianExecution } from "./helpers/private_custodian_execution.mjs";

const turn = () => new Promise(resolve => setImmediate(resolve));
function load(file, injected) {
  const native = createRequire(file), exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", code)(name => Object.hasOwn(injected, name) ? injected[name] : native(name), exports);
  return exports;
}
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
function harness(t) {
  const calls = [], timers = [], codes = [], states = [], effects = [], pendingEffects = new Map(), layouts = [], pendingLayouts = new Map();
  let cursor = 0, mounted = true, retiredWrites = 0;
  t.mock.method(globalThis, "fetch", (url, options) => new Promise((resolve, reject) => {
    assert.equal(url, "/api/dev/private-custodian");calls.push({ ...options, resolve, reject });
  }));
  t.mock.method(globalThis, "setTimeout", (callback, ms) => {
    assert.ok(ms === 5_000 || ms === 1_000);const timer = { callback, ms, cleared: false };timers.push(timer);return timer;
  });
  t.mock.method(globalThis, "clearTimeout", timer => { if (timer) timer.cleared = true; });
  const request = load(new URL("../src/private-custodian-request.ts", import.meta.url), {
    "./local-request-deadline.ts": { withLocalRequestDeadline },
    "./private-custodian-operation.ts": { parsePrivateCustodianOperationStatus },
    "./client-error-diagnostics.ts": { observeClientError: code => observeClientError(code, value => { codes.push(value); }) },
  }).requestPrivateCustodianStatus;
  const hooks = {
    useState(initial) { const index = cursor++;if (!(index in states)) states[index] = initial;
      return [states[index], value => { if (!mounted) retiredWrites++;states[index] = value; }]; },
    useRef(initial) { const index = cursor++;if (!(index in states)) states[index] = { current: initial };return states[index]; },
    useLayoutEffect(callback, deps) { const index = cursor++, previous = layouts[index];
      if (!previous || !deps || deps.some((value, n) => value !== previous.deps[n])) pendingLayouts.set(index, { callback, deps }); },
    useEffect(callback, deps) { const index = cursor++, previous = effects[index];
      if (!previous || !deps || deps.some((value, n) => value !== previous.deps[n])) pendingEffects.set(index, { callback, deps }); },
  };
  const component = load(new URL("../src/private-custodian-operation-view.tsx", import.meta.url), {
    react: hooks, "./private-custodian-request": { requestPrivateCustodianStatus: request },
  }).PrivateCustodianOperationView;
  const render = () => { cursor = 0;return component(); };
  const commit = () => { render();for (const [index, next] of pendingLayouts) { layouts[index]?.cleanup?.();layouts[index] = { ...next, cleanup: next.callback() }; }pendingLayouts.clear();const jobs = [...pendingEffects];pendingEffects.clear();
    for (const [index, next] of jobs) { effects[index]?.cleanup?.();effects[index] = { ...next, cleanup: next.callback() }; } };
  return { calls, timers, codes, commit, markup: () => renderToStaticMarkup(render()),
    button: () => nodes(render()).find(node => node.type === "button").props,
    mount() { commit(); }, unmount() { mounted = false;for (const effect of layouts) effect?.cleanup?.();for (const effect of effects) effect?.cleanup?.(); },
    reestablishEffects() { for (const effect of layouts) effect?.cleanup?.();for (const effect of effects) effect?.cleanup?.();layouts.length = 0;pendingLayouts.clear();effects.length = 0;pendingEffects.clear();commit(); },
    reestablishStatusEffect() { const index = effects.findIndex(Boolean);assert.notEqual(index, -1);effects[index]?.cleanup?.();effects[index] = undefined;pendingEffects.delete(index);commit(); },
    get retiredWrites() { return retiredWrites; },
    async idle() { this.mount();calls[0].resolve(Response.json({ state: "idle" }));await turn();commit();
      assert.equal(calls.length, 1);assert.equal(this.button().disabled, false); },
    deadline() { const timer = timers.findLast(value => value.ms === 5_000 && !value.cleared);assert.ok(timer);timer.callback(); },
  };
}

test("pending status deadline stays visible and coalesced until actual read settlement", async t => {
  const ui = harness(t);ui.mount();ui.deadline();
  assert.match(ui.markup(), /status-response deadline elapsed.*original read is still finishing/);
  assert.equal(ui.button().disabled, true);ui.button().onClick();assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].signal.aborted, true);ui.calls[0].resolve(Response.json({ state: "idle" }));await turn();ui.commit();
  assert.match(ui.markup(), /local test status could not be read/);
  assert.doesNotMatch(ui.markup(), /still finishing|Reading the local test status/);
  assert.equal(ui.button().disabled, true);assert.deepEqual(ui.codes, []);ui.unmount();
});

test("start reply is unconfirmed until it arrives; deadline never reports accepted success or retries", async t => {
  const ui = harness(t);await ui.idle();const previous = ui.button();previous.onClick();previous.onClick();
  assert.equal(ui.calls.length, 2);assert.equal(ui.calls[1].method, "POST");
  assert.match(ui.markup(), /start request is awaiting confirmation/);assert.doesNotMatch(ui.markup(), /sample test is running/i);
  ui.deadline();assert.match(ui.markup(), /start-response deadline elapsed.*outcome is unconfirmed/);
  assert.equal(ui.button().disabled, true);previous.onClick();assert.equal(ui.calls.length, 2);
  ui.calls[1].resolve(Response.json({ state: "checked", result: inventedCustodianExecution() }));await turn();ui.commit();
  assert.doesNotMatch(ui.markup(), /Sample saving checked|still finishing/);
  assert.match(ui.markup(), /start response could not be confirmed/);assert.equal(ui.calls.length, 3);
  assert.equal(ui.calls[2].method, "GET");assert.equal(ui.calls.filter(call => call.method === "POST").length, 1);
  assert.deepEqual(ui.codes, []);ui.unmount();ui.calls[2].resolve(Response.json({ state: "idle" }));await turn();assert.equal(ui.retiredWrites, 0);
});

test("a status read owns the start guard, including a retained earlier button callback", async t => {
  const ui = harness(t);await ui.idle();const previous = ui.button();previous.onClick();
  ui.calls[1].resolve(Response.json({ state: "running" }));await turn();ui.commit();
  assert.equal(ui.calls.length, 2);assert.equal(ui.button().disabled, true);previous.onClick();assert.equal(ui.calls.length, 2);
  const poll = ui.timers.findLast(timer => timer.ms === 1_000 && !timer.cleared);assert.ok(poll);poll.callback();
  assert.equal(ui.calls.length, 3);assert.equal(ui.button().disabled, true);previous.onClick();assert.equal(ui.calls.length, 3);
  ui.calls[2].resolve(Response.json({ state: "running" }));await turn();ui.commit();
  const nextPoll = ui.timers.findLast(timer => timer.ms === 1_000 && !timer.cleared);assert.ok(nextPoll);nextPoll.callback();
  assert.equal(ui.calls.length, 4);previous.onClick();assert.equal(ui.calls.length, 4);
  ui.unmount();ui.calls[3].resolve(Response.json({ state: "checked", result: inventedCustodianExecution() }));await turn();
  assert.equal(ui.retiredWrites, 0);
});

test("unmounted status and start notices or late replies cannot update the retired view", async t => {
  const ui = harness(t);await ui.idle();ui.button().onClick();const deadline = ui.timers.findLast(timer => timer.ms === 5_000 && !timer.cleared);
  ui.unmount();deadline.callback();ui.calls[1].resolve(Response.json({ state: "running" }));await turn();
  assert.equal(ui.retiredWrites, 0);assert.deepEqual(ui.codes, []);assert.equal(ui.calls.filter(call => call.method === "POST").length, 1);
});

test("successful accepted results retain the exact checked result and terminal polling stops", async t => {
  const ui = harness(t);await ui.idle();ui.button().onClick();
  ui.calls[1].resolve(Response.json({ state: "checked", result: inventedCustodianExecution() }));await turn();ui.commit();
  assert.match(ui.markup(), /Sample saving checked/);assert.doesNotMatch(ui.markup(), /awaiting confirmation|still finishing|status is unconfirmed/);
  assert.equal(ui.button().disabled, true);assert.equal(ui.calls.length, 2);assert.deepEqual(ui.codes, []);ui.unmount();
});

test("the first idle observation does not immediately repeat the expensive status read", async t => {
  const ui = harness(t);ui.mount();ui.calls[0].resolve(Response.json({ state: "idle" }));await turn();ui.commit();
  assert.equal(ui.calls.length, 1);assert.equal(ui.button().disabled, false);ui.unmount();
});

test("a retained idle callback cannot resubmit after a terminal accepted result", async t => {
  const ui = harness(t);await ui.idle();const previous = ui.button();previous.onClick();
  ui.calls[1].resolve(Response.json({ state: "checked", result: inventedCustodianExecution() }));await turn();ui.commit();
  const calls = ui.calls.length;previous.onClick();assert.equal(ui.calls.length, calls);
  assert.match(ui.markup(), /Sample saving checked/);ui.unmount();
});

test("replacement observation waits for the retired physical status read to settle", async t => {
  const ui = harness(t);ui.mount();const old = ui.calls[0];ui.reestablishEffects();
  assert.equal(old.signal.aborted, true);assert.equal(ui.calls.length, 1);
  assert.equal(ui.button().disabled, true);
  old.resolve(Response.json({ state: "checked", result: inventedCustodianExecution() }));await turn();ui.commit();
  assert.equal(ui.calls.length, 2);assert.equal(ui.calls[1].method, "GET");
  assert.doesNotMatch(ui.markup(), /Sample saving checked/);assert.equal(ui.button().disabled, true);
  ui.calls[1].resolve(Response.json({ state: "idle" }));await turn();ui.commit();
  assert.equal(ui.button().disabled, false);assert.equal(ui.calls.length, 2);ui.unmount();
});

test("only the latest replacement observation resumes after an ignored abort", async t => {
  const ui = harness(t);ui.mount();const old = ui.calls[0];
  ui.reestablishEffects();ui.reestablishEffects();
  assert.equal(old.signal.aborted, true);assert.equal(ui.calls.length, 1);
  old.resolve(Response.json({ state: "idle" }));await turn();ui.commit();
  assert.equal(ui.calls.length, 2);assert.equal(ui.calls[1].method, "GET");
  ui.calls[1].resolve(Response.json({ state: "idle" }));await turn();ui.commit();
  assert.equal(ui.button().disabled, false);assert.equal(ui.calls.length, 2);ui.unmount();
});

test("a rejected retired read releases its physical slot before replacement inspection", async t => {
  const ui = harness(t);ui.mount();const old = ui.calls[0];ui.reestablishEffects();
  assert.equal(ui.calls.length, 1);old.reject(new Error("retired transport"));await turn();ui.commit();
  assert.equal(ui.calls.length, 2);assert.equal(ui.calls[1].method, "GET");
  assert.deepEqual(ui.codes, []);assert.equal(ui.button().disabled, true);
  ui.calls[1].resolve(Response.json({ state: "idle" }));await turn();ui.commit();
  assert.equal(ui.button().disabled, false);ui.unmount();
});

test("unmounting a waiting replacement does not revive its retired read", async t => {
  const ui = harness(t);ui.mount();const old = ui.calls[0];ui.reestablishEffects();
  assert.equal(ui.calls.length, 1);ui.unmount();
  old.resolve(Response.json({ state: "idle" }));await turn();
  assert.equal(ui.calls.length, 1);assert.equal(ui.retiredWrites, 0);assert.deepEqual(ui.codes, []);
});

test("a retained idle start callback is retired with the view", async t => {
  const ui = harness(t);await ui.idle();const previous = ui.button();ui.unmount();
  const writes = ui.retiredWrites;previous.onClick();
  assert.equal(ui.calls.length, 1);assert.equal(ui.retiredWrites, writes);
});

test("effect re-establishment after an aborted start requires a new authoritative status", async t => {
  const ui = harness(t);await ui.idle();const previous = ui.button();previous.onClick();
  ui.reestablishEffects();assert.equal(ui.calls.length, 2);ui.calls[1].resolve(Response.json({ state: "running" }));await turn();ui.commit();
  previous.onClick();assert.equal(ui.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(ui.calls.at(-1).method, "GET");assert.equal(ui.button().disabled, true);
  ui.calls.at(-1).resolve(Response.json({ state: "held", reason: "private_test_unavailable" }));await turn();ui.commit();
  assert.match(ui.markup(), /Test held/);assert.doesNotMatch(ui.markup(), /awaiting confirmation/);
  previous.onClick();assert.equal(ui.calls.filter(call => call.method === "POST").length, 1);ui.unmount();
});

test("retired POST settlement cannot clear the replacement status read deadline notice", async t => {
  const ui = harness(t);await ui.idle();ui.button().onClick();ui.reestablishEffects();
  assert.equal(ui.calls.length, 2);ui.deadline();
  ui.calls[1].resolve(Response.json({ state: "running" }));await turn();ui.commit();
  const replacement = ui.calls.at(-1);assert.equal(replacement.method, "GET");ui.deadline();
  assert.match(ui.markup(), /status-response deadline elapsed/);
  assert.match(ui.markup(), /status-response deadline elapsed.*original read is still finishing/);
  assert.equal(ui.button().disabled, true);assert.equal(ui.calls.length, 3);ui.unmount();
  replacement.resolve(Response.json({ state: "idle" }));await turn();assert.equal(ui.retiredWrites, 0);
});

test("a restarted status effect cannot overlap a pending start and publish stale idle", async t => {
  const ui = harness(t);await ui.idle();const start = ui.button();start.onClick();
  assert.deepEqual(ui.calls.map(call => call.method), ["GET", "POST"]);
  ui.reestablishStatusEffect();
  assert.equal(ui.calls.length, 2, "status GET must wait until the pending POST settles");
  assert.equal(ui.button().disabled, true);assert.match(ui.markup(), /previous start request is still finishing/);
  ui.calls[1].resolve(Response.json({ state: "running" }));await turn();ui.commit();
  assert.equal(ui.calls.length, 2, "confirmed running response must not trigger a redundant immediate GET");
  assert.doesNotMatch(ui.markup(), /previous start request is still finishing/);
  const poll = ui.timers.findLast(timer => timer.ms === 1_000 && !timer.cleared);assert.ok(poll);poll.callback();
  assert.deepEqual(ui.calls.map(call => call.method), ["GET", "POST", "GET"]);
  start.onClick();assert.equal(ui.calls.filter(call => call.method === "POST").length, 1);
  ui.calls[2].resolve(Response.json({ state: "checked", result: inventedCustodianExecution() }));await turn();ui.commit();
  assert.match(ui.markup(), /Sample saving checked/);assert.equal(ui.button().disabled, true);ui.unmount();
});

test("a direct checked start reply clears a restarted status effect's waiting display", async t => {
  const ui = harness(t);await ui.idle();ui.button().onClick();ui.reestablishStatusEffect();
  assert.equal(ui.calls.length, 2);assert.match(ui.markup(), /previous start request is still finishing/);
  ui.calls[1].resolve(Response.json({ state: "checked", result: inventedCustodianExecution() }));await turn();ui.commit();
  assert.equal(ui.calls.length, 2);assert.match(ui.markup(), /Sample saving checked/);
  assert.doesNotMatch(ui.markup(), /previous start request is still finishing|Reading the current status/);
  assert.match(ui.markup(), /aria-busy="false"/);assert.equal(ui.button().disabled, true);ui.unmount();
});

test("a rejected start does not repeat an authoritative held status read after effect replacement", async t => {
  const ui = harness(t);await ui.idle();ui.button().onClick();ui.reestablishStatusEffect();
  assert.equal(ui.calls.length, 2);ui.calls[1].reject(new Error("start transport unavailable"));await turn();
  assert.equal(ui.calls.length, 2, "a retired status effect must not start a GET before the rejected start changes phase");
  ui.commit();
  assert.deepEqual(ui.calls.map(call => call.method), ["GET", "POST", "GET"]);
  assert.equal(ui.calls[2].signal.aborted, false);
  ui.calls[2].resolve(Response.json({ state: "held", reason: "private_test_unavailable" }));await turn();ui.commit();
  assert.equal(ui.calls.length, 3, "the confirmed held reply must not be hidden behind another read");
  assert.match(ui.markup(), /Test held/);assert.match(ui.markup(), /aria-busy="false"/);
  assert.equal(ui.button().disabled, true);ui.unmount();
});

test("a freshly mounted custodian view waits for the previous view's physical GET and POST", async t => {
  const calls = [], timers = [];
  t.mock.method(globalThis, "fetch", (url, options) => new Promise((resolve, reject) => {
    assert.equal(url, "/api/dev/private-custodian");calls.push({ ...options, resolve, reject });
  }));
  t.mock.method(globalThis, "setTimeout", (callback, ms) => {
    assert.ok(ms === 5_000 || ms === 1_000);const timer = { callback, ms };timers.push(timer);return timer;
  });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const request = load(new URL("../src/private-custodian-request.ts", import.meta.url), {
    "./local-request-deadline.ts": { withLocalRequestDeadline },
    "./private-custodian-operation.ts": { parsePrivateCustodianOperationStatus },
    "./client-error-diagnostics.ts": { observeClientError: () => {} },
  }).requestPrivateCustodianStatus;
  let active;
  const hooks = Object.fromEntries(["useState", "useRef", "useLayoutEffect", "useEffect"].map(name => [name, (...args) => active[name](...args)]));
  const component = load(new URL("../src/private-custodian-operation-view.tsx", import.meta.url), {
    react: hooks, "./private-custodian-request": { requestPrivateCustodianStatus: request },
  }).PrivateCustodianOperationView;
  function instance() {
    const cells = [], layouts = [], effects = [];let cursor = 0, mounted = true, retiredWrites = 0;
    const context = {
      useState(initial) { const i = cursor++;if (!(i in cells)) cells[i] = initial;
        return [cells[i], value => { if (!mounted) retiredWrites++;cells[i] = value; }]; },
      useRef(initial) { const i = cursor++;if (!(i in cells)) cells[i] = { current: initial };return cells[i]; },
      useLayoutEffect(fn) { layouts[cursor++] = fn; },useEffect(fn) { effects[cursor++] = fn; },
    };
    const render = () => { active = context;cursor = 0;return component(); };
    const cleanups = [];
    return { markup: () => renderToStaticMarkup(render()),button: () => nodes(render()).find(node => node.type === "button").props,
      mount() { render();for (const fn of layouts) if (fn) cleanups.push(fn());for (const fn of effects) if (fn) cleanups.push(fn()); },
      unmount() { mounted = false;for (const cleanup of cleanups) cleanup?.(); },
      get retiredWrites() { return retiredWrites; } };
  }
  const first = instance();first.mount();assert.equal(calls.length, 1);
  first.unmount();const second = instance();second.mount();
  assert.equal(calls[0].signal.aborted, true);assert.equal(calls.length, 1);
  second.unmount();const third = instance();third.mount();assert.equal(calls.length, 1);
  assert.match(third.markup(), /previous status read is still finishing/);
  calls[0].resolve(Response.json({ state: "idle" }));await turn();await turn();
  assert.equal(calls.length, 2);assert.equal(calls[1].method, "GET");
  assert.doesNotMatch(third.markup(), /previous status read is still finishing/);
  assert.equal(first.retiredWrites, 0);assert.equal(second.retiredWrites, 0);
  third.unmount();calls[1].resolve(Response.json({ state: "idle" }));await turn();
  assert.equal(third.retiredWrites, 0);
  const fourth = instance();fourth.mount();assert.equal(calls.length, 3);
  calls[2].resolve(Response.json({ state: "idle" }));await turn();assert.equal(fourth.button().disabled, false);
  fourth.button().onClick();assert.equal(calls.length, 4);assert.equal(calls[3].method, "POST");
  fourth.unmount();const fifth = instance();fifth.mount();assert.equal(calls[3].signal.aborted, true);
  assert.equal(fifth.button().disabled, true);fifth.button().onClick();
  assert.equal(calls.length, 4,"A new mount must wait for the prior client POST before its authoritative status GET");
  calls[3].resolve(Response.json({ state: "running" }));await turn();await turn();
  assert.equal(calls.length, 5);assert.equal(calls[4].method, "GET");
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
  calls[4].resolve(Response.json({ state: "checked", result: inventedCustodianExecution() }));await turn();
  assert.match(fifth.markup(), /Sample saving checked/);fifth.unmount();
  assert.equal(fourth.retiredWrites, 0);assert.equal(fifth.retiredWrites, 0);
});
