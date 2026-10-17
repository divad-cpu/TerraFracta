import assert from "node:assert/strict";
import test from "node:test";
import { weeklyReportHarness } from "./helpers/weekly_report_harness.mjs";
import { exportWeeklyRehearsal } from "../src/weekly-rehearsal-export.ts";
import { WEEKLY_REPORT_BYTE_LIMIT } from "../src/weekly-rehearsal-report.ts";

const body = exportWeeklyRehearsal({ state: "observed", observation: {
  schemaVersion: 1, evidenceKind: "current_local_fictional_weekly_status",
  observedAt: "2026-10-03T14:36:03.626268+00:00", dueAt: "2026-09-28T06:00:00Z",
  windowKey: "2026-W40", graceMinutes: 60, state: "attention", reason: "run_not_completed",
  coverage: "unknown", totalReceipts: 8, unreadableReceipts: 0, pendingReceipts: 0,
  realScheduleEnabled: false, trustedRunLedger: false, sourceRequests: 0,
  publicationEnabled: false, alertsSent: 0,
} }).body;
const turn = () => new Promise(resolve => setImmediate(resolve));
function select(ui, file, callback = ui.input().onChange) {
  const input = { files: [file], value: "PRIVATE_LOCAL_NAME" };
  callback({ currentTarget: input }); assert.equal(input.value, "");
}
function fixture(t, fault = true) {
  const NativeController = globalThis.AbortController;
  const file = new File([body], "PRIVATE_REPORT.json", { type: "application/json" });
  const buffer = new TextEncoder().encode(body).buffer;
  const ui = weeklyReportHarness(); let calls = 0, reads = 0, outer, resolve;
  const physical = new Promise(ok => { resolve = ok; });
  t.mock.method(globalThis, "fetch", () => assert.fail("Local report used a transport"));
  t.mock.method(globalThis, "AbortController", function () {
    const controller = new NativeController();
    if (!outer) {
      outer = controller;
      if (fault) t.mock.method(controller, "abort", () => { calls++; throw new Error("PRIVATE_ABORT_FAULT"); });
    }
    return controller;
  });
  t.mock.method(file, "slice", (start, end) => {
    assert.equal(start, 0); assert.equal(end, WEEKLY_REPORT_BYTE_LIMIT + 1); reads++;
    const blob = new Blob([buffer]); t.mock.method(blob, "arrayBuffer", () => physical); return blob;
  });
  t.after(async () => { resolve(buffer); await turn(); ui.unmount(); });
  ui.mount();
  return { ui, file, resolve: () => resolve(buffer), calls: () => calls, reads: () => reads,
    outer: () => outer, fresh: () => new File([body], "PRIVATE_FRESH.json") };
}

test("weekly clear completes despite an outer abort fault and keeps the original read occupied", async t => {
  const f = fixture(t), { ui } = f; select(ui, f.file);
  const oldFile = ui.input().onChange, oldClear = ui.button().onClick;
  assert.doesNotThrow(oldClear); assert.equal(f.calls(), 1); assert.equal(f.outer().signal.aborted, false);
  assert.match(ui.markup(), /No local report/); assert.equal(ui.input().disabled, true);
  oldFile({ currentTarget: { files: [f.fresh()], value: "" } }); assert.equal(f.reads(), 1);
  f.resolve(); await turn(); assert.equal(ui.input().disabled, false);
  assert.doesNotMatch(ui.markup(), /8 recorded receipts|PRIVATE_/);
  select(ui, f.fresh()); await turn(); oldClear(); assert.match(ui.markup(), /8 recorded receipts/);
});

test("weekly deadline still displays a held report when outer abort throws without releasing its read", async t => {
  const f = fixture(t), { ui } = f, timers = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { assert.equal(delay, 8_000); timers.push(callback); return timers.length; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  select(ui, f.file); assert.equal(timers.length, 1); assert.doesNotThrow(timers[0]);
  assert.equal(f.calls(), 1); assert.equal(f.outer().signal.aborted, false);
  assert.match(ui.markup(), /could not be read/); assert.equal(ui.input().disabled, true);
  assert.equal(f.reads(), 1); assert.doesNotMatch(ui.markup(), /PRIVATE_/);
  f.resolve(); await turn(); assert.equal(ui.input().disabled, false); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
  select(ui, f.fresh()); await turn(); timers[0](); assert.match(ui.markup(), /8 recorded receipts/);
});

test("weekly layout cleanup stays quiet through outer abort failure and a recreated visit awaits physical settlement", async t => {
  const f = fixture(t), { ui } = f; select(ui, f.file); const oldFile = ui.input().onChange;
  assert.doesNotThrow(() => ui.unmount()); assert.equal(f.calls(), 1);
  ui.mount(); assert.equal(ui.input().disabled, true); assert.doesNotMatch(ui.markup(), /8 recorded receipts|PRIVATE_/);
  oldFile({ currentTarget: { files: [f.fresh()], value: "" } }); assert.equal(f.reads(), 1);
  f.resolve(); await turn(); assert.equal(ui.input().disabled, false);
  assert.doesNotMatch(ui.markup(), /8 recorded receipts|could not be read/);
  select(ui, f.fresh()); await turn(); assert.match(ui.markup(), /8 recorded receipts/);
});

test("weekly native outer cancellation still aborts its signal and requires a fresh selection after settlement", async t => {
  const f = fixture(t, false), { ui } = f; select(ui, f.file); ui.button().onClick();
  assert.equal(f.outer().signal.aborted, true); assert.equal(ui.input().disabled, true);
  f.resolve(); await turn(); assert.equal(ui.input().disabled, false); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
  select(ui, f.fresh()); await turn(); assert.match(ui.markup(), /8 recorded receipts/); assert.doesNotMatch(ui.markup(), /PRIVATE_/);
});
