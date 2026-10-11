import assert from "node:assert/strict";
import test from "node:test";
import { createDevelopmentErrorRecorder } from "../src/server/error-diagnostics.ts";
import { createClientErrorReporter } from "../src/client-error-diagnostics.ts";

const id = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const tick = () => new Promise(resolve => setImmediate(resolve));

test("reporters contain an initial clock failure before any save, send or entropy and permit later valid reporting", async () => {
  let failed = true, saves = 0, sends = 0, ids = 0;
  const now = () => { if (failed) throw new Error("PRIVATE_CLOCK_SETUP"); return 0; };
  const record = createDevelopmentErrorRecorder(async () => { saves++; return "saved"; }, () => "development", now);
  const report = createClientErrorReporter("development", async () => { sends++; return new Response(null, { status: 204 }); }, () => id(++ids), now);
  assert.equal(await record("server_route", id(1)), "unavailable"); assert.equal(await report("browser_runtime"), null);
  assert.equal(saves, 0); assert.equal(sends, 0); assert.equal(ids, 0);
  failed = false; assert.equal(await record("server_route", id(1)), "saved"); assert.equal(await report("browser_runtime"), id(1));
  assert.equal(saves, 1); assert.equal(sends, 1); assert.equal(ids, 1);
});

test("server logging refuses failed deadline setup before saving and releases its unused slot", async t => {
  let saves = 0;
  const record = createDevelopmentErrorRecorder(async () => { saves++; return "saved"; }, () => "development", () => 0);
  t.mock.method(globalThis, "setTimeout", () => { throw new Error("PRIVATE_TIMER_SETUP"); });
  assert.equal(await record("server_route", id(1)), "unavailable"); assert.equal(saves, 0);
  t.mock.restoreAll(); assert.equal(await record("server_route", id(1)), "saved"); assert.equal(saves, 1);
});

test("browser logging refuses failed deadline setup before entropy or sending and permits later reporting", async t => {
  let sends = 0, ids = 0;
  const report = createClientErrorReporter("development", async () => { sends++; return new Response(null, { status: 204 }); }, () => id(++ids), () => 0);
  t.mock.method(globalThis, "setTimeout", () => { throw new Error("PRIVATE_TIMER_SETUP"); });
  assert.equal(await report("browser_runtime"), null); assert.equal(sends, 0); assert.equal(ids, 0);
  t.mock.restoreAll(); assert.equal(await report("browser_runtime"), id(1)); assert.equal(sends, 1); assert.equal(ids, 1);
});

test("a started save retains its slot after the caller deadline until actual settlement", async t => {
  let expire, resolve, saves = 0, immediate = false;
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => { assert.equal(milliseconds, 1000); expire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const record = createDevelopmentErrorRecorder(() => { saves++; return immediate ? Promise.resolve("saved") : new Promise(done => { resolve = done; }); }, () => "development", () => 0);
  const first = record("server_route", id(1)); await tick(); expire(); assert.equal(await first, "unavailable");
  assert.equal(await record("server_route", id(2)), "busy"); assert.equal(saves, 1);
  resolve("saved"); await tick(); immediate = true;
  assert.equal(await record("server_route", id(2)), "saved"); assert.equal(saves, 2);
});

test("a started send retains its slot after deadline and rejects its late acknowledgement", async t => {
  let expire, resolve, sends = 0, ids = 0, immediate = false, signal;
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => { assert.equal(milliseconds, 1500); expire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const report = createClientErrorReporter("development", (_url, options) => {
    sends++; signal = options.signal;
    const body = JSON.parse(options.body); assert.deepEqual(Object.keys(body).sort(), ["code", "eventId"]);
    return immediate ? Promise.resolve(new Response(null, { status: 204 })) : new Promise(done => { resolve = done; });
  }, () => id(++ids), () => 0);
  const first = report("browser_runtime"); await tick(); expire(); assert.equal(await first, null); assert.equal(signal.aborted, true);
  assert.equal(await report("browser_runtime"), null); assert.equal(sends, 1); assert.equal(ids, 1);
  resolve(new Response(null, { status: 204 })); await tick(); immediate = true;
  assert.equal(await report("browser_runtime"), id(2)); assert.equal(sends, 2); assert.equal(ids, 2);
});
