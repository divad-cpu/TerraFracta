import assert from "node:assert/strict";
import test from "node:test";
import { parseInventedReviewRecovery } from "../src/invented-correction-recovery.ts";
const reportId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request = { schemaVersion: 1, eventId, reportId, expectedState: "new", nextState: "in_review", resolutionNote: null };
const event = { sequence: 1, fromState: "new", toState: "in_review", recordedAt: "2026-10-03T07:00:00.123456Z" };
const current = { schemaVersion: 1, status: "private_review_snapshot", reportId, publicationId: eventId,
  reviewState: "closed", reportedAt: "2026-10-03T06:00:00Z", reviewedAt: "2026-10-03T07:01:00Z",
  events: [event, { sequence: 2, fromState: "in_review", toState: "closed", recordedAt: "2026-10-03T07:01:00Z" }] };
const recordedEvent = { schemaVersion: 1, status: "recorded_private_transition", reportId, eventId, ...event, replayed: true };
const value = { schemaVersion: 1, status: "private_invented_review_recovery", outcome: "recorded", recordedEvent, current };
test("historical start recovery preserves the separately observed closed state", () => {
  const result = parseInventedReviewRecovery(value, request);
  assert.equal(result.recordedEvent.toState, "in_review"); assert.equal(result.current.reviewState, "closed");
  assert.equal(parseInventedReviewRecovery({ ...value, recordedEvent: { ...recordedEvent,
    recordedAt: "2026-10-03T09:00:00.123456+02:00" } }, request).current.reviewState, "closed");
});
test("not observed is a bounded observation with no event or retry authority", () => {
  assert.equal(parseInventedReviewRecovery({ ...value, outcome: "not_observed", recordedEvent: null }, request).current.reviewState, "closed");
  for (const changed of [{ recordedEvent }, { retryAllowed: true }, { outcome: "failed" }])
    assert.throws(() => parseInventedReviewRecovery({ ...value, outcome: "not_observed", recordedEvent: null, ...changed }, request));
});
test("mismatched principal event identity, history, receipt time and private extensions refuse", () => {
  for (const changed of [{ eventId: reportId }, { reportId: eventId }, { replayed: false },
    { recordedAt: "2026-10-03T07:00:00.123455Z" }, { reviewer: "selected" }])
    assert.throws(() => parseInventedReviewRecovery({ ...value, recordedEvent: { ...recordedEvent, ...changed } }, request));
  for (const changed of [{ recordedEvent: null }, { current: { ...current, reportId: eventId } },
    { current: { ...current, reviewState: "new", reviewedAt: null, events: [] } }, { details: "private body" }])
    assert.throws(() => parseInventedReviewRecovery({ ...value, ...changed }, request));
});
