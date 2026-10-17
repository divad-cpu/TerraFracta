import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
function probe(mode) {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./helpers/history_fault_probe.mjs", import.meta.url)), mode],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 10_000, maxBuffer: 128 * 1024 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  const value = JSON.parse(child.stdout); assert.equal(value.mode, mode); assert.equal(value.unhandled, 0);
  assert.equal(value.invalidTransport, false); assert.equal(value.privateLeak, false); assert.equal(value.diagnosticCalls, 0); return value;
}
for (const mode of ["setup", "loaded", "retired"]) test(`history ${mode} allocation refusal withholds old rows and retained selections without a GET`, () => {
  const value = probe(mode); assert.equal(value.refusalReads, 0); assert.equal(value.oldRowsWithheld, true);
  assert.equal(value.retainedRowSelections, 0); assert.equal(value.recoveryReads, mode === "setup" ? 1 : 2);
  assert.equal(value.recoveryRows, true); assert.equal(value.recoverySelectable, true);
  if (mode === "retired") assert.equal(value.retiredWrites, 0); else assert.equal(value.held, true);
});
for (const mode of ["layout", "passive", "native"]) test(`history ${mode} cleanup keeps its original page response occupied until settlement`, () => {
  const value = probe(mode); assert.equal(value.escaped, false); assert.equal(value.otherCleanupEscaped, false);
  assert.equal(value.outerSignalAborted, mode === "native"); assert.equal(value.aborts, mode === "native" ? 0 : 1);
  assert.equal(value.retiredControlWrites, 0); assert.equal(value.waitingDisabled, true);
  for (const key of ["requestsWhileWaiting", "requestsAfterSettlement", "requestsAfterOldControl"]) assert.equal(value[key], 1, key);
  assert.equal(value.oldRowsWithheld, true); assert.equal(value.availableAfterSettlement, true);
  assert.equal(value.recoveryReads, 2); assert.equal(value.recoveryRows, true);
});
test("history native refresh retires an old row and preserves exact valid pagination", () => {
  const value = probe("valid"); assert.equal(value.initialRows, true); assert.equal(value.refusalReads, 1);
  assert.equal(value.oldRowsWithheld, true); assert.equal(value.retainedRowSelections, 0);
  assert.equal(value.recoveryReads, 2); assert.equal(value.recoveryRows, true); assert.equal(value.recoverySelectable, true);
});
