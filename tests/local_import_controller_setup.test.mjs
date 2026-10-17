import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const variant of ["diagnostic", "selected", "earlier", "scope"]) test(`${variant} local file controller setup refusal is opaque, dispatches no read and permits explicit recovery`, () => {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./helpers/local_import_setup_probe.mjs", import.meta.url)), variant],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 10_000, maxBuffer: 128 * 1024 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.deepEqual(result, { variant, unhandledRejections: 0, controllerCalls: 1, fileReads: 0, transportCalls: 0,
    held: true, selectable: true, inputReset: true, privateLeak: false, recovered: true, recoveryReads: 1,
    totalUnhandledRejections: 0, totalTransportCalls: 0 });
});
