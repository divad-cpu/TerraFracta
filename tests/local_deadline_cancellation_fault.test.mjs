import assert from "node:assert/strict";
import test from "node:test";
import { withLocalRequestDeadline } from "../src/local-request-deadline.ts";

// Explicit control-fault seam around real native signals. This is local fault
// qualification, not an observed browser/polyfill or operational outage.
function controls(t) {
  const Native = globalThis.AbortController, parent = new Native();
  let callback, fire, resolve, aborts = 0, notices = 0, removed = 0;
  t.mock.method(globalThis, "AbortController", function () {
    const owned = new Native();
    t.mock.method(owned, "abort", () => { aborts++; throw new Error("PRIVATE_ABORT_FAULT"); });
    return owned;
  });
  t.mock.method(parent.signal, "addEventListener", (name, listener) => { assert.equal(name, "abort"); callback = listener; });
  t.mock.method(parent.signal, "removeEventListener", () => { removed++; });
  t.mock.method(globalThis, "setTimeout", listener => { fire = listener; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  let settled = false, owned;
  const read = withLocalRequestDeadline(parent.signal, 5000, signal => {
    owned = signal; return new Promise(done => { resolve = done; });
  }, () => 0, () => { notices++; });
  void read.then(() => { settled = true; }, () => { settled = true; });
  return { parent, read, cancel: () => callback(), deadline: () => fire(), resolve: value => resolve(value),
    get aborts() { return aborts; }, get notices() { return notices; }, get removed() { return removed; },
    get settled() { return settled; }, get owned() { return owned; } };
}
test("parent cancellation stays refused after failed physical abort and retains the original request until settlement", async t => {
  const c = controls(t); c.parent.abort();
  // Record the failure's effect separately from the required callback behavior.
  try { c.cancel(); } catch { /* Predecessor throws before it can reject the late result. */ }
  assert.equal(c.aborts, 1);
  await Promise.resolve(); assert.equal(c.settled, false); assert.equal(c.owned.aborted, false);
  c.resolve("PRIVATE_RETIRED_RESULT"); await assert.rejects(c.read, /Local request cancelled/);
  assert.equal(c.settled, true); assert.equal(c.notices, 0); assert.equal(c.removed, 1);
});
test("a failed physical abort cannot escape the owned parent callback", async t => {
  const c = controls(t); c.parent.abort(); let thrown;
  try { c.cancel(); } catch (error) { thrown = error; }
  assert.equal(c.aborts, 1);
  c.resolve("retired"); await c.read.catch(() => {});
  assert.equal(thrown, undefined); assert.equal(c.removed, 1);
});
test("deadline notice and refusal survive abort failure without releasing the physical request early", async t => {
  const c = controls(t); let thrown;
  try { c.deadline(); } catch (error) { thrown = error; }
  assert.equal(c.aborts, 1);
  await Promise.resolve(); assert.equal(c.settled, false); c.resolve("PRIVATE_LATE_RESULT");
  const outcome = await c.read.then(() => "accepted", () => "held");
  assert.equal(thrown, undefined); assert.equal(c.notices, 1); assert.equal(outcome, "held"); assert.equal(c.removed, 1);
});
test("a retained parent callback cannot attempt cancellation after the request is retired", async t => {
  const c = controls(t); c.resolve("confirmed"); assert.equal(await c.read, "confirmed");
  const before = c.aborts; assert.equal(before, 1); let thrown;
  try { c.cancel(); } catch (error) { thrown = error; }
  assert.equal(thrown, undefined); assert.equal(c.aborts, before); assert.equal(c.notices, 0);
});
test("already cancelled native parent dispatches no work even when its owned abort mechanism fails", async t => {
  const Native = globalThis.AbortController, parent = new Native(); parent.abort(); let calls = 0;
  t.mock.method(globalThis, "AbortController", function () {
    const owned = new Native(); t.mock.method(owned, "abort", () => { throw Error("PRIVATE_ABORT_FAULT"); }); return owned;
  });
  await assert.rejects(withLocalRequestDeadline(parent.signal, 5000, async () => { calls++; return "unexpected"; }));
  assert.equal(calls, 0);
});
