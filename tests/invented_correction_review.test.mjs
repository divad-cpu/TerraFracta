import assert from "node:assert/strict";
import test from "node:test";
import { inventedClosureNote, parseInventedReviewRequest, parseInventedReviewReceipt, parseInventedReviewStatus } from "../src/invented-correction-review.ts";
const reportId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const start = () => ({ schemaVersion: 1, eventId, reportId, expectedState: "new", nextState: "in_review", resolutionNote: null });
const finish = () => ({ ...start(), expectedState: "in_review", nextState: "closed", resolutionNote: inventedClosureNote });
const events = [
  { sequence: 1, fromState: "new", toState: "in_review", recordedAt: "2026-10-03T05:00:01+00:00" },
  { sequence: 2, fromState: "in_review", toState: "closed", recordedAt: "2026-10-03T05:00:02+00:00" },
];
const closed = () => ({ schemaVersion: 1, status: "private_review_snapshot", reportId, publicationId: eventId,
  reviewState: "closed", reportedAt: "2026-10-03T05:00:00+00:00", reviewedAt: events[1].recordedAt, events });
test("only the two declared invented transitions accept, with no client audit authority", () => {
  assert.deepEqual(parseInventedReviewRequest(start()), start()); assert.deepEqual(parseInventedReviewRequest(finish()), finish());
  for (const input of [{ ...start(), nextState: "closed" }, { ...finish(), expectedState: "closed" },
    { ...start(), resolutionNote: inventedClosureNote }, { ...finish(), resolutionNote: null },
    { ...finish(), resolutionNote: "A real report outcome" }, { ...start(), reviewedAt: events[0].recordedAt },
    { ...start(), reviewer: "client-selected" }, { ...start(), eventId: eventId.toUpperCase() },
    { ...start(), reportId: null }, { ...start(), schemaVersion: true }]) assert.throws(() => parseInventedReviewRequest(input));
});
test("historical receipt replay describes its original transition without asserting current state", () => {
  const value = { schemaVersion: 1, status: "recorded_private_transition", eventId, reportId, ...events[0], replayed: true };
  assert.deepEqual(parseInventedReviewReceipt(value, start()), value);
  assert.equal(parseInventedReviewStatus(closed()).reviewState, "closed");
  for (const change of [{ eventId: reportId }, { reportId: eventId }, { sequence: 2 },
    { toState: "closed" }, { reviewState: "in_review" }, { recordedAt: "yesterday" }, { replayed: 1 }]) {
    assert.throws(() => parseInventedReviewReceipt({ ...value, ...change }, start()));
  }
});
test("dated private status requires exact ordered history, matching clock and no report bodies", () => {
  assert.equal(parseInventedReviewStatus(closed()).events.length, 2);
  assert.equal(parseInventedReviewStatus({ ...closed(), reviewState: "new", reviewedAt: null, events: [] }).reviewState, "new");
  assert.equal(parseInventedReviewStatus({ ...closed(), reviewState: "in_review", reviewedAt: events[0].recordedAt, events: [events[0]] }).reviewState, "in_review");
  for (const change of [{ events: [events[1], events[0]] }, { events: [events[0]] }, { events: [...events, events[1]] },
    { reviewedAt: events[0].recordedAt }, { reportedAt: "2026-10-04T00:00:00Z" }, { reviewedAt: null },
    { details: "Invented private body canary" }, { sourceUrl: "https://example.org/private" },
    { events: [events[0], { ...events[1], recordedAt: "2026-10-03T04:59:59Z" }] }]) {
    assert.throws(() => parseInventedReviewStatus({ ...closed(), ...change }));
  }
});
