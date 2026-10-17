import assert from "node:assert/strict";
import test from "node:test";
import { createClientErrorReporter } from "../src/client-error-diagnostics.ts";
const id = n => `fc000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const flush = () => new Promise(setImmediate);
function timers(t) {
  const callbacks = [], cleared = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { assert.equal(delay, 1500); callbacks.push(callback); return callbacks.length; });
  t.mock.method(globalThis, "clearTimeout", token => cleared.push(token));
  return { callbacks, cleared };
}
for (const clock of ["valid", "throw", "nonfinite"]) test(`initial ${clock} clock cannot admit a nested diagnostic send`, async t => {
  const c = timers(t), resolves = []; let report, entered = false, nested, sends = 0, ids = 0;
  report = createClientErrorReporter("development", () => { sends++; return new Promise(resolve => resolves.push(resolve)); }, () => id(++ids), () => {
    if (!entered) {
      entered = true; nested = report("browser_runtime");
      if (clock === "throw") throw Error("PRIVATE_DIAGNOSTIC_CLOCK");
      if (clock === "nonfinite") return NaN;
    }
    return 0;
  });
  const outer = report("browser_runtime"); await flush();
  const observed = { sends, ids, timers: c.callbacks.length };
  for (const resolve of resolves) resolve(new Response(null, { status: 204 }));
  const [result, nestedResult] = await Promise.all([outer, nested]);
  assert.deepEqual(observed, clock === "valid" ? { sends: 1, ids: 1, timers: 1 } : { sends: 0, ids: 0, timers: 0 });
  assert.equal(nestedResult, null); assert.equal(result, clock === "valid" ? id(1) : null);
});
for (const refusesAbort of [false, true]) test(`deadline during identity allocation with abort refusal ${refusesAbort} cannot dispatch`, async t => {
  const c = timers(t); let sends = 0, ids = 0;
  if (refusesAbort) {
    const NativeController = AbortController;
    t.mock.method(globalThis, "AbortController", function () {
      const controller = new NativeController(); controller.abort = () => { throw Error("PRIVATE_DIAGNOSTIC_ABORT"); }; return controller;
    });
  }
  const report = createClientErrorReporter("development", async () => { sends++; return new Response(null, { status: 204 }); },
    () => { ids++; c.callbacks[0](); return id(ids); }, () => 0);
  assert.equal(await report("browser_runtime"), null); assert.equal(sends, 0); assert.equal(ids, 1);
  assert.deepEqual(c.cleared, [1]);
});
test("clock reentry cannot consume extra quota or replace ten acknowledged fixed intents", async t => {
  timers(t); let report, entered = false, sends = 0, ids = 0; const nested = [];
  report = createClientErrorReporter("development", async () => { sends++; return new Response(null, { status: 204 }); }, () => id(++ids), () => {
    if (!entered) { entered = true; nested.push(report("browser_runtime")); }
    return 0;
  });
  const results = [];
  for (let n = 0; n < 10; n++) { entered = false; results.push(await report("browser_runtime")); }
  assert.deepEqual(results, Array.from({ length: 10 }, (_, n) => id(n + 1)));
  assert.deepEqual(await Promise.all(nested), Array(10).fill(null));
  assert.equal(await report("browser_runtime"), null); assert.equal(sends, 10); assert.equal(ids, 10);
});
test("deadline and a later quota window cannot release the original pending physical send", async t => {
  const c = timers(t), resolves = []; let report, nested, entered = false, time = 0, sends = 0, ids = 0;
  report = createClientErrorReporter("development", () => { sends++; return new Promise(r => { resolves.push(r); }); }, () => id(++ids), () => {
    if (!entered) { entered = true; nested = report("browser_runtime"); }
    return time;
  });
  const pending = report("browser_runtime"); await flush(); for (const expire of c.callbacks) expire();
  const result = await pending, nestedResult = await nested; time = 60_000;
  const later = await report("browser_runtime"), observed = { sends, ids };
  for (const resolve of resolves) resolve(new Response(null, { status: 204 })); await flush();
  assert.equal(result, null); assert.equal(nestedResult, null); assert.equal(later, null);
  assert.deepEqual(observed, { sends: 1, ids: 1 }); assert.equal(sends, 1); assert.equal(ids, 1);
});
