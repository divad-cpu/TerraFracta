import assert from "node:assert/strict";
import test from "node:test";
import { startReaderWatch } from "../src/reader-watch.ts";
const flush = () => new Promise(setImmediate);
function timers() {
  let next = 0;
  const intervals = new Map(), timeouts = new Map();
  return { intervals, timeouts, now: () => 0,
    interval(fn, delay) { assert.equal(delay, 15_000); intervals.set(++next, fn); return next; },
    clearInterval(token) { intervals.delete(token); },
    timeout(fn, delay) { assert.equal(delay, 3_000); timeouts.set(++next, fn); return next; },
    clearTimeout(token) { timeouts.delete(token); } };
}
for (const shared of [false, true]) test(`visibility reentry with shared physical slot ${shared} admits only its outer check`, async () => {
  const c = timers(), updates = [], resolves = []; let watch, reentered = false, observations = 0, reads = 0;
  if (shared) c.physical = { current: null };
  c.visible = () => {
    observations++;
    if (!watch) return false;
    if (!reentered) { reentered = true; void watch.check(); }
    return true;
  };
  watch = startReaderWatch(value => updates.push(value), () => {
    reads++; return new Promise(resolve => resolves.push(resolve));
  }, c, () => ({ kind: "unavailable" }));
  const pending = watch.check(); await flush();
  const observed = { reads, observations };
  watch.stop(); for (const resolve of resolves) resolve({ kind: "current" }); await pending; await flush();
  assert.deepEqual(observed, { reads: 1, observations: 2 });
  assert.deepEqual(updates, []); assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
  if (shared) assert.equal(c.physical.current, null);
});
test("retirement inside visibility observation cannot allocate new deadline resources", async () => {
  const c = timers(), updates = []; let watch, deadlines = 0, reads = 0;
  const timeout = c.timeout; c.timeout = (...args) => { deadlines++; return timeout(...args); };
  c.visible = () => { if (!watch) return false; watch.stop(); return true; };
  watch = startReaderWatch(value => updates.push(value), async () => { reads++; return { kind: "current" }; }, c, () => ({ kind: "unavailable" }));
  await watch.check(); assert.equal(deadlines, 0); assert.equal(reads, 0);
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0); assert.deepEqual(updates, []);
});
test("visibility refusal is terminal once and cannot admit a nested read", async () => {
  const c = timers(), updates = []; let watch, reads = 0, entered = false;
  c.visible = () => {
    if (!watch) return false;
    if (!entered) { entered = true; void watch.check(); }
    throw Error("PRIVATE_VISIBILITY_FAILURE");
  };
  watch = startReaderWatch(value => updates.push(value), async () => { reads++; return { kind: "current" }; }, c, () => ({ kind: "unavailable" }));
  await watch.check(); await flush(); await watch.check();
  assert.equal(reads, 0); assert.deepEqual(updates, [{ kind: "unavailable" }]);
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
});
test("hidden observation releases its admission for an ordinary explicit visible check", async () => {
  const c = timers(), updates = []; let visible = false, reads = 0;
  c.visible = () => visible;
  const watch = startReaderWatch(value => updates.push(value), async () => { reads++; return { kind: "current" }; }, c, () => ({ kind: "unavailable" }));
  await flush(); assert.equal(reads, 0); visible = true; await watch.check();
  assert.equal(reads, 1); assert.deepEqual(updates, []); assert.equal(c.timeouts.size, 0);
  assert.equal(c.intervals.size, 1); watch.stop(); await watch.check(); assert.equal(reads, 1);
});
