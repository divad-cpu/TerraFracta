import { parseNativeWorkerJson } from "./native-worker-json.ts";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { promisify } from "node:util";
import { parseFictionalUpdateResult, type FictionalUpdateResult, type FictionalUpdateScenario } from "../fictional-update-result.ts";
import { hasLocalDevelopmentOrigin } from "./local-development-request.ts";
import { FictionalArchiveCapacityError } from "./fictional-receipt-store.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

type Trigger = "manual" | "scheduled";
type Scenario = FictionalUpdateScenario;
type Runner = (trigger: Trigger, signal: AbortSignal, scenario: Scenario) => Promise<unknown>;
const execute = promisify(execFile);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
// Reuse the existing private operation's process-global slot pattern. A fresh
// server module must not recreate capacity while an older module owns work.
const operationKey = Symbol.for("terrafracta.fictional-update.operation.v1");
type OperationSlot = { running: boolean; workerBusy: boolean };
const operationSlots = globalThis as typeof globalThis & { [operationKey]?: OperationSlot };
const operationSlot = operationSlots[operationKey] ??= { running: false, workerBusy: false };

// Fixed module and argument list. The browser cannot choose a command, file,
// source, mode, credential, scope or cap. This is not a live update endpoint.
export async function runFictionalWorker(trigger: Trigger, signal: AbortSignal, scenario: Scenario): Promise<unknown> {
  if (signal.aborted || operationSlot.workerBusy) throw new Error("rehearsal_unavailable");
  operationSlot.workerBusy = true;
  let spawned = false;
  try {
    const pending = execute("uv", [
    "run", "--locked", "--offline", "--no-sync", "--no-python-downloads", "--no-env-file",
    "python", "-B", "-m", "scripts.update_rehearsal",
    "--trigger", trigger, "--scenario", scenario,
  ], { cwd: process.cwd(), encoding: null, timeout: 15_000, maxBuffer: 64 * 1024, signal });
    // Abort callbacks can settle before the native process/stdio close event.
    spawned = true;
    pending.child.once("close", () => { operationSlot.workerBusy = false; });
    const { stdout } = await pending;
    return parseNativeWorkerJson(stdout, 64 * 1024);
  } finally {
    // A failed synchronous setup owns no child. Once spawned, only observed
    // native close releases capacity; a logical error never grants a new slot.
    if (!spawned) operationSlot.workerBusy = false;
  }
}

function failure(status: number, code: string): Response {
  return Response.json({ error: code }, { status, headers });
}

async function readOperation(request: Request): Promise<{ trigger: Trigger; scenario: Scenario } | null> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 128)) return null;
  if (!request.body) return null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    // An owned native reader may already have released its lock. Retirement
    // remains best effort; neither synchronous nor asynchronous failure escapes.
    try { void reader?.cancel().catch(() => {}); } catch { /* no raw error */ }
  };
  try {
    const started = performance.now();
    if (!Number.isFinite(started)) return null;
    const elapsedRead = createElapsedReadClock(() => performance.now(), started);
    reader = request.body.getReader();
    const bytes = new Uint8Array(128);
    let size = 0;
    let timedOut = false;
    const expired = () => {
      const elapsed = elapsedRead();
      return timedOut || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 2_000;
    };
    timer = setTimeout(() => { timedOut = true; cancel(); }, 2_000);
    while (true) {
      const { done, value } = await reader.read();
      // A delayed timer callback cannot admit a late chunk or EOF.
      if (expired()) { cancel(); return null; }
      if (done) break;
      // Snapshot actual native bytes before the next producer read.
      size += copyNativeByteChunk(bytes, size, value);
    }
    if (expired()) return null;
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
    // A deliberately tiny JSON grammar rejects extra/duplicate fields and
    // escapes; it offers two literal triggers and four fixed examples.
    const match = /^\s*\{\s*"trigger"\s*:\s*"(manual|scheduled)"\s*(?:,\s*"scenario"\s*:\s*"(standard|missing_source|invalid_citation|revised_value)"\s*)?\}\s*$/.exec(body);
    return match && !expired() ? { trigger: match[1] as Trigger, scenario: (match[2] ?? "standard") as Scenario } : null;
  } catch {
    cancel();
    return null;
  } finally {
    // One failed retirement must not prevent the other owned resource attempt.
    try { if (timer !== undefined) clearTimeout(timer); } catch { /* no raw error */ }
    try { reader?.releaseLock(); } catch { /* no raw error */ }
  }
}

export async function handleFictionalUpdateRequest(
  request: Request,
  environment: string | undefined,
  run: Runner = runFictionalWorker,
  archive?: (result: FictionalUpdateResult) => Promise<void>,
  record: DevelopmentErrorRecorder = recordDevelopmentError,
): Promise<Response> {
  if (environment !== "development") return failure(404, "not_found");
  // Next's internal request URL may use its configured "localhost" even when
  // the browser used 127.0.0.1. Check the actual HTTP authority separately,
  // without trusting forwarded-host headers or allowing a foreign hostname.
  if (request.method !== "POST") return failure(405, "method_not_allowed");
  if (!hasLocalDevelopmentOrigin(request)) {
    return failure(403, "local_origin_required");
  }
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
    return failure(415, "json_required");
  }
  if (request.signal.aborted) return failure(409, "request_cancelled");
  const operation = await readOperation(request);
  if (request.signal.aborted) return failure(409, "request_cancelled");
  if (!operation) return failure(400, "invalid_rehearsal_request");
  const { trigger, scenario } = operation;
  if (operationSlot.running || operationSlot.workerBusy) return failure(429, "rehearsal_busy");
  operationSlot.running = true;
  try {
    const started = performance.now();
    if (!Number.isFinite(started)) throw new Error("rehearsal_unavailable");
    const elapsedOperation = createElapsedReadClock(() => performance.now(), started);
    const report = await run(trigger, request.signal, scenario);
    const result = parseFictionalUpdateResult({
      execution: {
        id: randomUUID(), kind: "local_fictional", scenario, executedAt: new Date().toISOString(),
        durationMs: Math.round(elapsedOperation()),
      },
      report,
    });
    if (result.report.trigger !== trigger) throw new Error("Rehearsal trigger mismatch");
    await archive?.(result);
    return Response.json(result, { headers });
  } catch (error) {
    // Observe without serializing the worker/SQL/error or changing the response.
    if (!(error instanceof FictionalArchiveCapacityError) && !request.signal.aborted)
      observeDevelopmentError("update_operation", record);
    return failure(503, error instanceof FictionalArchiveCapacityError ? "fictional_archive_full" : "rehearsal_unavailable");
  } finally {
    operationSlot.running = false;
  }
}
