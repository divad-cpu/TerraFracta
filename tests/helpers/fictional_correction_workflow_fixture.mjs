import { connectedInput } from "./connected_reader_fixture.mjs";
import { inventedClosureNote } from "../../src/invented-correction-review.ts";
export const workflowId = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;

// Deliberately simulated adapter for controller/UI tests, never native storage
// or a configured runtime provider. Native evidence has a separate execution.
export function fictionalWorkflowFixture() {
  const input = connectedInput(), issue = { ...input.issue, publicationId: "92bb9213-05e0-550a-8b99-cbf65e786609" };
  const executionId = workflowId(1), snapshotId = workflowId(2), reportId = workflowId(3), calls = [];
  const state = { request: null, events: [], unknownIntake: false, unknownReview: false, observed: true };
  const status = () => ({ schemaVersion: 1, status: "private_review_snapshot", reportId, publicationId: issue.publicationId,
    reviewState: state.events.length === 2 ? "closed" : state.events.length === 1 ? "in_review" : "new",
    reportedAt: "2026-10-06T15:00:00.000001Z", reviewedAt: state.events.at(-1)?.recordedAt ?? null,
    events: state.events.map(({ eventId: _id, ...event }) => event) });
  const envelope = result => ({ executionId, result });
  const receipt = request => ({ schemaVersion: 1, status: "recorded_private", requestId: request.requestId,
    reportId, publicationId: request.draft.target.publicationId, revision: request.draft.target.revision, replayed: false });
  const reviewReceipt = (request, replayed = false) => {
    const event = state.events.find(event => event.eventId === request.eventId);
    if (!event) throw new Error("No simulated event");
    return { schemaVersion: 1, status: "recorded_private_transition", eventId: request.eventId, reportId,
      sequence: event.sequence, fromState: event.fromState, toState: event.toState, recordedAt: event.recordedAt, replayed };
  };
  const record = request => {
    if (status().reviewState !== request.expectedState) throw new Error("Simulated stale state");
    if (request.nextState === "closed" && request.resolutionNote !== inventedClosureNote) throw new Error("Simulated closure differs");
    state.events.push({ eventId: request.eventId, sequence: state.events.length + 1, fromState: request.expectedState,
      toState: request.nextState, recordedAt: `2026-10-06T15:00:0${state.events.length + 1}.000001Z` });
  };
  const backend = { executionId,
    async readCurrent() { calls.push(["current"]); return envelope(issue); },
    async submitRequest(request) { calls.push(["submit", structuredClone(request)]); state.request = structuredClone(request);
      return { ...envelope(state.unknownIntake ? null : receipt(request)), outcome: state.unknownIntake ? "unknown" : "confirmed" }; },
    async readQueue(request) { calls.push(["queue", structuredClone(request)]); return envelope({ schemaVersion: 1,
      status: "private_invented_review_queue", snapshotId, capturedAt: "2026-10-06T15:00:00.000002Z",
      expiresAt: "2026-10-06T15:02:00.000002Z", observedAt: "2026-10-06T15:00:03.000001Z",
      offset: request.offset, total: 1, items: [status()], next: null,
      membershipFrozen: true, statesObservedPerPage: true, liveReviewEnabled: false }); },
    async readDetail(request) { calls.push(["detail", structuredClone(request)]); return envelope({ schemaVersion: 1,
      status: "private_invented_review_detail", snapshotId, report: status(), draft: structuredClone(state.request.draft) }); },
    async reviewReport(request) { calls.push(["review", structuredClone(request)]); record(request);
      return { ...envelope(state.unknownReview ? null : reviewReceipt(request)), outcome: state.unknownReview ? "unknown" : "confirmed" }; },
    async lookupReviewEvent(request) { calls.push(["recover", structuredClone(request)]); return envelope({ schemaVersion: 1,
      status: "private_invented_review_recovery", outcome: state.observed ? "recorded" : "not_observed",
      recordedEvent: state.observed ? reviewReceipt(request, true) : null, current: status() }); },
  };
  return { backend, issue, state, calls, status, envelope, receipt, reviewReceipt, record, executionId, snapshotId, reportId };
}
