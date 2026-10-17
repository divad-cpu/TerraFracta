import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
function probe(mode) {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./helpers/weekly_status_fault_probe.mjs", import.meta.url)), mode],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 10_000, maxBuffer: 128 * 1024 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  const value = JSON.parse(child.stdout); assert.equal(value.mode, mode);
  assert.equal(value.unhandled, 0); assert.equal(value.invalidTransport, false); assert.equal(value.privateLeak, false); return value;
}
for (const mode of ["setup", "observed", "retired"]) test(`weekly ${mode} allocation refusal withholds old status and export without dispatch`, () => {
  const value = probe(mode); assert.equal(value.refusalReads, 0); assert.equal(value.controllerCalls, 1);
  assert.equal(value.oldResultWithheld, true); assert.equal(value.oldExportWithheld, true);
  if (mode !== "retired") assert.equal(value.oldNoticeWithheld, true);
  assert.equal(value.retainedDownloadAllocations, 0); assert.equal(value.recoveryObserved, true); assert.equal(value.recoverySelectable, true);
  assert.equal(value.recoveryReads, mode === "setup" ? 1 : 2);
  if (mode === "retired") assert.equal(value.retiredSetupWrites, 0); else assert.equal(value.held, true);
});
for (const mode of ["layout", "passive", "native"]) test(`weekly ${mode} cleanup keeps the unsettled response owned despite abort failure`, () => {
  const value = probe(mode); assert.equal(value.escaped, false); assert.equal(value.otherCleanupEscaped, false);
  assert.equal(value.outerSignalAborted, mode === "native"); assert.equal(value.aborts, mode === "native" ? 0 : 1);
  assert.equal(value.retiredControlWrites, 0); assert.equal(value.waitingDisabled, true);
  for (const key of ["requestsWhileWaiting", "requestsAfterSettlement", "requestsAfterOldControl"]) assert.equal(value[key], 1, key);
  assert.equal(value.availableAfterSettlement, true); assert.equal(value.oldResultWithheld, true);
  assert.equal(value.recoveryReads, 2); assert.equal(value.recoveryObserved, true);
});
test("weekly native refresh keeps valid dated status recoverable and retires an old export callback", () => {
  const value = probe("valid"); assert.equal(value.initialObserved, true); assert.equal(value.initialDownload, 1);
  assert.equal(value.refusalReads, 1); assert.equal(value.controllerCalls, 0); assert.equal(value.retainedDownloadAllocations, 0);
  assert.equal(value.oldResultWithheld, true); assert.equal(value.oldExportWithheld, true); assert.equal(value.oldNoticeWithheld, true);
  assert.equal(value.recoveryReads, 2); assert.equal(value.recoveryObserved, true); assert.equal(value.recoverySelectable, true);
});
