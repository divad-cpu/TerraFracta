import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import test from "node:test";
import ts from "typescript";

function worker(invoke) {
  const file = new URL("../src/server/fictional-update-operation.ts", import.meta.url);
  const native = createRequire(file), module = { exports: {} };
  const execFile = () => assert.fail("promisified subprocess contract required");
  // The native promisified execFile returns a promise with its direct child.
  // This owned port preserves that contract without launching a command. Its
  // close event follows logical settlement; physical controls are separate.
  execFile[promisify.custom] = (...args) => {
    const child = new EventEmitter();
    const pending = Promise.resolve().then(() => invoke(...args));
    pending.child = child;
    void pending.then(
      () => queueMicrotask(() => child.emit("close", 0, null)),
      () => queueMicrotask(() => child.emit("close", null, null)),
    );
    return pending;
  };
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  new Function("require", "module", "exports", code)(name => name === "node:child_process" ? { execFile } : native(name), module, module.exports);
  return module.exports.runFictionalWorker;
}
const policy = ["run", "--locked", "--offline", "--no-sync", "--no-python-downloads", "--no-env-file", "python", "-B", "-m", "scripts.update_rehearsal"];

test("fictional child disables uv network, syncing, Python downloads and environment-file loading", async () => {
  let observed;
  const run = worker(async (...args) => { observed = args; return { stdout: Buffer.from('{"invented":true}'), stderr: "" }; });
  assert.deepEqual(await run("manual", new AbortController().signal, "standard"), { invented: true });
  assert.equal(observed[0], "uv");
  assert.deepEqual(observed[1], [...policy, "--trigger", "manual", "--scenario", "standard"]);
});

test("both literal triggers and all four examples share the same bounded offline start", async () => {
  const seen = [];
  const run = worker(async (...args) => { seen.push(args); return { stdout: Buffer.from('{}'), stderr: "" }; });
  for (const trigger of ["manual", "scheduled"]) for (const scenario of ["standard", "missing_source", "invalid_citation", "revised_value"]) {
    await run(trigger, new AbortController().signal, scenario);
    assert.deepEqual(seen.at(-1)[1], [...policy, "--trigger", trigger, "--scenario", scenario]);
  }
  assert.equal(seen.length, 8);
});

test("child preserves the exact parent signal, checkout and original timeout/output bound", async () => {
  const controller = new AbortController(), before = { ...process.env };
  let options;
  const run = worker(async (_file, _args, value) => { options = value; return { stdout: Buffer.from('{}'), stderr: "" }; });
  await run("manual", controller.signal, "standard");
  assert.deepEqual(options, { cwd: process.cwd(), encoding: null, timeout: 15_000, maxBuffer: 64 * 1024, signal: controller.signal });
  assert.deepEqual({ ...process.env }, before);
  assert.equal(controller.signal.aborted, false);
});

test("missing interpreter and rejected child outcome have no bootstrap or second dispatch", async () => {
  for (const code of ["ENOENT", "UV_INTERPRETER_UNAVAILABLE", "ABORT_ERR"]) {
    let calls = 0;
    const failure = Object.assign(new Error("INVENTED_CHILD_REFUSAL"), { code });
    const run = worker(async () => { calls++; throw failure; });
    await assert.rejects(run("manual", new AbortController().signal, "standard"), value => value === failure);
    assert.equal(calls, 1);
  }
});

test("only stdout JSON is consumed and malformed output cannot dispatch a fallback", async () => {
  let calls = 0;
  const run = worker(async () => { calls++; return { stdout: Buffer.from('{}'), stderr: "INVENTED_UNTRUSTED_TEXT" }; });
  assert.deepEqual(await run("scheduled", new AbortController().signal, "standard"), {});
  const invalid = worker(async () => { calls++; return { stdout: Buffer.from("not JSON"), stderr: "INVENTED_UNTRUSTED_TEXT" }; });
  await assert.rejects(invalid("scheduled", new AbortController().signal, "standard"), SyntaxError);
  assert.equal(calls, 2);
});
