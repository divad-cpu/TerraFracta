import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { operatorAuditEnvelopeSchema, operatorAuditScopeSchema, type OperatorAuditReport, type OperatorAuditScope } from "../operator-audit-report.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// Trusted server wiring only. This is not an authorization decision, a public
// API, a selectable SQL bridge or a production credential/transport adapter.
export type OperatorAuditProvider = (scope: Readonly<OperatorAuditScope>, signal: AbortSignal) => Promise<Uint8Array>;
export type OperatorAuditReadDecision =
  | { kind: "ok"; report: OperatorAuditReport }
  | { kind: "invalid_scope" | "unconfigured" | "unavailable" | "not_found" | "changed" };
export type OperatorAuditReader = (scope: unknown, signal?: AbortSignal) => Promise<OperatorAuditReadDecision>;
export const OPERATOR_AUDIT_BYTES = 65_536;
export const OPERATOR_AUDIT_TIMEOUT_MS = 3_000;

export function canonicalOperatorAuditScope(value: unknown): Readonly<OperatorAuditScope> | null {
  const parsed = operatorAuditScopeSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.cursor !== null) Object.freeze(parsed.data.cursor);
  return Object.freeze(parsed.data);
}

export function createOperatorAuditReader(provider?: OperatorAuditProvider, now = () => performance.now(),
  record: DevelopmentErrorRecorder = recordDevelopmentError): OperatorAuditReader {
  return async (input, parentSignal) => {
    const scope = canonicalOperatorAuditScope(input);
    if (scope === null) return { kind: "invalid_scope" };
    if (provider === undefined) return { kind: "unconfigured" };
    let reported = false;
    const reportFailure = () => {
      if (!parentSignal?.aborted && !reported) {
        reported = true;
        observeDevelopmentError("operator_audit_read", record);
      }
    };
    const held = (): OperatorAuditReadDecision => {
      // Expected holds and caller cancellation are not technical faults. The
      // recorder receives only this fixed code and never delays the decision.
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
        return provider(scope, controller.signal);
      }), cancelled]);
      if (expired()) return held();
      // Reuse the existing fixed quota and snapshot actual native bytes before parsing.
      const bytes = new Uint8Array(OPERATOR_AUDIT_BYTES);
      const size = copyNativeByteChunk(bytes, 0, raw);
      if (size < 2) return held();
      const envelope = operatorAuditEnvelopeSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))));
      const requested = envelope.requested;
      if (requested.runId !== scope.runId || requested.issueId !== scope.issueId ||
          JSON.stringify(requested.cursor) !== JSON.stringify(scope.cursor) || expired()) return held();
      return envelope.status === "ok" ? { kind: "ok", report: envelope } : { kind: envelope.status };
    } catch {
      // No errors, source/request bodies or partial records escape a failure.
      return held();
    } finally {
      retired = true;
      try { if (timer !== undefined) clearTimeout(timer); } catch { reportFailure(); }
      try { parentSignal?.removeEventListener("abort", cancel); } catch { reportFailure(); }
      try { controller.abort(); } catch { reportFailure(); }
    }
  };
}

// Installation/account/identity/transport acceptance remains separate. No
// environment flag, fixture or request can select an operational provider.
export const readOperatorAudit = createOperatorAuditReader();
