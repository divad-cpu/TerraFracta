import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { detachedPreparationIntentSchema } from "./detached-preparation-report.ts";
import { prepareAppendedIssueCaptureRead, parseStoredAppendedIssueCapture } from "./appended-issue-capture.ts";
import { OPERATOR_AUDIT_TIMEOUT_MS } from "./operator-audit-reader.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// Owner-only trusted injection, not authorization, a live backend or a route.
// The supplied independent historical observation is never renewed on opening.
// This one read is not a snapshot with any separate current comparison read.
export type AppendedCaptureReadCommand = ReturnType<typeof prepareAppendedIssueCaptureRead>;
export type AppendedCaptureProvider = (command: AppendedCaptureReadCommand, signal: AbortSignal) => Promise<Uint8Array>;
export type AppendedCaptureReadDecision =
  | { kind: "ok"; stored: ReturnType<typeof parseStoredAppendedIssueCapture> }
  | { kind: "invalid_scope" | "unconfigured" | "unavailable" };
export type AppendedCaptureReader = (input: unknown, signal?: AbortSignal) => Promise<AppendedCaptureReadDecision>;
const RECEIPT_BYTES = 131_072;
function captureInput(input: unknown) {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const keys = Object.keys(input);
    if (keys.length !== 2 || !keys.includes("retainedIntentJson") || !keys.includes("observedAt")) return null;
    const captured = captureOwnEnumerableSelectors(input, keys, true);
    if (captured === null) return null;
    const retainedIntentJson = captured.retainedIntentJson!, observedAt = detachedPreparationIntentSchema.shape.prepared_at.parse(captured.observedAt);
    const command = prepareAppendedIssueCaptureRead(retainedIntentJson);
    return Object.freeze({retainedIntentJson, observedAt, command});
  } catch { return null; }
}
export function createAppendedCaptureReader(provider?: AppendedCaptureProvider, now = () => performance.now(),
  record: DevelopmentErrorRecorder = recordDevelopmentError): AppendedCaptureReader {
  return async (input, parentSignal) => {
    const captured = captureInput(input);
    if (captured === null) return {kind:"invalid_scope"};
    if (provider === undefined) return {kind:"unconfigured"};
    let reported = false;
    const reportFailure = () => {
      if (!parentSignal?.aborted && !reported) {
        reported = true;
        observeDevelopmentError("operator_audit_read", record);
      }
    };
    const unavailable = (): AppendedCaptureReadDecision => { reportFailure(); return {kind:"unavailable"}; };
    if (parentSignal?.aborted) return unavailable();
    const controller = new AbortController();
    let began: number;
    try { began = now(); } catch { return unavailable(); }
    if (!Number.isFinite(began)) return unavailable();
    const elapsedRead = createElapsedReadClock(now, began);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectCancelled = () => {};
    const cancelled = new Promise<never>((_resolve,reject) => { rejectCancelled = () => reject(Error("appended_capture_unavailable")); });
    void cancelled.catch(() => {});
    let retired = false, cancellationObserved = false;
    const cancel = () => {
      if (retired || cancellationObserved) return;
      cancellationObserved = true;
      rejectCancelled();
      try { controller.abort(); } catch { /* Observation retires even if physical abort refuses. */ }
    };
    const expired = () => {
      const elapsed = elapsedRead();
      return cancellationObserved || parentSignal?.aborted || (!retired && controller.signal.aborted) || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= OPERATOR_AUDIT_TIMEOUT_MS;
    };
    let decision: AppendedCaptureReadDecision = {kind:"unavailable"};
    try {
      parentSignal?.addEventListener("abort",cancel,{once:true});
      const remaining = OPERATOR_AUDIT_TIMEOUT_MS - elapsedRead();
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > OPERATOR_AUDIT_TIMEOUT_MS) throw Error("read_unavailable");
      timer = setTimeout(cancel,remaining);
      const raw = await Promise.race([Promise.resolve().then(() => {
        if (expired()) throw Error("appended_capture_unavailable");
        return provider(captured.command,controller.signal);
      }),cancelled]);
      if (expired()) return unavailable();
      const bytes = new Uint8Array(RECEIPT_BYTES);
      const size = copyNativeByteChunk(bytes,0,raw);
      const stored = parseStoredAppendedIssueCapture(bytes.subarray(0,size),captured.retainedIntentJson,captured.observedAt);
      if (expired()) return unavailable();
      decision = {kind:"ok",stored};
    } catch { return unavailable(); }
    finally {
      retired = true;
      // Every retirement is independent and cannot replace checked data.
      try { if (timer !== undefined) clearTimeout(timer); } catch { reportFailure(); }
      try { parentSignal?.removeEventListener("abort",cancel); } catch { reportFailure(); }
      try { controller.abort(); } catch { reportFailure(); }
    }
    // Physical retirement can cancel the caller or consume the original read
    // budget. Recheck after it, excluding only our deliberate owned abort.
    try { if (expired()) return unavailable(); } catch { return unavailable(); }
    return decision;
  };
}
// Actual target/principal/clock/rights acceptance remains independently required.
export const readAppendedCapture = createAppendedCaptureReader();
