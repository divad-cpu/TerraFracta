import { parseNativeWorkerJson } from "./native-worker-json.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseCurrentPreparationStatus, requireRecentPreparationStatus, type CurrentPreparationStatus } from "../current-private-preparation.ts";
import { correctionReviewObserverEnvironment } from "./correction-review-operation.ts";
import { hasLocalDevelopmentOrigin } from "./local-development-request.ts";
import { createSharedReadObservation } from "./shared-read-observation.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

const execute = promisify(execFile);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff", allow: "GET" };
export async function inspectCurrentPrivatePreparation(): Promise<unknown> {
  const { stdout } = await execute("uv", ["run", "--locked", "--offline", "--no-sync", "--no-env-file", "python", "-B", "-m",
    "scripts.inspect_current_private_preparation"], { cwd: process.cwd(), encoding: null, timeout: 10_000,
    maxBuffer: 16 * 1024, env: correctionReviewObserverEnvironment() });
  return parseNativeWorkerJson(stdout, 16 * 1024);
}

export function createCurrentPreparationObserver(inspect = inspectCurrentPrivatePreparation, now = Date.now,
  record: DevelopmentErrorRecorder = recordDevelopmentError) {
  const observe = createSharedReadObservation<CurrentPreparationStatus>(inspect, input => {
    const value = parseCurrentPreparationStatus(input);
    // Preserve well-formed holds and the existing freshness refusal.
    try { return requireRecentPreparationStatus(value, now()); }
    catch { return { state: "held", reason: "local_observation_unavailable" }; }
  }, () => observeDevelopmentError("preparation_observer", record));
  return async function handle(request: Request, environment: string | undefined): Promise<Response> {
    const fail = (code: number, error: string) => Response.json({ error }, { status: code, headers });
    if (environment !== "development") return fail(404, "not_found");
    if (request.method !== "GET") return fail(405, "method_not_allowed");
    if (!hasLocalDevelopmentOrigin(request, false)) return fail(403, "local_origin_required");
    if (request.signal.aborted) return fail(409, "request_cancelled");
    const current = await observe(request.signal);
    if (current.kind === "cancelled" || request.signal.aborted) return fail(409, "request_cancelled");
    const result = current.kind === "failed" ? { state: "held", reason: "local_observation_unavailable" } : current.value;
    return Response.json(result, { headers });
  };
}
export const handleCurrentPreparationObservation = createCurrentPreparationObserver();
