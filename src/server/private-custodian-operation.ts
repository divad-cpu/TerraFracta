import { parseNativeWorkerJson } from "./native-worker-json.ts";
import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { promisify } from "node:util";
import { parsePrivateCustodianOperationStatus, type PrivateCustodianOperationStatus } from "../private-custodian-operation.ts";
import { hasLocalDevelopmentOrigin } from "./local-development-request.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

const execute = promisify(execFile);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
type Runner = () => Promise<unknown>;
type Operation = { start: Runner; inspect: Runner };
type Slot = { status: PrivateCustodianOperationStatus; completion?: Promise<void>; observation?: Promise<void> };

export function privateCustodianEnvironment(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  // Keep interpreter/cache discovery only. Development secrets, dotenv
  // overrides and Python injection variables do not enter the trial parent.
  return { PATH: parent.PATH, HOME: parent.HOME, NODE_ENV: "development", UV_CACHE_DIR: "/tmp/terrafracta-uv-cache",
    PYTHONDONTWRITEBYTECODE: "1", UV_NO_ENV_FILE: "1" };
}

async function fixedInventedCustodian(action: "inspect" | "start"): Promise<unknown> {
  // Fixed source-free trial. No browser-selected argv, SQL, URL or raw target.
  // A disconnected browser does not kill/restart an already accepted attempt.
  const { stdout } = await execute("uv", ["run", "--locked", "--offline", "--no-sync", "--no-env-file", "python", "-B", "-m",
    action === "start" ? "scripts.persistent_journaled_custodian_display" : "scripts.inspect_persistent_journaled_custodian_display"],
    { cwd: process.cwd(), encoding: null, timeout: action === "start" ? 60_000 : 5_000,
      maxBuffer: 16 * 1024, env: privateCustodianEnvironment() });
  return parseNativeWorkerJson(stdout, 16 * 1024);
}

export const runFixedInventedCustodian = () => fixedInventedCustodian("start");
export const inspectFixedInventedCustodian = () => fixedInventedCustodian("inspect");
const fixedOperation = { start: runFixedInventedCustodian, inspect: inspectFixedInventedCustodian };

async function fixedAction(request: Request): Promise<boolean> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 64)) return false;
  if (!request.body) return false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    // An owned native reader may already have released its lock. Retirement
    // remains best effort; neither synchronous nor asynchronous failure escapes.
    try { void reader?.cancel().catch(() => {}); } catch { /* no raw error */ }
  };
  try {
    const started = performance.now();
    if (!Number.isFinite(started)) return false;
    const elapsedRead = createElapsedReadClock(() => performance.now(), started);
    reader = request.body.getReader();
    let timedOut = false, size = 0;
    const expired = () => {
      const elapsed = elapsedRead();
      return timedOut || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 2_000;
    };
    const bytes = new Uint8Array(64);
    timer = setTimeout(() => { timedOut = true; cancel(); }, 2_000);
    while (true) {
      const { done, value } = await reader.read();
      // A delayed timer callback cannot admit a late chunk or EOF.
      if (expired()) { cancel(); return false; }
      if (done) break;
      // Snapshot actual native bytes before the next producer read.
      size += copyNativeByteChunk(bytes, size, value);
    }
    if (expired()) return false;

    const valid = /^\s*\{\s*"action"\s*:\s*"run_invented_custodian"\s*\}\s*$/.test(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
    return valid && !expired();
  } catch { cancel(); return false; }
  finally {
    // One failed retirement must not prevent the other owned resource attempt.
    try { if (timer !== undefined) clearTimeout(timer); } catch { /* no raw error */ }
    try { reader?.releaseLock(); } catch { /* no raw error */ }
  }
}

export function createPrivateCustodianHandler(operation: Operation = fixedOperation, slot: Slot = { status: { state: "idle" } }, record: DevelopmentErrorRecorder = recordDevelopmentError) {
  return async function handle(request: Request, environment: string | undefined): Promise<Response> {
    const fail = (status: number, code: string) => Response.json({ error: code }, { status, headers });
    if (environment !== "development") return fail(404, "not_found");
    if (!["POST", "GET"].includes(request.method)) return fail(405, "method_not_allowed");
    if (!hasLocalDevelopmentOrigin(request, request.method === "POST")) return fail(403, "local_origin_required");
    if (request.method === "POST") {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return fail(415, "json_required");
      if (!await fixedAction(request)) return fail(400, "invalid_private_test_request");
      if (request.signal.aborted) return fail(409, "request_cancelled");
    }
    if (slot.completion === undefined) {
      // Coalesce reads. GET invokes only the fixed read-only observer. Another
      // app process can have consumed this operation; disk history decides.
      slot.observation ??= Promise.resolve().then(operation.inspect).then((output) => {
        slot.status = parsePrivateCustodianOperationStatus(output);
      }).catch(() => { observeDevelopmentError("server_route", record); slot.status = { state: "held", reason: "private_test_unavailable" }; });
      const observed = slot.observation;
      await observed;
      if (slot.observation === observed) slot.observation = undefined;
    }
    if (request.method === "POST") {
      if (request.signal.aborted) return fail(409, "request_cancelled");
      if (slot.status.state === "idle") {
        // Consume before any process can start. Repeats, browser cancellation
        // and page reloads only read this same attempt; no automatic retry.
        slot.status = { state: "running" };
        slot.completion = Promise.resolve().then(operation.start).then((output) => {
          const status = parsePrivateCustodianOperationStatus(output);
          if (status.state === "idle") throw new Error("Accepted invented operation remained idle");
          slot.status = status;
        }).catch(() => { observeDevelopmentError("server_route", record); slot.status = { state: "held", reason: "private_test_unavailable" }; })
          .finally(() => { slot.completion = undefined; });
      }
    }
    return Response.json(slot.status, { status: slot.status.state === "running" ? 202 : 200, headers });
  };
}

// This slot coalesces work within one process. The private immutable journal
// preserves consumption/results across process restarts; it is not raw custody.
const key = Symbol.for("terrafracta.invented-private-custodian.v4-journaled");
const slots = globalThis as typeof globalThis & { [key]?: Slot };
const slot = slots[key] ??= { status: { state: "idle" } };
export const handlePrivateCustodianRequest = createPrivateCustodianHandler(fixedOperation, slot);
