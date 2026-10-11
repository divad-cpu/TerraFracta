import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { startCurrentIssueWatch } from "../src/current-issue-watch.ts";
import { startConnectedReaderWatch } from "../src/connected-reader-watch.ts";
import { currentIssueIdentity } from "../src/current-issue-status.ts";
import { connectedStatusIdentity } from "../src/connected-reader-status.ts";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
const snapshot = { ...connectedInput(), generation: 1 };
const cases = [
  { start: startCurrentIssueWatch, identity: currentIssueIdentity(snapshot.issue), component: "CurrentIssueEdition", file: "../app/reader-preview/CurrentIssueEdition.tsx", watch: "current-issue-watch.ts" },
  { start: startConnectedReaderWatch, identity: connectedStatusIdentity(snapshot), component: "CurrentConnectedEdition", file: "../app/connected-preview/CurrentConnectedEdition.tsx", watch: "connected-reader-watch.ts" },
];
function controls(failure) {
  const intervals = new Map(), timeouts = new Map(); let id = 0, visible = true, faults = true;
  return { intervals, timeouts, show: value => { visible = value; }, repair: () => { faults = false; },
    visible: () => visible, now: () => { if (faults && failure === "clock") throw Error("PRIVATE_INITIAL_CLOCK"); return 0; },
    interval(callback, delay) { assert.equal(delay, 15_000); intervals.set(++id, callback); return id; },
    clearInterval(token) { intervals.delete(token); },
    timeout(callback, delay) { assert.equal(delay, 3_000); if (faults && failure === "timeout") throw Error("PRIVATE_DEADLINE_FACTORY"); timeouts.set(++id, callback); return id; },
    clearTimeout(token) { timeouts.delete(token); }, };
}

for (const failure of ["clock", "timeout"]) for (const item of cases) test(`initial ${failure} failure terminally withholds ${item.start.name} before any read`, async () => {
    const c = controls(failure), updates = []; let reads = 0;
    const watch = item.start(item.identity, value => updates.push(value), async () => { reads++; assert.fail("setup-failed watch dispatched a read"); }, c);
    await flush();
    assert.deepEqual(updates, [{ kind: "unavailable" }]); assert.equal(reads, 0);
    assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
    c.repair(); await watch.check(); await flush();
    assert.equal(reads, 0); assert.equal(updates.length, 1, "held watch needs explicit fresh navigation, not a retry");
});

test("hidden checks remain deferred, then clock/setup faults enter the same terminal boundary", async () => {
  for (const failure of ["clock", "timeout"]) for (const item of cases) {
    const c = controls(failure), updates = []; let reads = 0; c.show(false);
    const watch = item.start(item.identity, value => updates.push(value), async () => { reads++; assert.fail("setup-failed read"); }, c);
    await flush(); assert.deepEqual(updates, []); assert.equal(c.intervals.size, 1);
    c.show(true); await watch.check();
    assert.deepEqual(updates, [{ kind: "unavailable" }]); assert.equal(reads, 0);
    assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
  }
});

test("actual current and connected JSX wrappers remove the whole checked subtree after setup faults", async () => {
  const originalDocument = globalThis.document;
  try {
    for (const failure of ["clock", "timeout"]) for (const item of cases) {
      const c = controls(failure), listeners = new Map(); let status = { kind: "current" }, effect, reads = 0;
      globalThis.document = { visibilityState: "visible", addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: (name, callback) => { assert.equal(listeners.get(name), callback); listeners.delete(name); } };
      const Component = loadTsx(new URL(item.file, import.meta.url), name => name === "react"
        ? { useState: () => [status, next => { status = next; }], useEffect: callback => { effect = callback; } }
        : name.replace(/\.ts$/, "").endsWith(item.watch.replace(/\.ts$/, "")) ? { [item.start.name]: (expected, changed) => item.start(expected, changed, async () => { reads++; assert.fail("setup-failed JSX read"); }, c) }
        : undefined)[item.component];
      const props = { expected: item.identity, latestHref: "/reader-preview/catalogue",
        children: createElement("div", null, "OLD_DOSSIER_CANARY", createElement("a", { href: "#sources" }, "OLD_SOURCE_CANARY"),
          createElement("input", { defaultValue: "OLD_SEARCH_CANARY" }), createElement("textarea", { defaultValue: "UNSENT_DRAFT_CANARY" })) };
      assert.match(renderToStaticMarkup(Component(props)), /OLD_DOSSIER_CANARY/);
      const cleanup = effect(); await flush();
      const html = renderToStaticMarkup(Component(props));
      assert.equal(status.kind, "unavailable"); assert.equal(reads, 0);
      assert.doesNotMatch(html, /OLD_DOSSIER_CANARY|OLD_SOURCE_CANARY|OLD_SEARCH_CANARY|UNSENT_DRAFT_CANARY|PRIVATE_|<input|<textarea/);
      assert.match(html, /withheld/);
      assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
      cleanup(); assert.equal(listeners.size, 0);
    }
  } finally { globalThis.document = originalDocument; }
});

for (const failure of ["interval", "visibility", "interval-clear", "timeout-clear"]) for (const item of cases) test(`${failure} refusal cannot keep an earlier ${item.start.name} subtree current`, async () => {
  const c = controls("none"), updates = []; let reads = 0, signal;
  if (failure === "interval") c.interval = () => { throw Error("PRIVATE_INTERVAL_FACTORY"); };
  if (failure === "visibility") c.visible = () => { throw Error("PRIVATE_VISIBILITY_OBSERVATION"); };
  if (failure === "interval-clear") { const clear = c.clearInterval; c.clearInterval = token => { clear(token); throw Error("PRIVATE_INTERVAL_RETIREMENT"); }; }
  if (failure === "timeout-clear") { const clear = c.clearTimeout; c.clearTimeout = token => { clear(token); throw Error("PRIVATE_TIMEOUT_RETIREMENT"); }; }
  const watch = item.start(item.identity, value => updates.push(value), async (...args) => {
    reads++; signal = args.at(-1); throw Error("PRIVATE_READ_CANARY");
  }, c);
  await flush();
  assert.deepEqual(updates, [{ kind: "unavailable" }]);
  assert.equal(reads, ["interval", "visibility"].includes(failure) ? 0 : 1);
  if (signal) assert.equal(signal.aborted, true);
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
  await watch.check(); watch.stop(); assert.equal(updates.length, 1);
});

test("terminal changed verdict survives both cleanup refusals and denies retained timer callbacks", async () => {
  for (const item of cases) {
    const c = controls("none"), updates = [], retained = []; let reads = 0, signal;
    const interval = c.interval;
    c.interval = callback => { retained.push(callback); return interval(callback, 15_000); };
    c.clearInterval = () => { throw Error("PRIVATE_INTERVAL_CLEAR"); };
    c.clearTimeout = () => { throw Error("PRIVATE_TIMEOUT_CLEAR"); };
    const watch = item.start(item.identity, value => updates.push(value), async (...args) => {
      signal = args.at(-1); reads++; return item === cases[0] ? { schemaVersion: 1, kind: "current", ...item.identity, revision: item.identity.revision + 1, publicationId: "11111111-1111-4111-8111-111111111111" } : { schemaVersion: 1, kind: "changed", currentGeneration: 2 };
    }, c);
    await flush();
    assert.deepEqual(updates, [item === cases[0] ? { kind: "changed" } : { kind: "changed", currentGeneration: 2 }]); assert.equal(signal.aborted, true);
    for (const callback of [...retained, ...c.timeouts.values()]) callback();
    await watch.check(); watch.stop(); await flush(); assert.equal(reads, 1); assert.equal(updates.length, 1);
  }
});

test("actual wrappers retire partial visibility setup, hold the subtree and deny retired events", async () => {
  const originalDocument = globalThis.document;
  try {
    for (const item of cases) {
      const c = controls("none"), listeners = new Map(); let status = { kind: "current" }, effect, reads = 0, signal, late;
      globalThis.document = { visibilityState: "visible", addEventListener(name, callback) { listeners.set(name, callback); throw Error("PRIVATE_VISIBILITY_SETUP"); },
        removeEventListener(name) { listeners.delete(name); throw Error("PRIVATE_VISIBILITY_REMOVE"); } };
      const Component = loadTsx(new URL(item.file, import.meta.url), name => name === "react"
        ? { useState: () => [status, next => { status = next; }], useEffect: callback => { effect = callback; } }
        : name.replace(/\.ts$/, "").endsWith(item.watch.replace(/\.ts$/, "")) ? { [item.start.name]: (expected, changed) => item.start(expected, changed, (...args) => {
          signal = args.at(-1); reads++; return new Promise(resolve => { late = resolve; });
        }, c) } : undefined)[item.component];
      const props = { expected: item.identity, latestHref: "/reader-preview/catalogue", children: createElement("textarea", { defaultValue: "UNSENT_DOSSIER_CANARY" }) };
      Component(props); const cleanup = effect(); await flush();
      assert.equal(status.kind, "unavailable"); assert.equal(signal.aborted, true);
      assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0); assert.equal(listeners.size, 0);
      assert.doesNotMatch(renderToStaticMarkup(Component(props)), /UNSENT_DOSSIER_CANARY|<textarea|PRIVATE_/);
      late(item === cases[0] ? { kind: "current" } : snapshot); await flush(); cleanup();
      assert.equal(reads, 1); assert.equal(status.kind, "unavailable");
    }
  } finally { globalThis.document = originalDocument; }
});

for (const item of cases) test(`controller startup refusal terminally withholds ${item.start.name} without a read or rejected initial check`, async t => {
  const c = controls("none"), updates = []; let reads = 0;
  t.mock.method(globalThis, "AbortController", function () { throw Error("PRIVATE_CONTROLLER_STARTUP"); });
  try {
    const watch = item.start(item.identity, value => updates.push(value), async () => { reads++; assert.fail("Failed controller dispatched verification"); }, c);
    await flush(); assert.deepEqual(updates, [{ kind: "unavailable" }]); assert.equal(reads, 0);
    assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
    t.mock.restoreAll(); await watch.check(); watch.stop(); assert.equal(reads, 0); assert.equal(updates.length, 1);
  } finally { t.mock.restoreAll(); }
});
