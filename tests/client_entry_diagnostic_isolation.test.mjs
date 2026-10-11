import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { installClientErrorListeners, observeClientError } from "../src/client-error-diagnostics.ts";
import { withLocalRequestDeadline } from "../src/local-request-deadline.ts";
import { parsePrivateCustodianOperationStatus } from "../src/private-custodian-operation.ts";

const turn = () => new Promise(resolve => setImmediate(resolve));
function requestHarness(report) {
  const file = new URL("../src/private-custodian-request.ts", import.meta.url);
  const native = createRequire(file), exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", code)(name => name.endsWith("client-error-diagnostics.ts") ? {
    reportClientError: report, observeClientError: code => observeClientError(code, report),
  } : name.endsWith("local-request-deadline.ts") ? { withLocalRequestDeadline } :
    name.endsWith("private-custodian-operation.ts") ? { parsePrivateCustodianOperationStatus } : native(name), exports);
  return exports.requestPrivateCustodianStatus;
}

test("custodian request keeps its original refusal when its diagnostic reporter fails", async t => {
  const original = new Error("original-request-canary");
  t.mock.method(globalThis, "fetch", async () => { throw original; });
  const codes = [];
  const request = requestHarness(code => { codes.push(code); throw new Error("reporter-canary"); });
  await assert.rejects(request("POST", new AbortController().signal), error => error === original);
  await turn();assert.deepEqual(codes, ["custodian_request"]);
});

test("global error listeners contain a synchronously failing reporter without inspecting event fields", async () => {
  const listeners = new Map(), codes = [], removed = [];
  const target = { addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => removed.push([name, callback]) };
  const uninstall = installClientErrorListeners(target, code => { codes.push(code); throw new Error("reporter-canary"); });
  const poison = new Proxy({}, { get() { assert.fail("event fields must remain unread"); } });
  assert.doesNotThrow(() => listeners.get("error")(poison));
  assert.doesNotThrow(() => listeners.get("unhandledrejection")(poison));
  await turn();assert.deepEqual(codes, ["browser_runtime", "browser_promise"]);
  uninstall();assert.equal(removed.length, 2);
});
