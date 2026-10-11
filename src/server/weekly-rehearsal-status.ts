import { parseNativeWorkerJson } from "./native-worker-json.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readAllFictionalReceipts } from "./fictional-receipt-store.ts";
import { correctionReviewObserverEnvironment } from "./correction-review-operation.ts";
import { hasLocalDevelopmentOrigin } from "./local-development-request.ts";
import { createSharedReadObservation } from "./shared-read-observation.ts";
import { parseWeeklyRehearsalStatus, requireRecentWeeklyRehearsalStatus, type WeeklyRehearsalStatus } from "../weekly-rehearsal-status.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

const execute = promisify(execFile);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff", allow: "GET" };
export async function inspectWeeklyRehearsal(): Promise<unknown> {
  const inventory = await readAllFictionalReceipts();
  const input = JSON.stringify({ schemaVersion: 1, readComplete: inventory.stableSnapshot,
    totalReceipts: inventory.totalReceipts, unreadableReceipts: inventory.unreadableReceipts,
    pendingReceipts: inventory.pendingReceipts, receipts: inventory.entries.map(entry => ({
      trigger: entry.report.trigger, scope: entry.report.scope, executedAt: entry.execution.executedAt,
      runState: entry.report.state, coveredSourceKeys: entry.report.coveredSourceKeys,
      fixtureDueAt: entry.report.scheduledDueAt,
    })) });
  if (Buffer.byteLength(input) > 65_536) throw new Error("Fictional monitor input exceeds its bound");
  const child = execute("uv", ["run", "--locked", "--offline", "--no-sync", "--no-env-file", "python", "-B", "-m",
    "scripts.weekly_rehearsal_status"], { cwd: process.cwd(), encoding: null, timeout: 5_000,
    maxBuffer: 16 * 1024, env: correctionReviewObserverEnvironment() });
  // An early child exit can close the pipe before all bounded input is sent.
  // Handle that stream error as an unavailable observation, never an uncaught
  // process error or a successfully completed inspection.
  const stdin = child.child.stdin;
  let inputError: Error | undefined;
  stdin?.on("error", error => { inputError = error; });
  stdin?.end(input);
  const { stdout } = await child;
  if (!stdin || inputError || !stdin.writableFinished) throw new Error("Fictional monitor input was not completed");
  return { state: "observed", observation: parseNativeWorkerJson(stdout, 16 * 1024) };
}
export function createWeeklyRehearsalObserver(inspect = inspectWeeklyRehearsal, now = Date.now,
  record: DevelopmentErrorRecorder = recordDevelopmentError) {
  const observe = createSharedReadObservation<WeeklyRehearsalStatus>(inspect, input => {
    const value = parseWeeklyRehearsalStatus(input);
    // Preserve well-formed holds and the existing freshness refusal.
    try { return requireRecentWeeklyRehearsalStatus(value, now()); }
    catch { return { state: "held", reason: "weekly_rehearsal_unavailable" }; }
  }, () => observeDevelopmentError("weekly_status_observer", record));
  return async function handle(request: Request, environment: string | undefined): Promise<Response> {
    const fail = (code: number, error: string) => Response.json({ error }, { status: code, headers });
    if (environment !== "development") return fail(404, "not_found");
    if (request.method !== "GET") return fail(405, "method_not_allowed");
    if (!hasLocalDevelopmentOrigin(request, false)) return fail(403, "local_origin_required");
    if (request.signal.aborted) return fail(409, "request_cancelled");
    const current = await observe(request.signal);
    if (current.kind === "cancelled" || request.signal.aborted) return fail(409, "request_cancelled");
    const result = current.kind === "failed" ? { state: "held", reason: "weekly_rehearsal_unavailable" } : current.value;
    return Response.json(result, { headers });
  };
}
export const handleWeeklyRehearsalStatus = createWeeklyRehearsalObserver();
