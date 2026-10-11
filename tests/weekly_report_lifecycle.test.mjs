import assert from "node:assert/strict";
import test from "node:test";
import { weeklyReportHarness } from "./helpers/weekly_report_harness.mjs";
import { exportWeeklyRehearsal } from "../src/weekly-rehearsal-export.ts";
import { WEEKLY_REPORT_BYTE_LIMIT } from "../src/weekly-rehearsal-report.ts";

const assessment = { state: "observed", observation: {
  schemaVersion: 1, evidenceKind: "current_local_fictional_weekly_status", observedAt: "2026-10-03T14:36:03.626268+00:00",
  dueAt: "2026-09-28T06:00:00Z", windowKey: "2026-W40", graceMinutes: 60, state: "attention", reason: "run_not_completed",
  coverage: "unknown", totalReceipts: 8, unreadableReceipts: 0, pendingReceipts: 0, realScheduleEnabled: false,
  trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0,
} };
const body = exportWeeklyRehearsal(assessment).body;
const bytes = () => new TextEncoder().encode(body).buffer;
const turn = () => new Promise(resolve => setImmediate(resolve));
const file = () => new File([body], "PRIVATE_WEEKLY_FILENAME.json", { type: "application/json" });
function select(ui, chosen, callback = ui.input().onChange) {
  const input = { files: chosen ? [chosen] : [], value: "PRIVATE_WEEKLY_FILENAME" };
  callback({ currentTarget: input }); return input;
}
function pending() {
  let resolve, reject, reads = 0;
  return { file: { size: bytes().byteLength, slice(start, end) {
    assert.equal(start, 0); assert.equal(end, WEEKLY_REPORT_BYTE_LIMIT + 1); reads++;
    return { arrayBuffer: () => new Promise((ok, fail) => { resolve = ok; reject = fail; }) };
  } }, reads: () => reads, resolve: () => resolve(bytes()), reject: () => reject(new Error("PRIVATE_WEEKLY_READ")) };
}
function fixture(t) {
  t.mock.method(globalThis, "fetch", () => assert.fail("Local file reading used a transport"));
  const ui = weeklyReportHarness(); t.after(() => ui.unmount()); return ui;
}

test("a pre-effect weekly file callback never acquires a later visit", async t => {
  const ui = fixture(t), old = ui.input().onChange, p = pending();
  select(ui, p.file, old); assert.equal(p.reads(), 0);
  ui.mount(); select(ui, p.file, old); assert.equal(p.reads(), 0);
  const input = select(ui, file()); assert.equal(input.value, ""); await turn();
  assert.match(ui.markup(), /8 recorded receipts/);
});

test("clearing invalidates the exact old file and clear controls before another render", async t => {
  const ui = fixture(t); ui.mount(); select(ui, file()); await turn();
  const oldFile = ui.input().onChange, oldClear = ui.button().onClick;
  oldClear(); const p = pending(); select(ui, p.file, oldFile); assert.equal(p.reads(), 0);
  select(ui, file()); await turn(); oldClear(); assert.match(ui.markup(), /8 recorded receipts/);
  assert.doesNotMatch(ui.markup(), /PRIVATE_/);
});

test("effect recreation withholds a loaded weekly report and permanently retires old controls", async t => {
  const ui = fixture(t); ui.mount(); select(ui, file()); await turn();
  const oldInput = ui.input().onChange, oldClear = ui.button().onClick;
  ui.unmount(); ui.mount(); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
  const p = pending(); select(ui, p.file, oldInput); oldClear(); assert.equal(p.reads(), 0);
  select(ui, file()); await turn(); oldClear(); assert.match(ui.markup(), /8 recorded receipts/);
});

test("replacement retires presentation but does not create a second physical file read", async t => {
  const ui = fixture(t), first = pending(), second = pending(); ui.mount();
  select(ui, first.file); assert.equal(ui.input().disabled, true);
  select(ui, second.file); assert.equal(first.reads(), 1); assert.equal(second.reads(), 0);
  assert.match(ui.markup(), /previous file read is still finishing/);
  first.resolve(); await turn(); assert.equal(ui.input().disabled, false);
  assert.doesNotMatch(ui.markup(), /8 recorded receipts/); assert.match(ui.markup(), /Choose the file again/);
  select(ui, second.file); assert.equal(second.reads(), 1); second.resolve(); await turn();
  assert.match(ui.markup(), /8 recorded receipts/);
});

test("cleared pending read retains its slot until actual settlement and cannot restore old contents", async t => {
  const ui = fixture(t), first = pending(), second = pending(); ui.mount(); select(ui, first.file);
  ui.button().onClick(); assert.match(ui.markup(), /No local report/); assert.equal(ui.input().disabled, true);
  select(ui, second.file); assert.equal(second.reads(), 0);
  first.resolve(); await turn(); assert.equal(ui.input().disabled, false); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
  select(ui, file()); await turn(); assert.match(ui.markup(), /8 recorded receipts/);
});

for (const reject of [false, true]) test(`recreated effect retains a retired physical slot through ${reject ? "rejection" : "success"}`, async t => {
  const ui = fixture(t), first = pending(), second = pending(); ui.mount(); select(ui, first.file);
  const oldInput = ui.input().onChange; ui.unmount(); ui.mount();
  assert.equal(ui.input().disabled, true); select(ui, second.file); select(ui, second.file, oldInput); assert.equal(second.reads(), 0);
  reject ? first.reject() : first.resolve(); await turn(); assert.equal(ui.input().disabled, false);
  assert.doesNotMatch(ui.markup(), /8 recorded receipts|could not be read|PRIVATE_/);
  select(ui, file()); await turn(); assert.match(ui.markup(), /8 recorded receipts/);
});

test("eight-second deadline withholds presentation while the original read still owns its physical slot", async t => {
  const ui = fixture(t), first = pending(), second = pending(), timers = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { assert.equal(delay, 8_000); timers.push(callback); return timers.length; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  ui.mount(); select(ui, first.file); assert.equal(timers.length, 1); timers[0]();
  assert.match(ui.markup(), /could not be read/); assert.equal(ui.input().disabled, true);
  select(ui, second.file); assert.equal(second.reads(), 0);
  first.resolve(); await turn(); assert.equal(ui.input().disabled, false); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
  select(ui, file()); await turn(); assert.match(ui.markup(), /8 recorded receipts/);
  timers[0](); assert.match(ui.markup(), /8 recorded receipts/, "retired timer changed a successor");
});

test("elapsed monotonic deadline rejects a late result even if its timer callback was suspended", async t => {
  const ui = fixture(t), first = pending(); let now = 0;
  t.mock.method(performance, "now", () => now);
  ui.mount(); select(ui, first.file); now = 8_000; first.resolve(); await turn();
  assert.match(ui.markup(), /could not be read/); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
  assert.equal(ui.input().disabled, false);
});

test("deadline setup refusal dispatches no file read and exposes no private detail", async t => {
  const ui = fixture(t), first = pending();
  t.mock.method(globalThis, "setTimeout", () => { throw new Error("PRIVATE_WEEKLY_TIMER"); });
  ui.mount(); select(ui, first.file); await turn(); assert.equal(first.reads(), 0);
  assert.match(ui.markup(), /could not be read/); assert.doesNotMatch(ui.markup(), /PRIVATE_/); assert.equal(ui.input().disabled, false);
});

test("controller setup refusal stays opaque without dispatch or an unhandled file-selection rejection", async t => {
  const ui = fixture(t), first = pending();
  t.mock.method(globalThis, "AbortController", function () { throw new Error("PRIVATE_WEEKLY_CONTROLLER"); });
  ui.mount(); assert.doesNotThrow(() => select(ui, first.file)); await turn(); assert.equal(first.reads(), 0);
  assert.match(ui.markup(), /could not be read/); assert.doesNotMatch(ui.markup(), /PRIVATE_/); assert.equal(ui.input().disabled, false);
});

test("one captured native file size binds the bounded read without repeated getters", async t => {
  const ui = fixture(t); let gets = 0, slices = 0;
  ui.mount(); select(ui, { get size() { gets++; return gets === 1 ? bytes().byteLength : -1; }, slice(start, end) {
    slices++; assert.equal(start, 0); assert.equal(end, WEEKLY_REPORT_BYTE_LIMIT + 1); return { arrayBuffer: async () => bytes() };
  } }); await turn(); assert.equal(gets, 1); assert.equal(slices, 1); assert.match(ui.markup(), /8 recorded receipts/);
});

test("an own byteLength cannot hide a mismatch against the native returned buffer", async t => {
  const ui = fixture(t), buffer = bytes(); Object.defineProperty(buffer, "byteLength", { value: 2 });
  ui.mount(); select(ui, { size: 2, slice() { return { arrayBuffer: async () => buffer }; } }); await turn();
  assert.match(ui.markup(), /could not be read/); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
});

test("a current native File preserves complete historical semantics and clearing does not upload", async t => {
  const ui = fixture(t); ui.mount(); select(ui, file()); await turn();
  const html = ui.markup(); assert.match(html, /8 recorded receipts|2026-W40/);
  assert.match(html, /dated claim, not an authenticated receipt or a current inspection/);
  assert.match(html, /cannot enable collection, alerts, publication or a schedule/); assert.doesNotMatch(html, /PRIVATE_|<a /);
  assert.equal(ui.input().disabled, false); ui.button().onClick(); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
});
