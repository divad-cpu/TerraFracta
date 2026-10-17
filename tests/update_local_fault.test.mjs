import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
function probe(mode) {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./helpers/update_fault_probe.mjs", import.meta.url)), mode],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 10_000, maxBuffer: 128 * 1024 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  const value = JSON.parse(child.stdout); assert.equal(value.mode, mode); assert.equal(value.unhandled, 0);
  assert.equal(value.invalidTransport, false); assert.equal(value.privateLeak, false); return value;
}
for (const mode of ["setup", "saved", "retired", "changed"]) test(`update ${mode} allocation refusal starts no request and preserves current intent`, () => {
  const value = probe(mode); assert.equal(value.refusalRequests, 0); assert.equal(value.recoveryRequests, 1);
  assert.equal(value.recoveryFresh, true); assert.equal(value.recoverySelectable, true); assert.ok(value.prevented >= 2);
  if (mode === "retired") assert.equal(value.refusalWrites, 0);
  else if (mode === "changed") { assert.equal(value.refusalWrites, 1); assert.equal(value.choiceAfterFault, "revised_value"); assert.equal(value.held, false); }
  else { assert.equal(value.held, true); assert.equal(value.noDispatchNotice, true); }
  if (mode === "saved") { assert.equal(value.initialSaved, true); assert.equal(value.savedPreserved, true); }
});
for (const mode of ["layout", "passive", "native"]) test(`update ${mode} cleanup retains an unresolved fictional request and withholds its late result`, () => {
  const value = probe(mode); assert.equal(value.escaped, false); assert.equal(value.otherCleanupEscaped, false);
  assert.equal(value.outerSignalAborted, mode === "native"); assert.equal(value.aborts, mode === "native" ? 0 : 1);
  assert.equal(value.retiredControlWrites, 0); assert.equal(value.waitingDisabled, true);
  for (const key of ["requestsWhileWaiting", "requestsAfterSettlement", "requestsAfterOldControl"]) assert.equal(value[key], 1, key);
  assert.equal(value.oldResultWithheld, true); assert.equal(value.availableAfterSettlement, true);
  assert.equal(value.recoveryRequests, 2); assert.equal(value.recoveryFresh, true); assert.ok(value.prevented >= 4);
});
test("update native request keeps the exact invented request and receipt behavior", () => {
  const value = probe("valid"); assert.equal(value.refusalRequests, 1); assert.equal(value.held, false);
  assert.equal(value.recoveryRequests, 1); assert.equal(value.recoveryFresh, true); assert.equal(value.recoverySelectable, true);
});
