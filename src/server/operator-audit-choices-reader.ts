import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { operatorAuditChoiceIdSchema, operatorAuditRunCursorSchema, operatorAuditChoicesEnvelopeSchema, type OperatorAuditChoices, type OperatorAuditRunCursor } from "../operator-audit-choices.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";
import { OPERATOR_AUDIT_BYTES, OPERATOR_AUDIT_TIMEOUT_MS } from "./operator-audit-reader.ts";

export type OperatorAuditChoicesProvider = (runId: string | null, signal: AbortSignal, cursor?: Readonly<OperatorAuditRunCursor> | null) => Promise<Uint8Array>;
export type OperatorAuditChoicesDecision = { kind: "ok"; report: OperatorAuditChoices } |
  { kind: "invalid_scope" | "unconfigured" | "unavailable" | "changed" };

export function canonicalOperatorAuditChoice(input: unknown): string | null | undefined {
  if (input === null) return null;
  const parsed = operatorAuditChoiceIdSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

export function canonicalOperatorAuditRunCursor(input: unknown): Readonly<OperatorAuditRunCursor> | null | undefined {
  if (input === null) return null;
  try {
    const parsed = operatorAuditRunCursorSchema.safeParse(input);
    return parsed.success ? Object.freeze(parsed.data) : undefined;
  } catch { return undefined; }
}

export function createOperatorAuditChoicesReader(provider?: OperatorAuditChoicesProvider,
  now = () => performance.now(), record: DevelopmentErrorRecorder = recordDevelopmentError) {
  return async (input: unknown = null, parentSignal?: AbortSignal, inputCursor: unknown = null): Promise<OperatorAuditChoicesDecision> => {
    const runId = canonicalOperatorAuditChoice(input);
    const cursor = canonicalOperatorAuditRunCursor(inputCursor);
    if (runId === undefined || cursor === undefined) return { kind: "invalid_scope" };
    if (provider === undefined) return { kind: "unconfigured" };
    let reported = false;
    const reportFailure = () => {
      if (!parentSignal?.aborted && !reported) {
        reported = true;
        observeDevelopmentError("operator_audit_read", record);
      }
    };
    const held = (): OperatorAuditChoicesDecision => {
      reportFailure();
      return { kind: "unavailable" };
    };
    if (parentSignal?.aborted) return held();
    const controller = new AbortController();
    let began: number;
    try { began = now(); } catch { return held(); }
    if (!Number.isFinite(began)) return held();
    const elapsedRead = createElapsedReadClock(now, began);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectCancelled: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = () => reject(new Error("audit_unavailable"));
    });
    void cancelled.catch(() => {});
    let retired = false, cancellationObserved = false;
    const cancel = () => {
      if (retired || cancellationObserved) return;
      cancellationObserved = true;
      rejectCancelled?.();
      try { controller.abort(); } catch { /* Observation ends even if physical abort refuses. */ }
    };
    const expired = () => {
      const elapsed = elapsedRead();
      return cancellationObserved || parentSignal?.aborted || controller.signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= OPERATOR_AUDIT_TIMEOUT_MS;
    };
    try {
      parentSignal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(cancel, OPERATOR_AUDIT_TIMEOUT_MS);
      const raw = await Promise.race([Promise.resolve().then(() => {
        if (expired()) throw new Error("audit_unavailable");
        return provider(runId, controller.signal, cursor);
      }), cancelled]);
      if (expired()) return held();
      // Reuse the existing fixed quota and snapshot actual native bytes before parsing.
      const bytes = new Uint8Array(OPERATOR_AUDIT_BYTES);
      const size = copyNativeByteChunk(bytes, 0, raw);
      if (size < 2) return held();
      const envelope = operatorAuditChoicesEnvelopeSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))));
      if (envelope.requestedRunId !== runId || JSON.stringify(envelope.requestedCursor) !== JSON.stringify(cursor) || expired()) return held();
      return envelope.status === "ok" ? { kind: "ok", report: envelope } : { kind: "changed" };
    } catch { return held(); }
    finally {
      retired = true;
      // Each retirement is independent; a cleanup fault cannot replace checked data.
      try { if (timer !== undefined) clearTimeout(timer); } catch { reportFailure(); }
      try { parentSignal?.removeEventListener("abort", cancel); } catch { reportFailure(); }
      try { controller.abort(); } catch { reportFailure(); }
    }
  };
}

// Explicit installation/account/identity acceptance remains separate.
export const readOperatorAuditChoices = createOperatorAuditChoicesReader();
