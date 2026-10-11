// Actual default Python/native runner through the request handler in-process.
// No Browser access, hosted HTTP server, real source or primary database.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPrivateCustodianHandler, runFixedInventedCustodian, inspectFixedInventedCustodian,
  privateCustodianEnvironment } from "../src/server/private-custodian-operation.ts";
import { parsePrivateCustodianOperationStatus } from "../src/private-custodian-operation.ts";

if (process.argv.length !== 2) throw new Error("Fixed invented bridge check accepts no arguments");
let calls = 0;
const operation = { inspect: inspectFixedInventedCustodian,
  start: async () => { calls++; return runFixedInventedCustodian(); } };
const handle = createPrivateCustodianHandler(operation);
const base = "http://127.0.0.1:3000";
function request(method) {
  return new Request(`${base}/api/dev/private-custodian`, { method,
    headers: { origin: base, "content-type": "application/json" },
    ...(method === "POST" ? { body: '{"action":"run_invented_custodian"}' } : {}) });
}
const before = parsePrivateCustodianOperationStatus(await (await handle(request("GET"), "development")).json());
assert.ok(["idle", "checked"].includes(before.state), "An incomplete retained operation must be inspected manually");
const fresh = before.state === "idle";
const first = await handle(request("POST"), "development");
assert.equal(first.status, fresh ? 202 : 200);
await handle(request("POST"), "development");
const deadline = Date.now() + 75_000;
let status;
while (true) {
  status = parsePrivateCustodianOperationStatus(await (await handle(request("GET"), "development")).json());
  if (status.state !== "running") break;
  if (Date.now() >= deadline) throw new Error("Fixed invented bridge check did not finish");
  await delay(100);
}
assert.equal(status.state, "checked");
assert.equal(calls, fresh ? 1 : 0);
const repeated = await (await handle(request("POST"), "development")).json();
assert.deepEqual(repeated, status);assert.equal(calls, fresh ? 1 : 0);
// A distinct Node process has no inherited global slot. It runs only GET and
// reopens the retained Python status; no Browser/HTTP server is involved.
const execute = promisify(execFile);
const { stdout } = await execute(process.execPath, ["--experimental-strip-types", "scripts/inspect_private_custodian_web_bridge.mjs"],
  { cwd: process.cwd(), encoding: "utf8", timeout: 10_000, maxBuffer: 16 * 1024, env: privateCustodianEnvironment() });
assert.deepEqual(parsePrivateCustodianOperationStatus(JSON.parse(stdout)), status);
assert.equal((await handle(request("POST"), "production")).status, 404);
assert.doesNotMatch(JSON.stringify(status), /privateEvidenceDirectory|sourceFingerprint|rawBody|password|\/home\/dj/);
console.log(JSON.stringify({ evidenceKind: "actual_in_process_private_custodian_web_bridge", observedAt: new Date().toISOString(),
  freshTrialStarted: fresh, startInvocations: calls, savedPairs: status.result.savedPairs, sourceChecks: status.result.sourceChecks,
  distinctNodeProcessReopenedSameResult: true, retainedResultRecordedAt: status.result.recordedAt,
  repeatedRequestStartedAnotherTrial: false, originalHttpModuleExecuted: false, actualSourceRequests: 0,
  resultState: status.result.state, privateFieldsReturned: false, publicationEnabled: false,
  hostedHttpVerified: false, browserVerified: false }, null, 2));
