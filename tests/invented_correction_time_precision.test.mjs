import assert from "node:assert/strict";
import test from "node:test";
import { parseInventedReviewStatus, parseInventedReviewReceipt } from "../src/invented-correction-review.ts";
const reportId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const first = { sequence: 1, fromState: "new", toState: "in_review", recordedAt: "2026-10-03T05:00:00.000001+00:00" };
const second = { sequence: 2, fromState: "in_review", toState: "closed", recordedAt: "2026-10-03T05:00:00.000002+00:00" };
const status = () => ({ schemaVersion: 1, status: "private_review_snapshot", reportId, publicationId: eventId,
  reviewState: "closed", reportedAt: "2026-10-03T05:00:00.000000+00:00", reviewedAt: second.recordedAt, events: [first, second] });
test("a one-microsecond earlier first review is refused", () => {
  assert.throws(() => parseInventedReviewStatus({ ...status(), reportedAt: "2026-10-03T05:00:00.000002+00:00" }));
});
test("a one-microsecond backwards closure is refused", () => {
  assert.throws(() => parseInventedReviewStatus({ ...status(), reviewedAt: "2026-10-03T05:00:00.000000Z",
    events: [first, { ...second, recordedAt: "2026-10-03T05:00:00.000000Z" }] }));
});
test("a one-microsecond mismatch in the latest review timestamp is refused", () => {
  assert.throws(() => parseInventedReviewStatus({ ...status(), reviewedAt: "2026-10-03T05:00:00.000003Z" }));
});
test("equal microsecond instants with different offsets and pre-epoch instants accept", () => {
  assert.equal(parseInventedReviewStatus({ ...status(), reviewedAt: "2026-10-03T07:00:00.000002+02:00" }).events.length, 2);
  const value = status(); value.reportedAt = "1969-12-31T23:59:59.123454Z";
  value.events = [{ ...first, recordedAt: "1969-12-31T23:59:59.123455Z" }, { ...second, recordedAt: "1969-12-31T23:59:59.123456Z" }];
  value.reviewedAt = value.events[1].recordedAt;
  assert.equal(parseInventedReviewStatus(value).reviewState, "closed");
  assert.throws(() => parseInventedReviewStatus({ ...value, reviewedAt: "1969-12-31T23:59:59.123457Z" }));
});
test("precision beyond the database's six decimal places cannot appear checked", () => {
  assert.throws(() => parseInventedReviewStatus({ ...status(), reportedAt: "2026-10-03T05:00:00.0000001Z" }));
  const request = { schemaVersion: 1, eventId, reportId, expectedState: "new", nextState: "in_review", resolutionNote: null };
  assert.throws(() => parseInventedReviewReceipt({ schemaVersion: 1, status: "recorded_private_transition", eventId, reportId,
    ...first, recordedAt: "2026-10-03T05:00:00.0000001Z", replayed: false }, request));
});
