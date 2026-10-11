import assert from "node:assert/strict";
import test from "node:test";
import { weeklyStatusHarness } from "./helpers/weekly_status_harness.mjs";
import { exportWeeklyRehearsal } from "../src/weekly-rehearsal-export.ts";
import { observeClientError } from "../src/client-error-diagnostics.ts";

const observed = { state: "observed", observation: {
  schemaVersion: 1, evidenceKind: "current_local_fictional_weekly_status", observedAt: "2026-10-03T14:36:03.626268+00:00",
  dueAt: "2026-09-28T06:00:00Z", windowKey: "2026-W40", graceMinutes: 60, state: "attention", reason: "run_not_completed",
  coverage: "unknown", totalReceipts: 8, unreadableReceipts: 0, pendingReceipts: 0, realScheduleEnabled: false,
  trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0,
} };
const turn = () => new Promise(resolve => setImmediate(resolve));
async function current(t, report = async () => null) {
  let reads = 0;
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, "/api/dev/update-rehearsal/status"); reads++; return Response.json(observed);
  });
  const codes = [], ui = weeklyStatusHarness(code => observeClientError(code, async code => { codes.push(code); return report(code); }));
  ui.mount(); t.after(() => ui.unmount());
  ui.button().onClick(); await turn(); assert.equal(ui.buttons().length, 2);
  return { ...ui, codes, reads: () => reads, download: () => ui.buttons()[1].onClick() };
}
function facilities(t, denied = []) {
  const calls = [], timers = [], blobs = []; let failures = denied;
  const reject = stage => { if (failures.includes(stage)) throw new Error("PRIVATE_WEEKLY_DOWNLOAD"); };
  const link = { click() { calls.push("click"); reject("click"); }, remove() { calls.push("remove"); reject("remove"); } };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement(name) { assert.equal(name, "a"); calls.push("create"); reject("create"); return link; },
    body: { append(value) { assert.equal(value, link); calls.push("append"); reject("append"); } },
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else delete globalThis.document; });
  t.mock.method(URL, "createObjectURL", blob => { calls.push("url"); reject("url"); blobs.push(blob); return "blob:weekly-assessment"; });
  t.mock.method(URL, "revokeObjectURL", url => { assert.equal(url, "blob:weekly-assessment"); calls.push("revoke"); reject("revoke"); });
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => {
    assert.equal(milliseconds, 1000); calls.push("timer"); reject("timer"); timers.push(callback); return 1;
  });
  return { calls, timers, blobs, link, recover: () => { failures = []; } };
}

test("weekly download preserves the exact historical artifact and deferred URL retirement", async t => {
  const ui = await current(t), native = facilities(t);
  assert.doesNotThrow(ui.download); assert.match(ui.markup(), /Download requested/);
  assert.equal(await native.blobs[0].text(), exportWeeklyRehearsal(observed).body);
  assert.equal(native.link.download, "terrafracta-weekly-rehearsal-2026-W40.json");
  assert.deepEqual(native.calls, ["url", "create", "append", "click", "remove", "timer"]);
  assert.equal(native.timers.length, 1); assert.ok(!native.calls.includes("revoke"));
  assert.doesNotThrow(native.timers[0]); assert.equal(native.calls.at(-1), "revoke");
  assert.deepEqual(ui.codes, []); assert.equal(ui.reads(), 1);
});

for (const failures of [["remove"], ["click", "remove"], ["revoke"], ["timer"], ["timer", "revoke"],
  ["remove", "timer"], ["click", "remove", "timer", "revoke"]]) {
  test(`weekly ${failures.join("+")} refusal cannot replace the original outcome or suppress other cleanup`, async t => {
    const ui = await current(t), native = facilities(t, failures);
    assert.doesNotThrow(ui.download); for (const callback of native.timers) assert.doesNotThrow(callback); await turn();
    assert.ok(native.calls.includes("revoke"));
    assert.match(ui.markup(), failures.includes("click") ? /assessment could not be exported/ : /Download requested/);
    assert.match(ui.markup(), /weekly rehearsal did not complete/); assert.match(ui.markup(), /8 saved receipts/);
    assert.deepEqual(ui.codes, failures.includes("click") ? ["weekly_assessment_export"] : []);
    assert.doesNotMatch(ui.markup(), /PRIVATE_WEEKLY_DOWNLOAD|download completed|file was saved/);
    assert.equal(ui.reads(), 1);
  });
}

test("weekly element failure and timer refusal preserve opaque recovery despite a rejecting reporter", async t => {
  const ui = await current(t, async () => { throw new Error("PRIVATE_WEEKLY_REPORTER"); }), native = facilities(t, ["create", "timer"]);
  assert.doesNotThrow(ui.download); await turn();
  assert.match(ui.markup(), /assessment could not be exported/); assert.match(ui.markup(), /8 saved receipts/);
  assert.deepEqual(ui.codes, ["weekly_assessment_export"]); assert.ok(native.calls.includes("revoke"));
  assert.doesNotMatch(ui.markup(), /PRIVATE_WEEKLY_|Download requested/);
});

test("a later explicit weekly download remains usable after contained cleanup failure without another status read", async t => {
  const ui = await current(t), native = facilities(t, ["click", "remove", "timer"]);
  assert.doesNotThrow(ui.download); await turn(); assert.match(ui.markup(), /assessment could not be exported/);
  native.recover(); assert.doesNotThrow(ui.download); assert.match(ui.markup(), /Download requested/);
  for (const callback of native.timers) assert.doesNotThrow(callback);
  assert.equal(ui.reads(), 1); assert.deepEqual(ui.codes, ["weekly_assessment_export"]);
  assert.equal(native.blobs.length, 2); assert.equal(await native.blobs[1].text(), exportWeeklyRehearsal(observed).body);
});
