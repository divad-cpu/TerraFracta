import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
function probe(mode) {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./helpers/custodian_fault_probe.mjs", import.meta.url)), mode],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 10_000, maxBuffer: 128 * 1024 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  const v = JSON.parse(child.stdout); assert.equal(v.mode, mode); assert.equal(v.unhandled, 0);
  assert.equal(v.invalidTransport, false); assert.equal(v.privateLeak, false); assert.deepEqual(v.codes, []); return v;
}
for (const mode of ["get-layout", "get-passive", "get-native", "post-layout", "post-passive", "post-native", "get-error", "post-error"])
  test(`custodian ${mode} retirement preserves physical slots and denies late observation or start admission`, () => {
    const v = probe(mode), post = mode.startsWith("post");
    assert.equal(v.escaped, false); assert.equal(v.otherCleanupEscaped, false); assert.equal(v.retiredControlWrites, 0);
    assert.equal(v.retirementHadNoWrites, true); assert.equal(v.outerSignalAborted, mode.endsWith("native"));
    assert.equal(v.waitingDisabled, true); assert.equal(v.beforeSettlementRequests, post ? 2 : 1);
    assert.equal(v.afterSettlementRequests, post ? 3 : 2); assert.equal(v.freshObservationPending, true);
    assert.equal(v.oldResultWithheld, true); assert.equal(v.freshIdleAdmitted, true); assert.equal(v.finalPosts, post ? 1 : 0);
  });
for (const mode of ["setup-start", "retired-start"]) test(`custodian ${mode} allocation refusal starts no test and permits only explicit recovery`, () => {
  const v = probe(mode); assert.equal(v.initialAdmitted, true); assert.equal(v.setupPosts, 0); assert.equal(v.recoveryPosts, 1);
  assert.equal(v.recoveryRunning, true);
  if (mode === "retired-start") assert.equal(v.setupWrites, 0); else { assert.equal(v.held, true); assert.equal(v.noPostNotice, true); }
});
