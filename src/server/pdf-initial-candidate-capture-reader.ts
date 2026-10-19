import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { preparePdfInitialCandidateCaptureRead, parseStoredPdfInitialCandidateCapture } from "./pdf-initial-candidate-capture.ts";
import { preparePdfInitialCandidateReadScope } from "./pdf-initial-candidate-capture-scope.ts";
import { OPERATOR_AUDIT_TIMEOUT_MS } from "./operator-audit-reader.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// Adapted from the existing HTML bounded reader, preserving its cancellation,
// deadline, diagnostic and native-byte machinery with explicit PDF selectors.
// Owner-only trusted injection, not authorization, a live backend or a route.
// The supplied independent historical observation is never renewed on opening.
// This one read is not a snapshot with any separate current comparison read.
export type PdfInitialCandidateCaptureReadCommand = ReturnType<typeof preparePdfInitialCandidateCaptureRead>;
export type PdfInitialCandidateCaptureProvider = (command: PdfInitialCandidateCaptureReadCommand, signal: AbortSignal) => Promise<Uint8Array>;
export type PdfInitialCandidateCaptureReadDecision =
  | { kind: "ok"; stored: ReturnType<typeof parseStoredPdfInitialCandidateCapture> }
  | { kind: "invalid_scope" | "unconfigured" | "unavailable" };
export type PdfInitialCandidateCaptureReader = (input: unknown, signal?: AbortSignal) => Promise<PdfInitialCandidateCaptureReadDecision>;
const RECEIPT_BYTES = 131_072;
function captureInput(input:unknown){
 try{
  if(input===null||typeof input!=="object"||Array.isArray(input))return null;
  const names=["retainedIntentJson","expected","observedAt"] as const;
  const closed=()=>{const proto=Object.getPrototypeOf(input),keys=Reflect.ownKeys(input);return (proto===Object.prototype||proto===null)&&keys.length===names.length&&keys.every(k=>typeof k==="string"&&names.includes(k as typeof names[number]));};
  if(!closed())return null;
  const captured:Record<string,unknown>={};
  for(const name of names){const d=Object.getOwnPropertyDescriptor(input,name);if(!d?.enumerable||!("value"in d))return null;captured[name]=d.value;}
  if(!closed())return null;
  return preparePdfInitialCandidateReadScope(captured.retainedIntentJson,captured.expected,captured.observedAt);
 }catch{return null;}
}
export function createPdfInitialCandidateCaptureReader(provider?: PdfInitialCandidateCaptureProvider, now = () => performance.now(),
  record: DevelopmentErrorRecorder = recordDevelopmentError): PdfInitialCandidateCaptureReader {
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
    const unavailable = (): PdfInitialCandidateCaptureReadDecision => { reportFailure(); return {kind:"unavailable"}; };
    if (parentSignal?.aborted) return unavailable();
    const controller = new AbortController();
    let began: number;
    try { began = now(); } catch { return unavailable(); }
    if (!Number.isFinite(began)) return unavailable();
    const elapsedRead = createElapsedReadClock(now, began);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectCancelled = () => {};
    const cancelled = new Promise<never>((_resolve,reject) => { rejectCancelled = () => reject(Error("pdf_initial_candidate_capture_unavailable")); });
    void cancelled.catch(() => {});
    let retired = false, cancellationObserved = false, cleanupFailed = false;
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
    let decision: PdfInitialCandidateCaptureReadDecision = {kind:"unavailable"};
    try {
      parentSignal?.addEventListener("abort",cancel,{once:true});
      const remaining = OPERATOR_AUDIT_TIMEOUT_MS - elapsedRead();
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > OPERATOR_AUDIT_TIMEOUT_MS) throw Error("read_unavailable");
      timer = setTimeout(cancel,remaining);
      const raw = await Promise.race([Promise.resolve().then(() => {
        if (expired()) throw Error("pdf_initial_candidate_capture_unavailable");
        return provider(captured.command,controller.signal);
      }),cancelled]);
      if (expired()) throw Error("pdf_initial_candidate_capture_unavailable");
      const bytes = new Uint8Array(RECEIPT_BYTES);
      const size = copyNativeByteChunk(bytes,0,raw);
      const stored = parseStoredPdfInitialCandidateCapture(bytes.subarray(0,size),captured.retainedIntentJson,captured.expected,captured.observedAt);
      if (expired()) throw Error("pdf_initial_candidate_capture_unavailable");
      decision = {kind:"ok",stored};
    } catch { decision = unavailable(); }
    finally {
      retired = true;
      // Every retirement is independent and cannot replace checked data.
      try { if (timer !== undefined) clearTimeout(timer); } catch { cleanupFailed = true; reportFailure(); }
      try { parentSignal?.removeEventListener("abort",cancel); } catch { cleanupFailed = true; reportFailure(); }
      try { controller.abort(); } catch { cleanupFailed = true; reportFailure(); }
    }
    // Cleanup is observable: abort listeners/retirement calls can cancel the
    // parent or advance the original clock before delivery. Never return a
    // previously computed candidate across that final boundary.
    try { if (cleanupFailed || expired()) return unavailable(); }
    catch { return unavailable(); }
    return decision;
  };
}
// Actual target/principal/clock/rights acceptance remains independently required.
export const readPdfInitialCandidateCapture = createPdfInitialCandidateCaptureReader();
