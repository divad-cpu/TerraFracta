import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
for (const variant of ["parent", "copy", "preparation", "manual", "supervised"])
  for (const retirement of ["layout", "passive", "native"])
    test(`${variant} ${retirement} retirement keeps observation cleanup quiet and the physical response owned`, () => {
      const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./helpers/observation_abort_probe.mjs", import.meta.url)), variant, retirement],
        { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 10_000, maxBuffer: 128 * 1024 });
      assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.variant, variant); assert.equal(result.retirement, retirement);
      assert.equal(result.escaped, false); assert.equal(result.otherCleanupEscaped, false);
      assert.equal(result.outerSignalAborted, retirement === "native");
      assert.equal(result.aborts, retirement === "native" ? 0 : 1);
      for (const key of ["retiredControlWrites", "unhandled"]) assert.equal(result[key], 0, key);
      for (const key of ["requestsBeforeReadmission", "requestsWhileWaiting", "requestsAfterOldControl"]) assert.equal(result[key], 1, key);
      for (const key of ["waitingDisabled", "availableAfterSettlement", "oldResultWithheld", "recoveryHeld"]) assert.equal(result[key], true, key);
      assert.equal(result.explicitRecoveryReads, 2); assert.equal(result.invalidTransport, false); assert.equal(result.privateLeak, false);
    });
