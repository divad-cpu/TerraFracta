import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { heldDecisionsEnvelopeSchema, heldDecisionScopeSchema, type HeldDecisionsReport, type HeldDecisionScope } from "../operator-held-decisions.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// Trusted server wiring only. This is not an authorization decision, a public
// API, a selectable SQL bridge or a production credential/transport adapter.
export type HeldDecisionsProvider = (scope: Readonly<HeldDecisionScope>, signal: AbortSignal) => Promise<Uint8Array>;
export type HeldDecisionsReadDecision =
  | { kind: "ok"; report: HeldDecisionsReport }
  | { kind: "invalid_scope" | "unconfigured" | "unavailable" | "not_found" | "changed" };
export type HeldDecisionsReader = (scope: unknown, signal?: AbortSignal) => Promise<HeldDecisionsReadDecision>;
import { OPERATOR_AUDIT_BYTES, OPERATOR_AUDIT_TIMEOUT_MS } from "./operator-audit-reader.ts";

export function canonicalHeldDecisionScope(value: unknown): Readonly<HeldDecisionScope> | null {
  try {
    const parsed = heldDecisionScopeSchema.safeParse(value);
    if (!parsed.success) return null;
    if (parsed.data.cursor !== null) Object.freeze(parsed.data.cursor);
    return Object.freeze(parsed.data);
  } catch { return null; }
}

export function createHeldDecisionsReader(provider?: HeldDecisionsProvider, now = () => performance.now(),
  record: DevelopmentErrorRecorder = recordDevelopmentError): HeldDecisionsReader {
  return async (input, parentSignal) => {
    const scope = canonicalHeldDecisionScope(input);
    if (scope === null) return { kind: "invalid_scope" };
    if (provider === undefined) return { kind: "unconfigured" };
    let reported = false;
    const reportFailure = () => {
      if (!parentSignal?.aborted && !reported) {
        reported = true;
        observeDevelopmentError("operator_audit_read", record);
      }
    };
    const held = (): HeldDecisionsReadDecision => {
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
      return cancellationObserved || parentSignal?.aborted || (!retired && controller.signal.aborted) || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= OPERATOR_AUDIT_TIMEOUT_MS;
    };
    let decision: HeldDecisionsReadDecision = {kind:"unavailable"};
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
      const envelope = heldDecisionsEnvelopeSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))));
      const requested = envelope.requested;
      if (requested.runId !== scope.runId ||
          JSON.stringify(requested.cursor) !== JSON.stringify(scope.cursor) || expired()) return held();
      decision = envelope.status === "ok" ? { kind: "ok", report: envelope } : { kind: envelope.status };
    } catch {
      // No errors, source/request bodies or partial records escape a failure.
      return held();
    } finally {
      retired = true;
      // Each retirement is independent; a cleanup fault cannot replace checked data.
      try { if (timer !== undefined) clearTimeout(timer); } catch { reportFailure(); }
      try { parentSignal?.removeEventListener("abort", cancel); } catch { reportFailure(); }
      try { controller.abort(); } catch { reportFailure(); }
    }
    // Retirement callbacks cannot cross the original caller/time boundary.
    try { if (expired()) return held(); } catch { return held(); }
    return decision;
  };
}

// Installation/account/identity/transport acceptance remains separate. No
// environment flag, fixture or request can select an operational provider.
export const readHeldDecisions = createHeldDecisionsReader();
