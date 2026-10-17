import { z } from "zod";
import { publicIssueProjectionSchema, type PublicIssueProjection } from "./public-issue-projection.ts";
import { deriveCorrectionTarget } from "./correction-target.ts";
import { prepareCorrectionRequest, checkCorrectionRequest, parseCorrectionRequestReceipt, type CorrectionRequest } from "./correction-request.ts";
import { parseInventedQueueRequest, parseInventedQueuePage, parseInventedDetailRequest, parseInventedReviewDetail } from "./invented-correction-queue.ts";
import { inventedClosureNote, parseInventedReviewRequest, parseInventedReviewReceipt, type InventedReviewRequest } from "./invented-correction-review.ts";
import { parseInventedReviewRecovery } from "./invented-correction-recovery.ts";
import { observeClientError } from "./client-error-diagnostics.ts";
import type { FictionalCorrectionDiagnosticCode } from "./error-diagnostics.ts";

export const FICTIONAL_WORKFLOW_TIMEOUT_MS = 3_000;
export const fictionalCorrectionFields = Object.freeze({ kind: "missing_context" as const,
  details: "Invented explanation for a private technical correction test.",
  sourceUrl: "https://example.org/fictional-correction-evidence" });
const publications = ["92bb9213-05e0-550a-8b99-cbf65e786609", "6ac005f4-f9a0-5021-a3b5-28e1f1607397"];
const readEnvelope = z.strictObject({ executionId: z.uuid(), result: z.unknown() });
const writeEnvelope = readEnvelope.extend({ outcome: z.enum(["confirmed", "not_dispatched", "unknown"]) })
  .refine(value => value.outcome === "confirmed" || value.result === null);
export type FictionalWorkflowBackend = Readonly<{
  executionId: string;
  readCurrent: (signal: AbortSignal) => Promise<unknown>;
  submitRequest: (request: CorrectionRequest, signal: AbortSignal) => Promise<unknown>;
  readQueue: (request: ReturnType<typeof parseInventedQueueRequest>, signal: AbortSignal) => Promise<unknown>;
  readDetail: (request: ReturnType<typeof parseInventedDetailRequest>, signal: AbortSignal) => Promise<unknown>;
  reviewReport: (request: InventedReviewRequest, signal: AbortSignal) => Promise<unknown>;
  lookupReviewEvent: (request: InventedReviewRequest, signal: AbortSignal) => Promise<unknown>;
}>;
export type FictionalWorkflowPhase = "unconfigured" | "idle" | "ready" | "prepared" | "recorded" | "queued" | "detail" | "reviewed" | "recovered" | "held" | "disposed";
export type FictionalWorkflowReason = "unavailable" | "invalid_action" | "changed" | "invalid_draft" | "not_dispatched" | "unknown_intake" | "unknown_review" | "not_observed" | "cancelled";
export type FictionalWorkflowState = {
  phase: FictionalWorkflowPhase; busy: boolean; executionId: string | null; reason: FictionalWorkflowReason | null;
  uncertainWrite: "intake" | "review" | null;
  issue: PublicIssueProjection | null; request: CorrectionRequest | null;
  intake: ReturnType<typeof parseCorrectionRequestReceipt> | null;
  queue: ReturnType<typeof parseInventedQueuePage> | null;
  detail: ReturnType<typeof parseInventedReviewDetail> | null;
  reviewRequest: InventedReviewRequest | null;
  reviewReceipt: ReturnType<typeof parseInventedReviewReceipt> | null;
  recovery: ReturnType<typeof parseInventedReviewRecovery> | null;
};
type Dependencies = { now?: () => number; onChange?: (state: FictionalWorkflowState) => void; onFault?: (code: FictionalCorrectionDiagnosticCode) => unknown };
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function fixedIssue(input: unknown) {
  const issue = publicIssueProjectionSchema.parse(input);
  if (issue.issueId !== "718863b9-75b8-572b-9184-3bc18a13658a" || issue.jurisdictionSlug !== "fictional-country" ||
      issue.issueSlug !== "fictional-share" || ![1, 2].includes(issue.revision) ||
      issue.publicationId !== publications[issue.revision - 1] || issue.claims.length !== 1 ||
      issue.claims[0].id !== ["b1f330c7-1fb0-5d43-ac78-efa58fd46800", "89092d23-fa9f-5315-a905-f1c1864d18a1"][issue.revision - 1]) throw new Error("Fixed fictional issue required");
  return issue;
}
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }

// Inactive coordination only. The trusted development adapter owns execution,
// ordinary principals and current reads. No default transport/store, credentials,
// native setup, free-text intake, publication or automatic write retry exists.
export function createFictionalCorrectionWorkflow(backend?: FictionalWorkflowBackend, dependencies: Dependencies = {}) {
  const now = dependencies.now ?? (() => performance.now());
  const fault = (code: FictionalCorrectionDiagnosticCode) => {
    try { void Promise.resolve(dependencies.onFault ? dependencies.onFault(code) : observeClientError(code)).catch(() => {}); } catch {}
  };
  const execution = backend === undefined ? null : z.uuid().safeParse(backend.executionId);
  const configured = backend !== undefined && execution !== null && execution.success;
  let state: Omit<FictionalWorkflowState, "uncertainWrite"> = { phase: configured ? "idle" : "unconfigured", busy: false,
    executionId: configured ? execution.data : null, reason: null, issue: null, request: null,
    intake: null, queue: null, detail: null, reviewRequest: null, reviewReceipt: null, recovery: null };
  let owner: { controller: AbortController; settled: boolean; returned: boolean; cause: "cancel" | "deadline" | null; interrupt: () => void } | null = null;
  let disposed = false, allocating = false, preparing = false, uncertain: "intake" | "review" | null = null;
  let queueIdentity: { snapshotId: string; capturedAt: string; expiresAt: string; total: number } | null = null;
  // The most recent read's reason does not resolve an earlier write. Controls
  // receive the coordinator's owned uncertainty as immutable observation only.
  const snapshot = (): FictionalWorkflowState => freeze(structuredClone({ ...state, uncertainWrite: uncertain }));
  function publish(change: Partial<Omit<FictionalWorkflowState, "uncertainWrite">>) {
    state = { ...state, ...change };
    try { dependencies.onChange?.(snapshot()); } catch { fault("fictional_correction_display"); }
    return snapshot();
  }
  const held = (reason: FictionalWorkflowReason) => disposed ? snapshot() : publish({ phase: "held", reason });
  function allowed() { return configured && !disposed && !allocating && !preparing && owner === null; }
  function refused() { return disposed || allocating || preparing || !configured || owner !== null || uncertain !== null ? snapshot() : held("invalid_action"); }
  function envelope(input: unknown, write: boolean) {
    const result = write ? writeEnvelope.parse(input) : readEnvelope.parse(input);
    if (result.executionId !== state.executionId) throw new Error("Fictional execution differs");
    return result;
  }
  async function run(code: FictionalCorrectionDiagnosticCode, write: "intake" | "review" | null, work: (signal: AbortSignal) => Promise<unknown>, apply: (value: unknown) => void, beforeDispatch?: () => void) {
    if (!allowed()) return refused();
    let controller: AbortController;
    allocating = true;
    try { controller = new AbortController(); }
    catch {
      if (disposed) return snapshot();
      fault(code);
      return disposed ? snapshot() : held(write !== null ? "not_dispatched" : "unavailable");
    } finally { allocating = false; }
    if (disposed) return snapshot();
    const flight = { controller, settled: false, returned: false, cause: null as "cancel" | "deadline" | null, interrupt: () => {} }; owner = flight;
    const isCancelled = () => flight.cause === "cancel";
    let dispatched = false, retired = false, reported = false, setupFailed = false, listenerStarted = false;
    const report = () => {
      if (!disposed && flight.cause !== "cancel" && !reported) { reported = true; fault(code); }
    };
    const abort = () => { try { flight.controller.abort(); } catch { report(); } };
    const release = () => { if (owner === flight && flight.settled && flight.returned) { owner = null; if (!disposed) publish({ busy: false }); } };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<null>(resolve => { flight.interrupt = () => resolve(null); });
    const cancelled = () => { if (!retired) flight.interrupt(); };
    const retire = () => {
      if (retired) return;
      retired = true;
      try { if (timer !== undefined) clearTimeout(timer); } catch { report(); }
      try { if (listenerStarted) flight.controller.signal.removeEventListener("abort", cancelled); } catch { report(); }
    };
    let start: number;
    try { start = now(); if (!Number.isFinite(start)) throw new Error("Invalid clock"); }
    catch {
      owner = null;
      if (disposed) return snapshot();
      if (isCancelled()) return held("cancelled");
      report(); return held("unavailable");
    }
    // Injected clocks can retire this operation synchronously. No physical
    // work has started here, so relinquish only this undispatched owner.
    if (disposed || isCancelled()) {
      if (owner === flight) owner = null;
      return disposed ? snapshot() : held("cancelled");
    }
    publish({ busy: true, reason: null });
    try {
      if (!disposed && flight.cause === null && !flight.controller.signal.aborted) {
        listenerStarted = true;
        flight.controller.signal.addEventListener("abort", cancelled, { once: true });
        if (!disposed && flight.cause === null && !flight.controller.signal.aborted) {
          timer = setTimeout(() => {
            if (retired || flight.cause !== null) return;
            flight.cause = "deadline"; flight.interrupt(); abort();
          }, FICTIONAL_WORKFLOW_TIMEOUT_MS);
        }
      }
    } catch { setupFailed = true; }
    // Ownership survives caller timeout/cancellation until the adapter settles.
    // The late value is consumed but cannot update state or dispatch a new write.
    const actual = Promise.resolve().then(async () => {
      if (disposed || flight.cause !== null || flight.controller.signal.aborted) return { kind: "cancelled" as const };
      if (setupFailed) return { kind: "not_started" as const };
      if (beforeDispatch) {
        beforeDispatch();
        // Announcing the exact review intent can synchronously retire its
        // observer. It must not count as, or permit, a backend dispatch.
        if (disposed || flight.cause !== null || flight.controller.signal.aborted) return { kind: "cancelled" as const };
      }
      dispatched = true;
      return work(flight.controller.signal).then(value => ({ kind: "value" as const, value }));
    }).catch(() => ({ kind: "failed" as const }));
    void actual.then(() => { flight.settled = true; release(); });
    const finish = async () => {
      try {
        const result = await Promise.race([actual, interrupted]);
        if (disposed) return snapshot();
        // Cancellation retires the caller's observation before any finish clock
        // is read. A faulty clock cannot turn it into a technical-fault report.
        if (isCancelled()) {
          if (write !== null && dispatched) { uncertain = write; return held(write === "intake" ? "unknown_intake" : "unknown_review"); }
          return held("cancelled");
        }
        if (setupFailed) {
          report();
          return held(write !== null ? "not_dispatched" : "unavailable");
        }
        const elapsed = now() - start;
        if (disposed) return snapshot();
        if (isCancelled()) {
          if (write !== null && dispatched) { uncertain = write; return held(write === "intake" ? "unknown_intake" : "unknown_review"); }
          return held("cancelled");
        }
        if (result === null || flight.controller.signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= FICTIONAL_WORKFLOW_TIMEOUT_MS) {
          abort();
          report();
          if (write !== null && dispatched) { uncertain = write; return held(write === "intake" ? "unknown_intake" : "unknown_review"); }
          return held("unavailable");
        }
        if (result.kind !== "value") {
          report(); if (write !== null) uncertain = write;
          return held(write === "intake" ? "unknown_intake" : write === "review" ? "unknown_review" : "unavailable");
        }
        const checked = envelope(result.value, write !== null);
        if (write !== null && "outcome" in checked && checked.outcome !== "confirmed") {
          if (checked.outcome === "unknown") uncertain = write;
          return held(checked.outcome === "not_dispatched" ? "not_dispatched" : write === "intake" ? "unknown_intake" : "unknown_review");
        }
        apply(checked.result);
        return snapshot();
      } catch {
        if (!disposed && isCancelled()) {
          if (write !== null && dispatched) { uncertain = write; return held(write === "intake" ? "unknown_intake" : "unknown_review"); }
          return held("cancelled");
        }
        if (!disposed) { report(); if (write !== null) uncertain = write;
          return held(write === "intake" ? "unknown_intake" : write === "review" ? "unknown_review" : "unavailable"); }
        return snapshot();
      } finally {
        retire();
        flight.returned = true; release();
      }
    };
    await finish();
    return snapshot();
  }
  return {
    snapshot,
    async load() {
      if (!allowed() || uncertain !== null || state.intake !== null) return refused();
      return run("fictional_correction_current", null, signal => backend!.readCurrent(signal), value => {
        const issue = fixedIssue(value);
        if (state.request && checkCorrectionRequest({ kind: "issue", issue }, state.request).kind !== "prepared") {
          publish({ issue: null, request: null, phase: "held", reason: "changed" }); return;
        }
        publish({ issue, phase: state.request ? "prepared" : "ready", reason: null });
      });
    },
    prepare(target: "page" | "statement", freshId: () => string) {
      if (!allowed() || uncertain !== null || !state.issue || state.intake !== null || !["ready", "prepared"].includes(state.phase) || !["page", "statement"].includes(target)) return refused();
      preparing = true;
      try {
        const current = { kind: "issue" as const, issue: state.issue };
        const selected = deriveCorrectionTarget(current, target === "page" ? null : state.issue.claims[0].id);
        if (selected.kind !== "available") return held("changed");
        const prepared = prepareCorrectionRequest(current, { target: selected.target, fields: fictionalCorrectionFields }, freshId, state.request);
        if (disposed) return snapshot();
        if (prepared.kind !== "prepared") return held("invalid_draft");
        return publish({ request: prepared.request, phase: "prepared", reason: null });
      } catch { if (disposed) return snapshot(); fault("fictional_correction_prepare"); return held("unavailable"); }
      finally { preparing = false; }
    },
    // Allows composition with the existing actual editor callback, while only
    // the fixed authored fictional fields can cross the injected backend port.
    acceptPrepared(input: unknown) {
      if (!allowed() || uncertain !== null || !state.issue || state.intake !== null || !["ready", "prepared"].includes(state.phase)) return refused();
      preparing = true;
      try {
        const checked = checkCorrectionRequest({ kind: "issue", issue: state.issue }, input);
        if (disposed) return snapshot();
        if (checked.kind !== "prepared" || !same(checked.request.draft.fields, fictionalCorrectionFields)) return held("invalid_draft");
        if (state.request && state.request.requestId === checked.request.requestId && !same(state.request, checked.request)) return held("invalid_draft");
        const prepared = prepareCorrectionRequest({ kind: "issue", issue: state.issue }, checked.request.draft,
          checked.request.requestId, state.request);
        if (prepared.kind !== "prepared") return held("invalid_draft");
        return publish({ request: prepared.request, phase: "prepared", reason: null });
      } catch { if (disposed) return snapshot(); fault("fictional_correction_prepare"); return held("invalid_draft"); }
      finally { preparing = false; }
    },
    async submit() {
      if (!allowed() || uncertain !== null || !state.request || state.intake !== null || state.phase !== "prepared") return refused();
      const request = structuredClone(state.request);
      return run("fictional_correction_submit", "intake", signal => backend!.submitRequest(request, signal), value => {
        const intake = parseCorrectionRequestReceipt(value, request);
        publish({ intake, phase: "recorded", reason: null });
      });
    },
    async queue(next = false) {
      if (!allowed() || uncertain !== null || !state.intake || typeof next !== "boolean") return refused();
      const request = next ? state.queue?.next : { schemaVersion: 1, snapshotId: null, offset: 0 };
      if (!request) return refused();
      const checked = parseInventedQueueRequest(request);
      return run("fictional_correction_queue", null, signal => backend!.readQueue(checked, signal), value => {
        const queue = parseInventedQueuePage(value, checked);
        const identity = { snapshotId: queue.snapshotId, capturedAt: queue.capturedAt, expiresAt: queue.expiresAt, total: queue.total };
        if (next && !same(queueIdentity, identity)) throw new Error("Queue membership changed");
        queueIdentity = identity;
        publish({ queue, detail: null, phase: "queued", reason: null });
      });
    },
    async detail() {
      if (!allowed() || uncertain !== null || !["queued", "detail", "reviewed", "recovered"].includes(state.phase) || !state.queue || !state.intake ||
          !state.queue.items.some(item => item.reportId === state.intake!.reportId)) return refused();
      const request = parseInventedDetailRequest({ schemaVersion: 1, snapshotId: state.queue.snapshotId, reportId: state.intake.reportId });
      return run("fictional_correction_detail", null, signal => backend!.readDetail(request, signal), value => {
        const detail = parseInventedReviewDetail(value, request);
        if (!state.request || !same(detail.draft, state.request.draft) || detail.report.publicationId !== state.intake!.publicationId)
          throw new Error("Stored report differs from the prepared intent");
        publish({ detail, phase: "detail", reason: null });
      });
    },
    async review(nextState: "in_review" | "closed", freshId: () => string) {
      if (!allowed() || uncertain !== null || !state.detail || state.phase !== "detail") return refused();
      if (!(state.detail.report.reviewState === "new" && nextState === "in_review" ||
          state.detail.report.reviewState === "in_review" && nextState === "closed")) return refused();
      let request: InventedReviewRequest;
      preparing = true;
      try {
        const eventId = freshId();
        if (disposed) return snapshot();
        request = parseInventedReviewRequest({ schemaVersion: 1, eventId, reportId: state.detail.report.reportId,
          expectedState: state.detail.report.reviewState, nextState, resolutionNote: nextState === "closed" ? inventedClosureNote : null });
        if (request.eventId === state.reviewRequest?.eventId) return held("invalid_action");
      } catch { if (disposed) return snapshot(); fault("fictional_correction_review"); return held("invalid_action"); }
      finally { preparing = false; }
      return run("fictional_correction_review", "review", signal => backend!.reviewReport(request, signal), value => {
        const reviewReceipt = parseInventedReviewReceipt(value, request);
        publish({ reviewReceipt, phase: "reviewed", reason: null });
      }, () => { publish({ reviewRequest: request, reviewReceipt: null, recovery: null }); });
    },
    async recover() {
      if (!allowed() || uncertain !== "review" || !state.reviewRequest || !state.intake) return refused();
      const request = structuredClone(state.reviewRequest);
      return run("fictional_correction_recover", null, signal => backend!.lookupReviewEvent(request, signal), value => {
        const recovery = parseInventedReviewRecovery(value, request);
        if (recovery.current.publicationId !== state.intake!.publicationId) throw new Error("Recovery publication differs");
        if (recovery.outcome === "recorded") uncertain = null;
        publish({ recovery, phase: recovery.outcome === "recorded" ? "recovered" : "held",
          reason: recovery.outcome === "recorded" ? null : "not_observed" });
      });
    },
    cancel() { if (owner) { owner.cause = "cancel"; owner.interrupt(); try { owner.controller.abort(); } catch {} } return snapshot(); },
    dispose() { disposed = true; if (owner) { owner.cause = "cancel"; owner.interrupt(); try { owner.controller.abort(); } catch {} }
      return publish({ phase: "disposed", busy: false, issue: null, request: null, queue: null, detail: null }); },
  };
}
export type FictionalCorrectionWorkflow = ReturnType<typeof createFictionalCorrectionWorkflow>;
