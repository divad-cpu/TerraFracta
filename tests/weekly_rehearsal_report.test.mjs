import assert from "node:assert/strict";
import test from "node:test";
import { exportWeeklyRehearsal } from "../src/weekly-rehearsal-export.ts";
import { readWeeklyRehearsalReport, WEEKLY_REPORT_BYTE_LIMIT } from "../src/weekly-rehearsal-report.ts";
import { weeklyReportHarness } from "./helpers/weekly_report_harness.mjs";
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const bytes = value => new TextEncoder().encode(value).buffer;
function assessment() { return { state: "observed", observation: {
  schemaVersion: 1, evidenceKind: "current_local_fictional_weekly_status", observedAt: "2026-10-03T14:36:03.626268+00:00",
  dueAt: "2026-09-28T06:00:00Z", windowKey: "2026-W40", graceMinutes: 60, state: "attention", reason: "run_not_completed",
  coverage: "unknown", totalReceipts: 8, unreadableReceipts: 0, pendingReceipts: 0, realScheduleEnabled: false,
  trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0,
} }; }
function select(ui, file) { const input = { files: file ? [file] : [], value: "private-name-canary" }; ui.input().onChange({ currentTarget: input }); assert.equal(input.value, ""); }
function file() { return new File([exportWeeklyRehearsal(assessment()).body], "private-name-canary.json", { type: "application/json" }); }

test("exported assessment reopens with its exact historical microsecond date and restricted meaning", () => {
  const exported = exportWeeklyRehearsal(assessment()), reopened = readWeeklyRehearsalReport(bytes(exported.body));
  assert.deepEqual(reopened.observation, assessment().observation); assert.equal(reopened.historicalObservation, true);
  assert.equal(reopened.artifactKind, "fictional_weekly_rehearsal_status"); assert.match(reopened.limitation, /No authenticated live run evidence/);
});
test("local reader refuses malformed, oversize and invalid UTF-8 bytes", () => {
  for (const value of [new ArrayBuffer(0), new ArrayBuffer(1), new ArrayBuffer(WEEKLY_REPORT_BYTE_LIMIT + 1), bytes("[]"), bytes("{}"),
    bytes("not json"), new Uint8Array([0xc3, 0x28]).buffer]) assert.throws(() => readWeeklyRehearsalReport(value));
});
test("reader refuses private fields, altered limitations, grants and contradictory clock/count claims", () => {
  const base = JSON.parse(exportWeeklyRehearsal(assessment()).body);
  for (const value of [{ ...base, privatePath: "/private-canary" }, { ...base, limitation: "Approved for live publication" },
    { ...base, historicalObservation: false }, { ...base, schemaVersion: 2 },
    ...[{ trustedRunLedger: true }, { realScheduleEnabled: true }, { publicationEnabled: true }, { sourceRequests: 1 },
      { alertsSent: 1 }, { totalReceipts: 0 }, { unreadableReceipts: 9 }, { privateNote: "private-canary" },
      { observedAt: "2026-09-28T05:59:59.999999Z" }, { state: "healthy" }].map(change => ({ ...base, observation: { ...base.observation, ...change } }))])
    assert.throws(() => readWeeklyRehearsalReport(bytes(JSON.stringify(value))));
});
test("explicit local File selection renders a dated claim without uploading, filenames or receipt writes", async () => {
  const fetch = globalThis.fetch; let calls = 0; globalThis.fetch = () => { calls++; throw new Error("Upload refused"); };
  const ui = weeklyReportHarness();
  try {
    ui.mount(); assert.match(ui.markup(), /No local report/); assert.equal(calls, 0);
    select(ui, file()); assert.match(ui.markup(), /Checking the selected/); await tick();
    assert.match(ui.markup(), /2026-W40/); assert.match(ui.markup(), /8 recorded receipts/);
    assert.match(ui.markup(), /dated claim, not an authenticated receipt or a current inspection/);
    assert.doesNotMatch(ui.markup(), /private-name-canary/); assert.equal(calls, 0);
    ui.button().onClick(); assert.match(ui.markup(), /No local report/); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
  } finally { ui.unmount(); globalThis.fetch = fetch; }
});
test("oversize metadata is refused before reading and invalid selection removes earlier contents", async () => {
  const ui = weeklyReportHarness(); let slices = 0;
  try {
    ui.mount(); select(ui, file()); await tick(); assert.match(ui.markup(), /8 recorded receipts/);
    select(ui, { size: WEEKLY_REPORT_BYTE_LIMIT + 1, slice() { slices++; throw new Error("Must not read"); } });
    assert.equal(slices, 0); await tick(); assert.match(ui.markup(), /Earlier report contents are withheld/); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
    select(ui, new File(["not json"], "private-name-canary.json")); await tick(); assert.match(ui.markup(), /could not be read/);
    select(ui); assert.match(ui.markup(), /No local report/);
  } finally { ui.unmount(); }
});
test("bounded read refuses length disagreement and suppresses arbitrary read errors", async () => {
  const ui = weeklyReportHarness(); const buffer = bytes(exportWeeklyRehearsal(assessment()).body);
  try {
    ui.mount(); select(ui, { size: buffer.byteLength - 1, slice(start, end) {
      assert.equal(start, 0); assert.equal(end, WEEKLY_REPORT_BYTE_LIMIT + 1); return { arrayBuffer: async () => buffer };
    } }); await tick(); assert.match(ui.markup(), /could not be read/);
    select(ui, { size: 2, slice() { return { arrayBuffer: async () => { throw new Error("private-error-canary"); } }; } });
    await tick(); assert.match(ui.markup(), /could not be read/); assert.doesNotMatch(ui.markup(), /private-error-canary/);
  } finally { ui.unmount(); }
});
test("older asynchronous reads cannot restore contents after another selection, clearing or unmount", async () => {
  const ui = weeklyReportHarness(); const buffer = bytes(exportWeeklyRehearsal(assessment()).body); let resolve;
  const delayed = { size: buffer.byteLength, slice() { return { arrayBuffer: () => new Promise(done => { resolve = done; }) }; } };
  try {
    ui.mount(); select(ui, delayed); select(ui, new File(["bad json"], "private-name-canary.json")); await tick(); resolve(buffer); await tick();
    assert.match(ui.markup(), /Choose the file again/); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
    select(ui, new File(["bad json"], "private-name-canary.json")); await tick();
    assert.match(ui.markup(), /could not be read/); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
    select(ui, delayed); ui.button().onClick(); resolve(buffer); await tick(); assert.match(ui.markup(), /No local report/);
    select(ui, delayed); const oldInput = ui.input().onChange; ui.unmount(); resolve(buffer); await tick(); assert.doesNotMatch(ui.markup(), /8 recorded receipts/);
    let slices = 0; oldInput({ currentTarget: { files: [{ size: 2, slice() { slices++; } }], value: "" } }); assert.equal(slices, 0);
  } finally { ui.unmount(); }
});
