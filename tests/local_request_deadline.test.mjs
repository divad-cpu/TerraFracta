import assert from "node:assert/strict";
import test from "node:test";
import { withLocalRequestDeadline } from "../src/local-request-deadline.ts";

test("shared local request rejects delayed event-loop acknowledgement at, beyond or before its monotonic start", async () => {
  for (const finish of [8_000, 8_001, -1, NaN, Infinity]) {
    let time = 0;
    await assert.rejects(withLocalRequestDeadline(new AbortController().signal, 8_000, async () => { time = finish; return "late result"; }, () => time));
  }
});
test("shared local request retains timely outcome, single owned signal and original failure identity", async () => {
  const parent = new AbortController(); let calls = 0, time = 0, owned;
  const value = { state: "held" };
  assert.equal(await withLocalRequestDeadline(parent.signal, 8_000, async signal => { calls++; owned = signal; time = 7_999; return value; }, () => time), value);
  assert.equal(calls, 1); assert.notEqual(owned, parent.signal);
  const failure = new Error("PRIVATE_CANARY"); await assert.rejects(withLocalRequestDeadline(parent.signal, 8_000, async () => { throw failure; }), error => error === failure);
});
test("shared local request rejects invalid ceilings and initial clocks before calling its transport", async () => {
  for (const ceiling of [0, -1, NaN, Infinity, 1.5, 2_147_483_648]) {
    let calls = 0;
    await assert.rejects(withLocalRequestDeadline(new AbortController().signal, ceiling, async () => { calls++; return "unexpected"; }));
    assert.equal(calls, 0);
  }
  let calls = 0;
  await assert.rejects(withLocalRequestDeadline(new AbortController().signal, 8000, async () => { calls++; return "unexpected"; }, () => NaN));
  assert.equal(calls, 0);
});
test("shared local request signals abort without releasing a transport that ignores cancellation", async () => {
  const parent = new AbortController(); let settle, owned, finished = false;
  const read = withLocalRequestDeadline(parent.signal, 8000, signal => { owned = signal; return new Promise(resolve => { settle = resolve; }); });
  void read.catch(() => { finished = true; }); parent.abort(); await Promise.resolve();
  assert.equal(owned.aborted, true); assert.equal(finished, false);
  settle("unconfirmed result"); await assert.rejects(read); assert.equal(parent.signal.aborted, true);
});
test("deadline observer explains a pending request without releasing ownership or accepting its late outcome", async t => {
  let fire, resolve, notices = 0, finished = false, owned;
  t.mock.method(globalThis, "setTimeout", callback => { fire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const parent = new AbortController();
  const read = withLocalRequestDeadline(parent.signal, 5000, signal => { owned = signal; return new Promise(done => { resolve = done; }); }, () => 0, () => { notices++; });
  void read.catch(() => { finished = true; }); fire(); await Promise.resolve();
  assert.equal(notices, 1); assert.equal(owned.aborted, true); assert.equal(parent.signal.aborted, false); assert.equal(finished, false);
  resolve("late private outcome"); await assert.rejects(read); assert.equal(finished, true);
});
test("deadline observer failure cannot change the outcome and caller cancellation produces no deadline notice", async t => {
  let fire, resolve, notices = 0;
  t.mock.method(globalThis, "setTimeout", callback => { fire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const read = withLocalRequestDeadline(new AbortController().signal, 5000, () => new Promise(done => { resolve = done; }), () => 0,
    () => { throw new Error("PRIVATE_NOTICE_CANARY"); });
  assert.doesNotThrow(() => fire()); resolve("late"); await assert.rejects(read);
  const parent = new AbortController();
  const cancelled = withLocalRequestDeadline(parent.signal, 5000, () => new Promise(done => { resolve = done; }), () => 0, () => { notices++; });
  parent.abort(); fire(); resolve("cancelled"); await assert.rejects(cancelled); assert.equal(notices, 0);
});

test("deadline setup failure cleans its installed parent subscription before any transport", async t => {
  const parent = new AbortController(), failure = new Error("PRIVATE_TIMER_SETUP");
  let added = 0, removed = 0, calls = 0;
  const add = parent.signal.addEventListener.bind(parent.signal), remove = parent.signal.removeEventListener.bind(parent.signal);
  t.mock.method(parent.signal, "addEventListener", (...args) => { added++; return add(...args); });
  t.mock.method(parent.signal, "removeEventListener", (...args) => { removed++; return remove(...args); });
  t.mock.method(globalThis, "setTimeout", () => { throw failure; });
  await assert.rejects(withLocalRequestDeadline(parent.signal, 8000, async () => { calls++; }, () => 0), error => error === failure);
  assert.equal(calls, 0); assert.equal(added, 1); assert.equal(removed, 1);
  assert.equal(parent.signal.aborted, false);
});

test("failed subscription setup retires a partially installed listener without starting work", async t => {
  const parent = new AbortController(), failure = new Error("PRIVATE_SUBSCRIPTION_SETUP");
  let removed = 0, calls = 0, timers = 0;
  const add = parent.signal.addEventListener.bind(parent.signal), remove = parent.signal.removeEventListener.bind(parent.signal);
  t.mock.method(parent.signal, "addEventListener", (...args) => { add(...args); throw failure; });
  t.mock.method(parent.signal, "removeEventListener", (...args) => { removed++; return remove(...args); });
  t.mock.method(globalThis, "setTimeout", () => { timers++; return 1; });
  await assert.rejects(withLocalRequestDeadline(parent.signal, 8000, async () => { calls++; }, () => 0), error => error === failure);
  assert.equal(calls, 0); assert.equal(timers, 0); assert.equal(removed, 1);
});

for (const outcome of ["confirmed", "rejected"]) test(`independent deadline/listener retirement preserves the ${outcome} transport outcome`, async t => {
  const parent = new AbortController(), nativeRemove = parent.signal.removeEventListener.bind(parent.signal);
  let owned, removed = 0, fire, notices = 0;
  const result = { state: "verified" }, failure = new Error("PRIMARY_TRANSPORT_CANARY");
  t.mock.method(globalThis, "setTimeout", callback => { fire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => { throw Error("PRIVATE_TIMER_RETIREMENT"); });
  t.mock.method(parent.signal, "removeEventListener", (...args) => { removed++; nativeRemove(...args); throw Error("PRIVATE_LISTENER_RETIREMENT"); });
  const work = withLocalRequestDeadline(parent.signal, 5000, async signal => {
    owned = signal; if (outcome === "rejected") throw failure; return result;
  }, () => 0, () => { notices++; });
  if (outcome === "confirmed") assert.equal(await work, result);
  else await assert.rejects(work, error => error === failure);
  assert.equal(removed, 1); assert.equal(owned.aborted, true); assert.equal(parent.signal.aborted, false);
  assert.doesNotThrow(() => fire()); assert.equal(notices, 0, "Retired deadline cannot emit a late notice");
});

test("a deadline callback retained after ordinary settlement cannot later publish a notice", async t => {
  let fire, notices = 0;
  t.mock.method(globalThis, "setTimeout", callback => { fire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  assert.equal(await withLocalRequestDeadline(new AbortController().signal, 5000, async () => "confirmed", () => 0, () => { notices++; }), "confirmed");
  fire(); assert.equal(notices, 0);
});
