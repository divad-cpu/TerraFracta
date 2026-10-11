import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { createElapsedReadClock } from "../elapsed-read-clock.ts";
import { proposalScopeSchema, type ProposalScope, type CapturedProposalReport } from "../operator-proposal-capture.ts";
import { parseCapturedProposalEnvelope } from "./proposal-capture.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";
import { OPERATOR_AUDIT_BYTES, OPERATOR_AUDIT_TIMEOUT_MS } from "./operator-audit-reader.ts";

export type ProposalProvider = (scope: Readonly<ProposalScope>, signal: AbortSignal) => Promise<Uint8Array>;
export type ProposalReadDecision = { kind: "ok"; report: CapturedProposalReport } |
  { kind: "invalid_scope" | "unconfigured" | "unavailable" | "not_found" | "capture_missing" | "changed" };
export type ProposalReader = (scope: unknown, signal?: AbortSignal) => Promise<ProposalReadDecision>;
export function canonicalProposalScope(input: unknown): Readonly<ProposalScope> | null {
  try { const parsed = proposalScopeSchema.safeParse(input); return parsed.success ? Object.freeze(parsed.data) : null; }
  catch { return null; }
}
export function createProposalReader(provider?: ProposalProvider, now = () => performance.now(),
  record: DevelopmentErrorRecorder = recordDevelopmentError): ProposalReader {
  return async (input, parentSignal) => {
    const scope = canonicalProposalScope(input);
    if (scope === null) return { kind: "invalid_scope" };
    if (provider === undefined) return { kind: "unconfigured" };
    let reported = false;
    const reportFailure = () => {
      if (!parentSignal?.aborted && !reported) {
        reported = true;
        observeDevelopmentError("operator_audit_read", record);
      }
    };
    const unavailable = (): ProposalReadDecision => {
      reportFailure();
      return { kind: "unavailable" };
    };
    if (parentSignal?.aborted) return unavailable();
    const controller = new AbortController();
    let began: number;
    try { began = now(); } catch { return unavailable(); }
    if (!Number.isFinite(began)) return unavailable();
    const elapsedRead = createElapsedReadClock(now, began);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectCancelled = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = () => reject(Error("proposal_unavailable")); });
    void cancelled.catch(() => {});
    let retired = false, cancellationObserved = false;
    const cancel = () => {
      if (retired || cancellationObserved) return;
      cancellationObserved = true;
      rejectCancelled();
      try { controller.abort(); } catch { /* Observation ends even if physical abort refuses. */ }
    };
    const expired = () => { const elapsed = elapsedRead(); return cancellationObserved || parentSignal?.aborted || controller.signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= OPERATOR_AUDIT_TIMEOUT_MS; };
    try {
      parentSignal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(cancel, OPERATOR_AUDIT_TIMEOUT_MS);
      const raw = await Promise.race([Promise.resolve().then(() => {
        if (expired()) throw Error("proposal_unavailable"); return provider(scope, controller.signal);
      }), cancelled]);
      if (expired()) return unavailable();
      // Reuse the existing fixed quota and snapshot actual native bytes before parsing.
      const bytes = new Uint8Array(OPERATOR_AUDIT_BYTES);
      const size = copyNativeByteChunk(bytes, 0, raw);
      if (size < 2) return unavailable();
      const envelope = parseCapturedProposalEnvelope(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))));
      if (envelope.requested.runId !== scope.runId || envelope.requested.decisionId !== scope.decisionId || expired()) return unavailable();
      return envelope.status === "ok" ? { kind: "ok", report: envelope } : { kind: envelope.status as "not_found" | "capture_missing" | "changed" };
    } catch { return unavailable(); }
    finally {
      retired = true;
      // Each retirement is independent; a cleanup fault cannot replace checked data.
      try { if (timer !== undefined) clearTimeout(timer); } catch { reportFailure(); }
      try { parentSignal?.removeEventListener("abort", cancel); } catch { reportFailure(); }
      try { controller.abort(); } catch { reportFailure(); }
    }
  };
}
// Explicit trusted installation/account/identity acceptance is still required.
export const readCapturedProposal = createProposalReader();
