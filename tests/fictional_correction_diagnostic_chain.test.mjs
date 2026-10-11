import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("actual default workflow observer reaches existing intake private export saved reader filter and presenter", async t => {
  const parent = await mkdtemp("/tmp/terrafracta-fictional-workflow-diagnostics-");
  const run = spawnSync(process.execPath, ["--experimental-strip-types",
    fileURLToPath(new URL("./helpers/fictional_workflow_diagnostic_process.mjs", import.meta.url)), parent], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 10_000,
    maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, NODE_ENV: "development" },
  });
  assert.ifError(run.error); assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.events, 8); assert.equal(result.distinctFunctions, 8);
  assert.equal(result.networkRequests, 0); assert.equal(result.browserVerified, false);
  assert.deepEqual(JSON.parse(await readFile(`${parent}/RESULT.json`, "utf8")), result);
  t.diagnostic(JSON.stringify({ ownedTemporaryDirectory: parent, privateExport: `${parent}/export.json`, result }));
});
