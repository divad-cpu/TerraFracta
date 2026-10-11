import assert from "node:assert/strict";
import test from "node:test";
import { startConnectedReaderWatch } from "../src/connected-reader-watch.ts";
import { connectedStatusIdentity, connectedStatusPayload } from "../src/connected-reader-status.ts";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";

function controls() {
  const intervals = new Map(), timeouts = new Map(); let id = 0;
  return { intervals, timeouts, visible: () => true,
    interval(callback) { intervals.set(++id, callback); return id; },
    clearInterval(token) { intervals.delete(token); },
    timeout(callback) { timeouts.set(++id, callback); return id; },
    clearTimeout(token) { timeouts.delete(token); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("deadline immediately withholds an edition even when transport ignores cancellation", async () => {
  const c = controls(), updates = [], snapshot = { ...connectedInput(), generation: 1 };
  let resolve, signal, calls = 0;
  const watch = startConnectedReaderWatch(connectedStatusIdentity(snapshot), value => updates.push(value),
    async (_expected, selected) => { signal = selected; calls++; return new Promise(done => { resolve = done; }); }, c);
  assert.equal(calls, 1);
  const deadline = [...c.timeouts.values()][0]; deadline();
  assert.equal(signal.aborted, true);
  assert.deepEqual(updates, [{ kind: "unavailable" }]);
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
  resolve(connectedStatusPayload({ kind: "snapshot", snapshot })); await flush();
  await watch.check(); assert.equal(calls, 1);
  assert.deepEqual(updates, [{ kind: "unavailable" }]); watch.stop();
});

test("unmount clears every owned timer while a cancelled read remains unresolved", () => {
  const c = controls(); let signal;
  const watch = startConnectedReaderWatch(connectedStatusIdentity({ ...connectedInput(), generation: 1 }),
    () => assert.fail("Stopped watcher cannot update its old component"),
    async (_expected, selected) => { signal = selected; return new Promise(() => {}); }, c);
  watch.stop();
  assert.equal(signal.aborted, true);
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
});

test("an overdue reply cannot cancel a delayed timer and preserve the old edition", async () => {
  const c = controls(), updates = [], snapshot = { ...connectedInput(), generation: 1 };
  let elapsed = 100, resolve, signal; c.now = () => elapsed;
  const watch = startConnectedReaderWatch(connectedStatusIdentity(snapshot), value => updates.push(value),
    async (_expected, selected) => { signal = selected; return new Promise(done => { resolve = done; }); }, c);
  // The event loop has not run the timeout callback. The reply now arrives
  // at the deadline, independently of whether cancellation was dispatched.
  elapsed = 3100; resolve(connectedStatusPayload({ kind: "snapshot", snapshot })); await flush();
  assert.deepEqual(updates, [{ kind: "unavailable" }]); assert.equal(signal.aborted, true);
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0); watch.stop();
});

test("a matching reply before the elapsed deadline remains current until the next check", async () => {
  const c = controls(), updates = [], snapshot = { ...connectedInput(), generation: 1 };
  let elapsed = 100, resolve; c.now = () => elapsed;
  const watch = startConnectedReaderWatch(connectedStatusIdentity(snapshot), value => updates.push(value),
    async () => new Promise(done => { resolve = done; }), c);
  elapsed = 3099; resolve(connectedStatusPayload({ kind: "snapshot", snapshot })); await flush();
  assert.deepEqual(updates, []); assert.equal(c.intervals.size, 1); assert.equal(c.timeouts.size, 0); watch.stop();
});
