import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const variant of ["parent", "copy", "preparation", "manual", "supervised"]) test(`${variant} read-only observation controller setup failure is held without dispatch or unhandled rejection`, () => {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./helpers/observation_setup_probe.mjs", import.meta.url)), variant],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 10_000, maxBuffer: 128 * 1024 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { variant, unhandledRejections: 0, controllerCalls: 1, transportCalls: 0,
    held: true, selectable: true, privateLeak: false, recoveryReads: 1, recoveryHeld: true,
    recoverySelectable: true, invalidTransport: false, retiredReads: 1, totalUnhandledRejections: 0 });
});
