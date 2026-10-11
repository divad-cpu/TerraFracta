import { parseNativeWorkerJson } from "./native-worker-json.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseSupervisedCorrectionReviewOperationStatus } from "../correction-review-operation.ts";
import { correctionReviewObserverEnvironment, createCorrectionReviewObserver } from "./correction-review-operation.ts";
import { recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

const execute = promisify(execFile);
type Observer = () => Promise<unknown>;

export async function inspectFixedSupervisedCorrectionReview(): Promise<unknown> {
  const { stdout } = await execute("uv", ["run", "--locked", "--offline", "--no-sync", "--no-env-file", "python", "-B", "-m",
    "scripts.inspect_current_supervised_correction_review"],
    { cwd: process.cwd(), encoding: null, timeout: 5_000, maxBuffer: 16 * 1024, env: correctionReviewObserverEnvironment() });
  return parseNativeWorkerJson(stdout, 16 * 1024);
}

export function createSupervisedCorrectionReviewObserver(inspect: Observer = inspectFixedSupervisedCorrectionReview,
  record: DevelopmentErrorRecorder = recordDevelopmentError) {
  return createCorrectionReviewObserver(inspect, parseSupervisedCorrectionReviewOperationStatus, record,
    "supervised_review_observer");
}

export const handleSupervisedCorrectionReviewObservation = createSupervisedCorrectionReviewObserver();
