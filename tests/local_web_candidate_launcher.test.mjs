import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
async function packet(t) {
  const root = await mkdtemp(join(tmpdir(), "terrafracta-launcher-test-"));
  t.after(() => rm(root, { recursive: true }));
  await copyFile(new URL("../scripts/local_web_candidate_launcher.mjs", import.meta.url), join(root, "start-local.mjs"));
  await writeFile(join(root, "server.js"), "console.log(JSON.stringify({ cwd:process.cwd(), env:process.env }));\n");
  return root;
}

test("local launcher clears inherited server settings before loading the server", async (t) => {
  const root = await packet(t);
  const { stdout } = await execute(process.execPath, [join(root, "start-local.mjs")], {
    env: { HOSTNAME: "0.0.0.0", PORT: "9000", NODE_ENV: "development", PRIVATE_CANARY: "invented-private-value" },
  });
  assert.deepEqual(JSON.parse(stdout), { cwd: root, env: {
    NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: "3210", NEXT_TELEMETRY_DISABLED: "1",
  } });
  assert.equal((await readFile(join(root, "server.js"), "utf8")).includes("console.log"), true);
});

test("local launcher refuses arguments before loading the server", async (t) => {
  const root = await packet(t);
  await assert.rejects(execute(process.execPath, [join(root, "start-local.mjs"), "--hostname=0.0.0.0"], { env: {} }),
    (error) => error.stdout === "" && /accepts no arguments/.test(error.stderr));
});
