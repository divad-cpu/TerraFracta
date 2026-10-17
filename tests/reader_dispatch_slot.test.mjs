import assert from "node:assert/strict";
import test from "node:test";
import { startReaderWatch } from "../src/reader-watch.ts";
import { startCurrentIssueWatch } from "../src/current-issue-watch.ts";
import { startConnectedReaderWatch } from "../src/connected-reader-watch.ts";
import { currentIssueIdentity } from "../src/current-issue-status.ts";
import { connectedStatusIdentity } from "../src/connected-reader-status.ts";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";

const turn = () => new Promise(setImmediate);
const snapshot = { ...connectedInput(), generation: 1 };
const variants = [
  { name: "current", start: startCurrentIssueWatch, identity: currentIssueIdentity(snapshot.issue) },
  { name: "connected", start: startConnectedReaderWatch, identity: connectedStatusIdentity(snapshot) },
];
const payload = variant => ({ schemaVersion: 1, kind: "current", ...variant.identity });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function controls(physical = { current: null }) {
  let id = 0; const intervals = new Map(), timeouts = new Map();
  return { physical, intervals, timeouts, visible: () => true, now: () => 0,
    interval(fn, ms) { assert.equal(ms, 15_000); intervals.set(++id, fn); return id; },
    clearInterval(token) { intervals.delete(token); },
    timeout(fn, ms) { assert.equal(ms, 3_000); timeouts.set(++id, fn); return id; },
    clearTimeout(token) { timeouts.delete(token); } };
}

for (const v of variants) test(`${v.name}: a read-created successor waits for the original physical response`, async () => {
  const c = controls(), waits = [deferred(), deferred()], updates = [], watches = []; let reads = 0;
  const next = () => { reads++; return waits[1].promise; };
  const first = v.start(v.identity, value => updates.push(value), () => {
    reads++; watches.push(v.start(v.identity, value => updates.push(value), next, c));
    return waits[0].promise;
  }, c); watches.push(first);
  try {
    await turn(); assert.equal(reads, 1, "one shared route admits only the original physical read");
    waits[0].resolve(payload(v)); await turn(); assert.equal(reads, 2);
    assert.notEqual(c.physical.current, null, "the successor still owns its pending response");
    waits[1].resolve(payload(v)); await turn(); assert.equal(c.physical.current, null);
    assert.deepEqual(updates, []);
  } finally {
    watches.forEach(w => w.stop()); waits.forEach(w => w.resolve(payload(v))); await turn();
  }
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
});

for (const v of variants) for (const refusesAbort of [false, true])
  test(`${v.name}: dispatch-time deadline retains original physical debt when abort refuses ${refusesAbort}`, async t => {
    const c = controls(), waits = [deferred(), deferred()], firstUpdates = [], nextUpdates = [], watches = [];
    let firstSignal, nextReads = 0;
    const NativeController = globalThis.AbortController;
    t.mock.method(globalThis, "AbortController", function () {
      const controller = new NativeController(), abort = controller.abort.bind(controller);
      controller.abort = (...args) => {
        if (refusesAbort && controller.signal === firstSignal) throw Error("PRIVATE_PHYSICAL_ABORT_REFUSAL");
        return abort(...args);
      };
      return controller;
    });
    const first = v.start(v.identity, value => firstUpdates.push(value), (_identity, signal) => {
      firstSignal = signal;
      [...c.timeouts.values()][0]();
      watches.push(v.start(v.identity, value => nextUpdates.push(value), () => { nextReads++; return waits[1].promise; }, c));
      return waits[0].promise;
    }, c); watches.push(first);
    try {
      await turn(); assert.equal(nextReads, 0, "logical retirement cannot erase an unresolved physical read");
      assert.equal(firstSignal.aborted, !refusesAbort); assert.deepEqual(firstUpdates, [{ kind: "unavailable" }]);
      waits[0].resolve(payload(v)); await turn(); assert.equal(nextReads, 1);
      assert.notEqual(c.physical.current, null);
      waits[1].resolve(payload(v)); await turn(); assert.equal(c.physical.current, null);
      assert.deepEqual(firstUpdates, [{ kind: "unavailable" }]); assert.deepEqual(nextUpdates, []);
    } finally {
      watches.forEach(w => w.stop()); waits.forEach(w => w.resolve(payload(v))); await turn();
    }
    assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
  });

for (const v of variants) test(`${v.name}: a throwing original read releases only its own admission`, async () => {
  const c = controls(), wait = deferred(), firstUpdates = [], nextUpdates = [], watches = []; let reads = 0;
  const first = v.start(v.identity, value => firstUpdates.push(value), () => {
    watches.push(v.start(v.identity, value => nextUpdates.push(value), () => { reads++; return wait.promise; }, c));
    throw Error("PRIVATE_READER_FAULT");
  }, c); watches.push(first);
  try {
    await turn(); assert.equal(reads, 1); assert.deepEqual(firstUpdates, [{ kind: "unavailable" }]);
    assert.notEqual(c.physical.current, null, "old cleanup cannot release the admitted successor");
    wait.resolve(payload(v)); await turn(); assert.equal(c.physical.current, null); assert.deepEqual(nextUpdates, []);
  } finally { watches.forEach(w => w.stop()); wait.resolve(payload(v)); await turn(); }
});

test("two read-created waiting owners recheck the physical slot after original settlement", async () => {
  const c = controls(), waits = [deferred(), deferred(), deferred()], watches = []; let reads = 0;
  const next = () => { const index = reads++; return waits[index].promise; };
  watches.push(startReaderWatch(() => assert.fail("current response withheld"), () => {
    reads++;
    for (let i = 0; i < 2; i++) watches.push(startReaderWatch(() => assert.fail("current successor withheld"), next, c, () => ({ kind: "unavailable" })));
    return waits[0].promise;
  }, c, () => ({ kind: "unavailable" })));
  try {
    await turn(); assert.equal(reads, 1);
    for (let i = 0; i < 3; i++) {
      waits[i].resolve({ kind: "current" }); await turn(); assert.equal(reads, Math.min(i + 2, 3));
    }
    assert.equal(c.physical.current, null);
  } finally { watches.forEach(w => w.stop()); waits.forEach(w => w.resolve({ kind: "current" })); await turn(); }
});

test("a direct unshared synchronous verifier refusal remains one terminal unavailable result", async () => {
  const c = controls(undefined), updates = []; delete c.physical;
  const watch = startReaderWatch(value => updates.push(value), () => { throw Error("PRIVATE_DIRECT_REFUSAL"); }, c, () => ({ kind: "unavailable" }));
  await turn(); await watch.check(); assert.deepEqual(updates, [{ kind: "unavailable" }]); watch.stop();
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
});
