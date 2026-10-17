import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { detachedPreparationIntentSchema } from "./detached-preparation-report.ts";
import { prepareHtmlAppendedIssueCaptureRead, parseStoredHtmlAppendedIssueCapture } from "./html-appended-issue-capture.ts";
import { OPERATOR_AUDIT_TIMEOUT_MS } from "./operator-audit-reader.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// Owner-only trusted injection, not authorization, a live backend or a route.
// The supplied independent historical observation is never renewed on opening.
// This one read is not a snapshot with any separate current comparison read.
export type HtmlAppendedCaptureReadCommand = ReturnType<typeof prepareHtmlAppendedIssueCaptureRead>;
export type HtmlAppendedCaptureProvider = (command: HtmlAppendedCaptureReadCommand, signal: AbortSignal) => Promise<Uint8Array>;
export type HtmlAppendedCaptureReadDecision =
  | { kind: "ok"; stored: ReturnType<typeof parseStoredHtmlAppendedIssueCapture> }
  | { kind: "invalid_scope" | "unconfigured" | "unavailable" };
export type HtmlAppendedCaptureReader = (input: unknown, signal?: AbortSignal) => Promise<HtmlAppendedCaptureReadDecision>;
const RECEIPT_BYTES = 131_072;
function captureInput(input: unknown) {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes("retainedIntentJson") || !keys.includes("observedAt")) return null;
    const captured = captureOwnEnumerableSelectors(input, ["retainedIntentJson","observedAt"], true);
    if (captured === null || Reflect.ownKeys(input).length !== 2 || Reflect.ownKeys(input).some(k=>k!=="retainedIntentJson"&&k!=="observedAt")) return null;
    const retainedIntentJson = captured.retainedIntentJson!, observedAt = detachedPreparationIntentSchema.shape.prepared_at.refine(s=>!s.startsWith("0000-")).parse(captured.observedAt);
    const command = prepareHtmlAppendedIssueCaptureRead(retainedIntentJson);
    return Object.freeze({retainedIntentJson, observedAt, command});
  } catch { return null; }
}
export function createHtmlAppendedCaptureReader(provider?: HtmlAppendedCaptureProvider, now = () => performance.now(),
  record: DevelopmentErrorRecorder = recordDevelopmentError): HtmlAppendedCaptureReader {
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
    const unavailable = (): HtmlAppendedCaptureReadDecision => { reportFailure(); return {kind:"unavailable"}; };
    if (parentSignal?.aborted) return unavailable();
    const controller = new AbortController();
    let began: number;
    try { began = now(); } catch { return unavailable(); }
    if (!Number.isFinite(began)) return unavailable();
    const elapsedRead = createElapsedReadClock(now, began);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectCancelled = () => {};
    const cancelled = new Promise<never>((_resolve,reject) => { rejectCancelled = () => reject(Error("html_appended_capture_unavailable")); });
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
      return cancellationObserved || parentSignal?.aborted || controller.signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= OPERATOR_AUDIT_TIMEOUT_MS;
    };
    try {
      parentSignal?.addEventListener("abort",cancel,{once:true});
      timer = setTimeout(cancel,OPERATOR_AUDIT_TIMEOUT_MS);
      const raw = await Promise.race([Promise.resolve().then(() => {
        if (expired()) throw Error("html_appended_capture_unavailable");
        return provider(captured.command,controller.signal);
      }),cancelled]);
      if (expired()) return unavailable();
      const bytes = new Uint8Array(RECEIPT_BYTES);
      const size = copyNativeByteChunk(bytes,0,raw);
      const stored = parseStoredHtmlAppendedIssueCapture(bytes.subarray(0,size),captured.retainedIntentJson,captured.observedAt);
      if (expired()) return unavailable();
      return {kind:"ok",stored};
    } catch { return unavailable(); }
    finally {
      retired = true;
      // Every retirement is independent and cannot replace checked data.
      try { if (timer !== undefined) clearTimeout(timer); } catch { reportFailure(); }
      try { parentSignal?.removeEventListener("abort",cancel); } catch { reportFailure(); }
      try { controller.abort(); } catch { reportFailure(); }
    }
  };
}
// Actual target/principal/clock/rights acceptance remains independently required.
export const readHtmlAppendedCapture = createHtmlAppendedCaptureReader();
