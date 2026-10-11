import assert from "node:assert/strict";
import test from "node:test";
import { weeklyStatusHarness } from "./helpers/weekly_status_harness.mjs";

const observed = { state: "observed", observation: {
  schemaVersion: 1, evidenceKind: "current_local_fictional_weekly_status", observedAt: "2026-10-03T14:36:03.626268+00:00",
  dueAt: "2026-09-28T06:00:00Z", windowKey: "2026-W40", graceMinutes: 60, state: "attention", reason: "run_not_completed",
  coverage: "unknown", totalReceipts: 8, unreadableReceipts: 0, pendingReceipts: 0, realScheduleEnabled: false,
  trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0,
} };
const turn = () => new Promise(resolve => setImmediate(resolve));
function delayed(t) {
  const replies = [], signals = [];
  t.mock.method(globalThis, "fetch", (url, options) => {
    assert.equal(url, "/api/dev/update-rehearsal/status"); assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store"); assert.equal(options.body, undefined);
    signals.push(options.signal); return new Promise((resolve, reject) => replies.push({ resolve, reject }));
  });
  const codes = [], ui = weeklyStatusHarness(code => codes.push(code)); t.after(() => ui.unmount());
  return { ui, replies, signals, codes };
}

test("pre-effect weekly controls cannot acquire authority when the effect is admitted", async t => {
  const { ui, replies } = delayed(t), old = ui.button().onClick;
  old(); assert.equal(replies.length, 0); ui.mount(); old(); assert.equal(replies.length, 0);
  ui.button().onClick(); assert.equal(replies.length, 1);
  replies[0].resolve(Response.json(observed)); await turn(); assert.match(ui.markup(), /8 saved receipts/);
});

test("retired weekly controls cannot read after disposal or clear a checked successor", async t => {
  const { ui, replies, codes } = delayed(t); ui.mount(); const old = ui.button().onClick;
  ui.unmount(); old(); assert.equal(replies.length, 0);
  ui.mount(); ui.button().onClick(); replies[0].resolve(Response.json(observed)); await turn();
  assert.equal(ui.buttons().length, 2); old(); assert.equal(replies.length, 1);
  assert.match(ui.markup(), /8 saved receipts/); assert.equal(ui.buttons().length, 2); assert.deepEqual(codes, []);
});

for (const stage of ["response", "body"]) for (const rejection of [false, true]) {
  test(`a retired ${stage} wait retains its physical weekly slot through recreation and ${rejection ? "rejection" : "success"}`, async t => {
    const { ui, replies, signals, codes } = delayed(t); ui.mount(); const old = ui.button().onClick; old();
    let body;
    if (stage === "body") {
      let read = false;
      const pending = new Promise((resolve, reject) => { body = { resolve, reject }; });
      replies[0].resolve({ ok: true, headers: new Headers(), body: { locked: false, getReader: () => ({
        read: () => read ? Promise.resolve({ done: true }) : (read = true, pending.then(value => ({ done: false, value: new TextEncoder().encode(JSON.stringify(value)) }))),
        // The controlled read ignores cancellation until explicit settlement.
        cancel: () => Promise.resolve(), releaseLock() {},
      }) } });
      await turn();
    }
    ui.unmount(); assert.equal(signals[0].aborted, true); ui.mount();
    assert.equal(ui.button().disabled, true); old(); ui.button().onClick(); assert.equal(replies.length, 1);
    assert.doesNotMatch(ui.markup(), /8 saved receipts|could not be verified/);
    const unsettled = stage === "body" ? body : replies[0];
    if (rejection) unsettled.reject(new Error("PRIVATE_OLD_WEEKLY_READ"));
    else unsettled.resolve(stage === "body" ? observed : Response.json(observed));
    await turn(); assert.equal(ui.button().disabled, false);
    assert.doesNotMatch(ui.markup(), /8 saved receipts|could not be verified|PRIVATE_OLD_WEEKLY_READ/);
    assert.deepEqual(codes, []); old(); assert.equal(replies.length, 1);
    ui.button().onClick(); assert.equal(replies.length, 2); replies[1].resolve(Response.json(observed)); await turn();
    assert.match(ui.markup(), /8 saved receipts/); assert.equal(ui.buttons().length, 2);
  });
}

test("effect recreation withholds an earlier weekly observation and its retained export before a fresh explicit read", async t => {
  const { ui, replies, codes } = delayed(t); ui.mount(); ui.button().onClick(); replies[0].resolve(Response.json(observed)); await turn();
  const oldRead = ui.button().onClick, oldDownload = ui.buttons()[1].onClick; ui.unmount(); ui.mount();
  assert.equal(ui.buttons().length, 1); assert.doesNotMatch(ui.markup(), /8 saved receipts/);
  t.mock.method(URL, "createObjectURL", () => assert.fail("Retired download created a URL"));
  oldRead(); oldDownload(); assert.equal(replies.length, 1); assert.deepEqual(codes, []);
  ui.button().onClick(); replies[1].resolve(Response.json(observed)); await turn();
  oldRead(); oldDownload(); assert.equal(replies.length, 2); assert.equal(ui.buttons().length, 2);
  assert.match(ui.markup(), /8 saved receipts/); assert.deepEqual(codes, []);
});
