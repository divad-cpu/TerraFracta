import { parseNativeWorkerJson } from "./native-worker-json.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseCorrectionReviewOperationStatus, type ReviewObservation } from "../correction-review-operation.ts";
import { hasLocalDevelopmentOrigin } from "./local-development-request.ts";
import { createSharedReadObservation } from "./shared-read-observation.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

const execute = promisify(execFile);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff", allow: "GET" };
type Observer = () => Promise<unknown>;
type ReviewObserverCode = "correction_review_observer" | "supervised_review_observer";

export function correctionReviewObserverEnvironment(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  // Reuse the fixed observer's restricted interpreter/cache environment. No
  // credentials, dotenv/Node/Python injection or client-selected argv enters it.
  return { PATH: parent.PATH, HOME: parent.HOME, NODE_ENV: "development", UV_CACHE_DIR: "/tmp/terrafracta-uv-cache",
    PYTHONDONTWRITEBYTECODE: "1", UV_NO_ENV_FILE: "1" };
}

export async function inspectFixedCorrectionReview(): Promise<unknown> {
  const { stdout } = await execute("uv", ["run", "--locked", "--offline", "--no-sync", "--no-env-file", "python", "-B", "-m",
    "scripts.inspect_persistent_correction_review_display"],
    { cwd: process.cwd(), encoding: null, timeout: 5_000, maxBuffer: 16 * 1024, env: correctionReviewObserverEnvironment() });
  return parseNativeWorkerJson(stdout, 16 * 1024);
}

export function createCorrectionReviewObserver(inspect: Observer = inspectFixedCorrectionReview,
  parseStatus: (input: unknown) => ReviewObservation = parseCorrectionReviewOperationStatus,
  record: DevelopmentErrorRecorder = recordDevelopmentError,
  code: ReviewObserverCode = "correction_review_observer") {
  const observe = createSharedReadObservation(inspect, parseStatus, () => observeDevelopmentError(code, record));
  return async function handle(request: Request, environment: string | undefined): Promise<Response> {
    const fail = (status: number, error: string) => Response.json({ error }, { status, headers });
    if (environment !== "development") return fail(404, "not_found");
    if (request.method !== "GET") return fail(405, "method_not_allowed");
    if (!hasLocalDevelopmentOrigin(request, false)) return fail(403, "local_origin_required");
    if (request.signal.aborted) return fail(409, "request_cancelled");
    const current = await observe(request.signal);
    if (current.kind === "cancelled" || request.signal.aborted) return fail(409, "request_cancelled");
    const status = current.kind === "failed" ? { state: "held", reason: "private_test_unavailable" } : current.value;
    return Response.json(status, { status: status.state === "running" ? 202 : 200, headers });
  };
}

export const handleCorrectionReviewObservation = createCorrectionReviewObserver();
