import assert from "node:assert/strict";
import test from "node:test";
import { createInventedContactFreeClock } from "../src/invented-contact-free-clock.ts";
import { createInventedContactFreeSharedWriteTrial } from "../src/invented-contact-free-shared-write-trial.ts";
const id = n => `ed710000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = 1791453600000, held = { kind: "held" };
const turn = () => new Promise(resolve => setImmediate(resolve));
function setup(t, fault) {
  const clock = createInventedContactFreeClock({ kind: "fresh_invented_clock", utcAtMs: now });
  const request = new Request("https://example.org/invented", { method: "POST", body: "{}" });
  const timers = [], calls = [], NativeController = AbortController; let resolveReserve, removals = 0;
  const remove = request.signal.removeEventListener.bind(request.signal);
  t.mock.method(request.signal, "removeEventListener", (...args) => { removals++; return remove(...args); });
  t.mock.method(globalThis, "setTimeout", (callback, ms) => { assert.equal(ms, 2_000); const value = { callback }; timers.push(value); return value; });
  t.mock.method(globalThis, "clearTimeout", () => { if (fault === "clear") throw Error("PRIVATE_CLEAR_FAULT"); });
  if (fault === "abort") t.mock.method(globalThis, "AbortController", function () {
    const controller = new NativeController(); controller.abort = () => { throw Error("PRIVATE_ABORT_FAULT"); }; return controller;
  });
  const trial = createInventedContactFreeSharedWriteTrial({ executionId: id(1),
    reserve: input => { calls.push("reserve"); return new Promise(resolve => { resolveReserve = () => resolve({ kind: "reserved_invented", ticket: id(2), operationId: input.operationId, admittedAtMs: now }); }); },
    arm: async () => { calls.push("arm"); throw Error("Arm refused"); },
    write: async () => { calls.push("write"); throw Error("Write refused"); },
    release: async () => { calls.push("release"); return { kind: "released_invented" }; },
    resolve: async () => { calls.push("resolve"); throw Error("Resolve refused"); },
  }, clock.token);
  assert.equal(trial.kind, "ready");
  const operation = trial.begin(request, { currentKey: id(3), previousKey: id(4), epoch: Math.floor(now / 900_000) }, () => { throw Error("Body callback refused"); });
  assert.equal(operation.kind, "owned_invented_submission");
  return { trial, request, operation, timers, calls, settle: () => resolveReserve(), removals: () => removals };
}
for (const fault of ["abort", "native"]) test(`shared ${fault} deadline settles only observation while the reserve port remains owned`, async t => {
  const v = setup(t, fault); let observed = false;
  v.operation.observation.then(value => { assert.deepEqual(value, held); observed = true; });
  assert.doesNotThrow(() => v.timers[0].callback()); await turn(); assert.equal(observed, true);
  assert.equal(v.trial.inspection().physicalPorts, 1); assert.equal(v.request.bodyUsed, false);
  assert.deepEqual(await v.trial.retirePrewrite(v.operation.token), held);
  assert.deepEqual(await v.trial.resolveUnknown(v.operation.token), held);
  assert.deepEqual(v.calls, ["reserve"]);
  v.settle(); await turn(); assert.equal(v.trial.inspection().physicalPorts, 0);
  assert.equal(v.trial.inspection().held, fault === "abort");
  assert.deepEqual(v.calls, ["reserve"]);
  assert.equal(JSON.stringify(v.trial.inspection()).includes("PRIVATE_"), false);
});
test("shared failed timer cleanup still removes the owned parent listener and holds context", async t => {
  const v = setup(t, "clear"); v.settle(); assert.deepEqual(await v.operation.observation, held);
  assert.ok(v.removals() >= 1); assert.equal(v.trial.inspection().held, true);
  assert.equal(v.trial.inspection().physicalPorts, 0); assert.deepEqual(v.calls, ["reserve"]);
  assert.equal(v.request.bodyUsed, false);
});
