import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { createOperatorAuditChoicesReader } from "../src/server/operator-audit-choices-reader.ts";
import { createHeldDecisionsReader } from "../src/server/operator-held-decisions-reader.ts";
import { createProposalReader } from "../src/server/operator-proposal-reader.ts";
import { choices, choiceId, bytes } from "./helpers/operator_audit_choices_fixture.mjs";
import { heldScope, heldReport } from "./helpers/operator_held_fixture.mjs";
import { proposalScope, proposalReport } from "./helpers/proposal_fixture.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const held = { kind: "unavailable" };
const families = [
  ["choices", createOperatorAuditChoicesReader, () => choiceId(1), () => choices(choiceId(1))],
  ["held", createHeldDecisionsReader, heldScope, heldReport],
  ["proposal", createProposalReader, proposalScope, proposalReport],
];
function ownControllers(t, configure) {
  const NativeController = globalThis.AbortController, owned = [];
  t.mock.method(globalThis, "AbortController", class extends NativeController {
    constructor() { super(); owned.push(this); configure?.(this); }
  });
  return owned;
}

for (const [name, create, scope, report] of families) {
  test(`${name}: partial listener/deadline setup retires before dispatch and returns one detail-free failure`, async t => {
    for (const fault of ["listener", "deadline"]) {
      const parent = new AbortController(), add = parent.signal.addEventListener.bind(parent.signal);
      let calls = 0; const faults = [];
      if (fault === "listener") t.mock.method(parent.signal, "addEventListener", (...args) => {
        add(...args); throw Error("INVENTED_PRIVATE_SETUP_CANARY");
      });
      else {
        const set = globalThis.setTimeout;
        t.mock.method(globalThis, "setTimeout", (fn, delay, ...args) => {
          if (delay === 3_000) throw Error("INVENTED_PRIVATE_DEADLINE_CANARY");
          return set(fn, delay, ...args);
        });
      }
      const read = create(async () => { calls++; return bytes(report()); }, () => 0, code => faults.push(code));
      try {
        assert.deepEqual(await read(scope(), parent.signal), held);
        assert.equal(calls, 0); assert.deepEqual(faults, ["operator_audit_read"]);
        assert.equal(getEventListeners(parent.signal, "abort").length, 0);
      } finally { t.mock.restoreAll(); }
    }
  });

  test(`${name}: independent retirement faults preserve the exact checked report and do not block the next read`, async t => {
    const parent = new AbortController(), remove = parent.signal.removeEventListener.bind(parent.signal);
    const set = globalThis.setTimeout, clear = globalThis.clearTimeout, timers = new Set();
    const retired = { timer: 0, listener: 0, abort: 0 }, faults = []; let calls = 0;
    ownControllers(t, controller => {
      const abort = controller.abort.bind(controller);
      t.mock.method(controller, "abort", () => { retired.abort++; abort(); throw Error("INVENTED_PRIVATE_ABORT_CANARY"); });
    });
    t.mock.method(globalThis, "setTimeout", (fn, delay, ...args) => {
      const handle = set(fn, delay, ...args); if (delay === 3_000) timers.add(handle); return handle;
    });
    t.mock.method(globalThis, "clearTimeout", handle => {
      clear(handle); if (timers.delete(handle)) { retired.timer++; throw Error("INVENTED_PRIVATE_RETIREMENT_CANARY"); }
    });
    t.mock.method(parent.signal, "removeEventListener", (...args) => {
      retired.listener++; remove(...args); throw Error("INVENTED_PRIVATE_LISTENER_CANARY");
    });
    const value = report(), read = create(async () => { calls++; return bytes(value); }, () => 0, code => faults.push(code));
    try {
      const result = await read(scope(), parent.signal);
      assert.equal(result.kind, "ok"); assert.deepEqual(result.report, value);
      assert.deepEqual(retired, { timer: 1, listener: 1, abort: 1 });
      assert.equal(getEventListeners(parent.signal, "abort").length, 0);
      assert.deepEqual(faults, ["operator_audit_read"]);
    } finally { t.mock.restoreAll(); for (const handle of timers) clear(handle); }
    assert.equal((await read(scope(), parent.signal)).kind, "ok");
    assert.equal(calls, 2); assert.deepEqual(faults, ["operator_audit_read"]);
  });

  test(`${name}: a deadline resolves despite abort refusal and retired callbacks cannot affect the successor`, async t => {
    const faults = [], set = globalThis.setTimeout, clear = globalThis.clearTimeout;
    const timers = [], controllers = ownControllers(t, controller => t.mock.method(controller, "abort", () => { throw Error("INVENTED_PRIVATE_ABORT_REFUSAL"); }));
    t.mock.method(globalThis, "setTimeout", (fn, delay, ...args) => {
      const handle = set(fn, delay, ...args); if (delay === 3_000) timers.push({ handle, fn }); return handle;
    });
    let finish, calls = 0;
    const read = create(() => { calls++; return calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(bytes(report())); }, () => 0, code => faults.push(code));
    const pending = read(scope()); await tick();
    try {
      assert.equal(calls, 1); assert.equal(timers.length, 1);
      clear(timers[0].handle); assert.doesNotThrow(() => timers[0].fn());
      assert.deepEqual(await pending, held); assert.deepEqual(faults, ["operator_audit_read"]);
      t.mock.restoreAll();
      const next = await read(scope()); assert.equal(next.kind, "ok");
      const old = controllers.length, oldFaults = [...faults];
      assert.doesNotThrow(() => timers[0].fn());
      assert.equal(controllers.length, old); assert.deepEqual(faults, oldFaults); assert.equal(calls, 2);
      finish(bytes(report())); await tick(); assert.deepEqual(await pending, held);
    } finally { t.mock.restoreAll(); for (const timer of timers) clear(timer.handle); finish?.(bytes(report())); await pending.catch(() => {}); }
  });

  test(`${name}: actual caller cancellation stays prompt and silent when physical abort and listener removal refuse`, async t => {
    const parent = new AbortController(), remove = parent.signal.removeEventListener.bind(parent.signal);
    const faults = []; let reject, calls = 0;
    const controllers = ownControllers(t, controller => t.mock.method(controller, "abort", () => { throw Error("INVENTED_PRIVATE_ABORT_REFUSAL"); }));
    t.mock.method(parent.signal, "removeEventListener", () => { throw Error("INVENTED_PRIVATE_REMOVE_REFUSAL"); });
    const read = create(() => { calls++; return new Promise((_resolve, fail) => { reject = fail; }); }, () => 0, code => faults.push(code));
    const pending = read(scope(), parent.signal); await tick();
    try {
      parent.abort(); assert.deepEqual(await pending, held); assert.equal(calls, 1);
      assert.equal(controllers[0].signal.aborted, false); assert.deepEqual(faults, []);
      // A physically retained listener is harmless after observation retirement.
      for (const listener of getEventListeners(parent.signal, "abort")) { assert.doesNotThrow(listener); remove("abort", listener); }
      reject(Error("INVENTED_PRIVATE_LATE_CANARY")); await tick(); assert.deepEqual(faults, []);
    } finally { t.mock.restoreAll(); reject?.(Error("INVENTED_PRIVATE_LATE_CANARY")); await pending.catch(() => {}); }
  });
}
