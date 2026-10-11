import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execute = promisify(execFile);
const checker = new URL("../scripts/check_private_build_assets.mjs", import.meta.url).pathname;
async function trial(t, payload) {
  const directory = await mkdtemp(join(tmpdir(), "tf-build-assets-test-"));
  t.after(() => rm(directory, { recursive: true, force: true })); // Exclusive test scratch only.
  if (payload !== undefined) {
    await mkdir(join(directory, ".next", "server"), { recursive: true });
    await writeFile(join(directory, ".next", "server", "page.js.nft.json"), JSON.stringify(payload));
  }
  // The child is the ordinary build CLI, not another Node test-runner worker.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  return () => execute(process.execPath, [checker], { cwd: directory, env, timeout: 5000, maxBuffer: 4096 });
}
test("the real build gate accepts ordinary assets and emits no private paths", async (t) => {
  const run = await trial(t, { version: 1, files: ["../../../node_modules/next/server.js", "../../../src/public-issue-projection.ts"] });
  const { stdout } = await run();
  assert.deepEqual(JSON.parse(stdout), { evidenceKind: "production_trace_private_archive_boundary", tracesChecked: 1, privateFilesIncluded: 0, browserVerified: false });
});
test("the actual checker rejects each forbidden archive in POSIX and Windows trace paths", async (t) => {
  for (const name of [".local-connected-reader", ".local-fictional-runs", ".local-connected-trial", "ssb-14059-raw", "TerraFracta-private-trials"]) {
    for (const path of [`../../../${name}/private-canary.json`, `..\\..\\${name}\\private-canary.json`]) {
      const run = await trial(t, { files: [path] });
      await assert.rejects(run(), (error) => error.code === 1 && !error.stdout && !error.stderr.includes("private-canary"));
    }
  }
});
test("missing or invalid generated traces cannot count as a passed build boundary", async (t) => {
  for (const payload of [undefined, { files: "not-an-array" }, { files: [42] }]) {
    const run = await trial(t, payload); await assert.rejects(run());
  }
});
