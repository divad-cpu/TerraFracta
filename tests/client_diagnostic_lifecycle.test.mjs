import assert from "node:assert/strict";
import test from "node:test";
import { createClientErrorReporter, installClientErrorListeners } from "../src/client-error-diagnostics.ts";

// Finite in-process native/controller/timer and supplied event-target seams.
// No default reporter, browser, HTTP or actual diagnostic archive is used.
const id = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function timers(t, failClear = false) {
  const retained = [], cleared = [];
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => {
    assert.equal(milliseconds, 1500); retained.push(callback); return retained.length;
  });
  t.mock.method(globalThis, "clearTimeout", token => { cleared.push(token); if (failClear) throw Error("PRIVATE_TIMER_RETIREMENT"); });
  return { retained, cleared };
}

test("failed reporter controller setup retires only its unused slot and allows the next report", async t => {
  let sends = 0, ids = 0;
  const report = createClientErrorReporter("development", async () => { sends++; return new Response(null, { status: 204 }); }, () => id(++ids), () => 0);
  t.mock.method(globalThis, "AbortController", function () { throw Error("PRIVATE_CONTROLLER_SETUP"); });
  assert.equal(await report("browser_runtime"), null); assert.equal(sends, 0); assert.equal(ids, 0);
  t.mock.restoreAll();
  assert.equal(await report("browser_runtime"), id(1)); assert.equal(sends, 1); assert.equal(ids, 1);
});

test("refused timer retirement cannot replace a saved acknowledgement or run its retired deadline", async t => {
  const c = timers(t, true), signals = [], intents = [];
  const report = createClientErrorReporter("development", async (_url, options) => {
    signals.push(options.signal); intents.push(JSON.parse(options.body)); return new Response(null, { status: 204 });
  }, () => id(intents.length + 1), () => 0);
  assert.equal(await report("browser_runtime"), id(1));
  assert.doesNotThrow(c.retained[0]); assert.equal(signals[0].aborted, false);
  assert.equal(await report("browser_runtime"), id(2));
  assert.deepEqual(c.cleared, [1, 2]); assert.deepEqual(intents, [{ eventId: id(1), code: "browser_runtime" }, { eventId: id(2), code: "browser_runtime" }]);
});

test("refused deadline abort still settles refusal and retains the pending physical send", async t => {
  const c = timers(t, true); let sends = 0, ids = 0, resolve, immediate = false;
  const NativeController = AbortController;
  t.mock.method(globalThis, "AbortController", function () {
    const controller = new NativeController();
    controller.abort = () => { throw Error("PRIVATE_ABORT_RETIREMENT"); };
    return controller;
  });
  const report = createClientErrorReporter("development", () => {
    sends++; return immediate ? Promise.resolve(new Response(null, { status: 204 })) : new Promise(done => { resolve = done; });
  }, () => id(++ids), () => 0);
  const first = report("browser_runtime"); await tick();
  assert.doesNotThrow(c.retained[0]); assert.equal(await first, null);
  assert.equal(await report("browser_runtime"), null); assert.equal(sends, 1); assert.equal(ids, 1);
  resolve(new Response(null, { status: 204 })); await tick(); immediate = true;
  assert.equal(await report("browser_runtime"), id(2)); assert.equal(sends, 2); assert.equal(ids, 2);
  assert.doesNotThrow(c.retained[0]);
});

test("failed and non-204 reports retain null despite timer retirement refusal and recover", async t => {
  timers(t, true); let ids = 0, succeed = false;
  const report = createClientErrorReporter("development", async () => {
    if (!succeed) throw Error("PRIVATE_SEND_FAILURE"); return new Response(null, { status: 204 });
  }, () => id(++ids), () => 0);
  assert.equal(await report("page_render"), null); succeed = true; assert.equal(await report("page_render"), id(2));
  assert.equal(await createClientErrorReporter("development", async () => new Response(null, { status: 503 }), () => id(3), () => 0)("page_render"), null);
});

test("production and server-code refusals precede controller, timer, entropy and send", async t => {
  t.mock.method(globalThis, "AbortController", function () { assert.fail("Refused reporter constructed controller"); });
  t.mock.method(globalThis, "setTimeout", () => { assert.fail("Refused reporter armed timer"); });
  const send = () => assert.fail("Refused reporter sent"), uuid = () => assert.fail("Refused reporter requested entropy");
  for (const mode of ["production", "test", undefined]) assert.equal(await createClientErrorReporter(mode, send, uuid)("browser_runtime"), null);
  assert.equal(await createClientErrorReporter("development", send, uuid)("server_route"), null);
});

for (const failure of ["error", "unhandledrejection"]) test(`failed ${failure} registration retires all partial listeners and retained callbacks`, async () => {
  const kept = new Map(), removed = [], reports = [], marker = Error("PRIVATE_REGISTRATION");
  const target = {
    addEventListener(name, fn) { kept.set(name, fn); if (name === failure) throw marker; },
    removeEventListener(name) { removed.push(name); if (name === "error") throw Error("PRIVATE_REMOVAL"); },
  };
  assert.throws(() => installClientErrorListeners(target, async code => { reports.push(code); }), error => error === marker);
  assert.deepEqual(removed, failure === "error" ? ["error"] : ["error", "unhandledrejection"]);
  const poison = new Proxy({}, { get() { assert.fail("Private event field read"); } });
  for (const fn of kept.values()) assert.doesNotThrow(() => fn(poison)); await tick(); assert.deepEqual(reports, []);
});

test("listener retirement attempts both removals and makes retained and queued callbacks inactive", async () => {
  const kept = new Map(), removed = [], reports = [];
  const target = {
    addEventListener(name, fn) { kept.set(name, fn); },
    removeEventListener(name) { removed.push(name); if (name === "error") throw Error("PRIVATE_REMOVAL"); },
  };
  const stop = installClientErrorListeners(target, async code => { reports.push(code); });
  kept.get("error")(); assert.doesNotThrow(stop);
  kept.get("error")(); kept.get("unhandledrejection")(); await tick();
  assert.deepEqual(removed, ["error", "unhandledrejection"]); assert.deepEqual(reports, []);
  assert.doesNotThrow(stop); assert.deepEqual(removed, ["error", "unhandledrejection"]);
});

test("current global listeners still report only closed identities and consume logger failures", async () => {
  const kept = new Map(), reports = [], removed = [];
  const target = { addEventListener: (name, fn) => kept.set(name, fn), removeEventListener: (name, fn, capture) => removed.push([name, fn, capture]) };
  const stop = installClientErrorListeners(target, async (...args) => { reports.push(args); throw Error("PRIVATE_REPORTER"); });
  const poison = new Proxy({}, { get() { assert.fail("Private event field read"); } });
  kept.get("error")(poison); kept.get("unhandledrejection")(poison); await tick();
  assert.deepEqual(reports, [["browser_runtime"], ["browser_promise"]]); stop();
  assert.equal(removed.length, 2); assert.equal(removed[0][1], kept.get("error")); assert.equal(removed[0][2], true);
  assert.equal(removed[1][1], kept.get("unhandledrejection"));
});
