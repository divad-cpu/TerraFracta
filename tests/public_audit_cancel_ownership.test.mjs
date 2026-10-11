import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { createOperatorAuditReader } from "../src/server/operator-audit-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { audit, scope, bytes } from "./helpers/operator_audit_fixture.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const families = [
  ["publication", createPublicIssueReader, () => sample().requestedRoute, sample, { status: 503, cacheControl: "no-store" }, "public_issue_read"],
  ["audit", createOperatorAuditReader, scope, audit, { kind: "unavailable" }, "operator_audit_read"],
];
function children(t) {
  const NativeController = globalThis.AbortController, owned = [];
  t.mock.method(globalThis, "AbortController", class extends NativeController {
    constructor() { super(); owned.push(this); t.mock.method(this, "abort", () => { throw Error("INVENTED_PRIVATE_ABORT_REFUSAL"); }); }
  });
  return owned;
}
function deadlines(t) {
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout, timers = [];
  t.mock.method(globalThis, "setTimeout", (fn, delay, ...args) => {
    const handle = set(fn, delay, ...args); if (delay === 3_000) timers.push({ fn, handle }); return handle;
  });
  return { timers, clear: () => { for (const timer of timers) clear(timer.handle); } };
}

for (const [name, create, selection, value, held, code] of families) {
  test(`${name}: deadline refusal ends observation before physical settlement and retains late-value silence`, async t => {
    const own = children(t), clock = deadlines(t), faults = []; let finish, calls = 0;
    const read = create(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, () => 0, name => faults.push(name));
    const pending = read(selection()); await tick();
    try {
      assert.equal(calls, 1); assert.equal(clock.timers.length, 1);
      clock.clear(); assert.doesNotThrow(() => clock.timers[0].fn());
      assert.deepEqual(await pending, held); assert.deepEqual(faults, [code]);
      assert.equal(own[0].signal.aborted, false); assert.equal(calls, 1);
      finish(bytes(value())); await tick(); assert.deepEqual(await pending, held);
      assert.doesNotThrow(() => clock.timers[0].fn()); assert.deepEqual(faults, [code]);
    } finally { t.mock.restoreAll(); clock.clear(); finish?.(bytes(value())); await pending.catch(() => {}); }
  });

  test(`${name}: actual parent abort stays prompt and silent despite refused physical cancellation`, async t => {
    const parent = new AbortController(), own = children(t), faults = []; let reject, calls = 0;
    const read = create(() => { calls++; return new Promise((_resolve, fail) => { reject = fail; }); }, () => 0, name => faults.push(name));
    const pending = read(selection(), parent.signal); await tick();
    try {
      parent.abort(); assert.deepEqual(await pending, held); assert.equal(own[0].signal.aborted, false);
      assert.equal(calls, 1); assert.deepEqual(faults, []);
      assert.equal(getEventListeners(parent.signal, "abort").length, 0);
      reject(Error("INVENTED_PRIVATE_LATE_BODY")); await tick(); assert.deepEqual(faults, []);
    } finally { t.mock.restoreAll(); reject?.(Error("INVENTED_PRIVATE_LATE_BODY")); await pending.catch(() => {}); }
  });

  test(`${name}: retained parent and deadline callbacks are inert after an exact checked result`, async t => {
    const parent = new AbortController(), clock = deadlines(t), faults = [];
    const add = parent.signal.addEventListener.bind(parent.signal), remove = parent.signal.removeEventListener.bind(parent.signal);
    let retained, calls = 0, physicalAborts = 0;
    t.mock.method(parent.signal, "addEventListener", (...args) => { retained = args[1]; return add(...args); });
    t.mock.method(parent.signal, "removeEventListener", () => { throw Error("INVENTED_PRIVATE_LISTENER_REFUSAL"); });
    const NativeController = globalThis.AbortController;
    t.mock.method(globalThis, "AbortController", class extends NativeController {
      constructor() { super(); const abort = this.abort.bind(this); t.mock.method(this, "abort", () => { physicalAborts++; abort(); }); }
    });
    const read = create(async () => { calls++; return bytes(value()); }, () => 0, name => faults.push(name));
    try {
      const result = await read(selection(), parent.signal);
      assert.equal(name === "publication" ? result.status : result.kind, name === "publication" ? 200 : "ok");
      assert.equal(getEventListeners(parent.signal, "abort").length, 1);
      assert.deepEqual(faults, [code]);
      const before = { physicalAborts, calls, faults: [...faults] };
      assert.doesNotThrow(retained); assert.doesNotThrow(() => clock.timers[0].fn()); await tick();
      assert.deepEqual({ physicalAborts, calls, faults }, before);
    } finally { t.mock.restoreAll(); clock.clear(); if (retained) remove("abort", retained); }
  });
}
