import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
for (const mode of ["initial", "retired", "reentrant", "pending-get", "pending-post", "native"])
  test(`custodian observation ${mode} setup refuses opaque failure without dispatch or lost physical ownership`, () => {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./helpers/custodian_observation_setup_probe.mjs", import.meta.url)), mode],
      { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 10_000, maxBuffer: 128 * 1024 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
    const v = JSON.parse(child.stdout); assert.equal(v.mode, mode); assert.equal(v.escaped, false);
    assert.equal(v.unhandled, 0); assert.equal(v.invalidTransport, false); assert.equal(v.privateLeak, false); assert.deepEqual(v.codes, []);
    assert.equal(v.recoveredIdle, true);
    if (mode === "retired" || mode === "reentrant") assert.equal(v.outerWrites, 0);
    if (mode === "initial" || mode.startsWith("pending")) { assert.equal(v.held, true); assert.equal(v.disabled, true); }
    assert.equal(v.beforeRecoveryRequests, mode === "pending-post" ? 2 : mode === "initial" || mode === "retired" ? 0 : 1);
    if (mode.startsWith("pending")) { assert.equal(v.afterOldSettlementRequests, v.beforeRecoveryRequests); assert.equal(v.oldResultWithheld, true); }
    assert.equal(v.finalGets, mode.startsWith("pending") ? 2 : 1); assert.equal(v.finalPosts, mode === "pending-post" ? 1 : 0);
  });
