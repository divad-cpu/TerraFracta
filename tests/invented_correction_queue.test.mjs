import assert from "node:assert/strict";
import test from "node:test";
import { parseInventedQueueRequest, parseInventedQueuePage, parseInventedReviewDetail } from "../src/invented-correction-queue.ts";

const snapshotId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const publicationId = "92bb9213-05e0-550a-8b99-cbf65e786609";
const request = { schemaVersion: 1, snapshotId: null, offset: 0 };
const report = index => ({ schemaVersion: 1, status: "private_review_snapshot",
  reportId: `bbbbbbb${index}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, publicationId, reviewState: "new",
  reportedAt: "2026-10-03T05:00:00.000001Z", reviewedAt: null, events: [] });
const page = () => ({ schemaVersion: 1, status: "private_invented_review_queue", snapshotId,
  capturedAt: "2026-10-03T05:00:00.000002Z", expiresAt: "2026-10-03T05:02:00.000002Z",
  observedAt: "2026-10-03T05:00:00.000003Z", offset: 0, total: 3, items: [report(1), report(2)],
  next: { schemaVersion: 1, snapshotId, offset: 2 }, membershipFrozen: true, statesObservedPerPage: true, liveReviewEnabled: false });
const detail = () => ({ schemaVersion: 1, status: "private_invented_review_detail", snapshotId, report: report(1),
  draft: { target: { issueId: "718863b9-75b8-572b-9184-3bc18a13658a", publicationId, revision: 1,
    jurisdictionSlug: "fictional-country", issueSlug: "fictional-share", claimId: null },
    fields: { kind: "missing_context", details: "Invented explanation for a private technical correction test.",
      sourceUrl: "https://example.org/fictional-correction-evidence" } } });

test("fixed membership pages and empty result retain exact request identity", () => {
  const first = parseInventedQueuePage(page(), request);
  assert.equal(first.items.length, 2);
  const last = { ...page(), offset: 2, items: [report(3)], next: null };
  assert.equal(parseInventedQueuePage(last, first.next).items[0].reportId, report(3).reportId);
  assert.equal(parseInventedQueuePage({ ...page(), total: 0, items: [], next: null }, request).total, 0);
});
test("cursor substitution, omitted continuation, duplicate items and invented live promotion refuse", () => {
  const mutations = [p => p.next = null, p => p.next.snapshotId = report(1).reportId,
    p => p.next.offset = 4, p => p.items[1] = p.items[0], p => p.items.reverse(),
    p => p.items[0].details = "private-canary", p => p.liveReviewEnabled = true, p => p.total = 65,
    p => p.offset = 2];
  for (const mutate of mutations) { const changed = page(); mutate(changed); assert.throws(() => parseInventedQueuePage(changed, request)); }
  for (const offset of [1, -2, 66, 2.5]) assert.throws(() => parseInventedQueueRequest({ ...request, offset }));
  assert.throws(() => parseInventedQueueRequest({ ...request, issueId: "client-selected" }));
  assert.throws(() => parseInventedQueuePage({ ...page(), total: 2, offset: 2, items: [], next: null },
    { schemaVersion: 1, snapshotId, offset: 2 }));
  assert.throws(() => parseInventedQueuePage({ ...page(), total: 0, items: [], next: null },
    { schemaVersion: 1, snapshotId, offset: 0 }));
});
test("microsecond expiry, capture time and precision cannot be silently rounded", () => {
  for (const change of [{ observedAt: "2026-10-03T05:02:00.000002Z" },
    { observedAt: "2026-10-03T05:00:00.000001Z" }, { expiresAt: "2026-10-03T05:02:00.000003Z" },
    { capturedAt: "2026-10-03T05:00:00.0000009Z" }]) assert.throws(() => parseInventedQueuePage({ ...page(), ...change }, request));
  const futureReport = page(); futureReport.items[0].reportedAt = "2026-10-03T05:00:00.000003Z";
  assert.throws(() => parseInventedQueuePage(futureReport, request));
});
test("detail binds ticket, report, exact publication and bounded closed source fields", () => {
  const selected = { schemaVersion: 1, snapshotId, reportId: report(1).reportId };
  assert.equal(parseInventedReviewDetail(detail(), selected).draft.target.revision, 1);
  for (const mutate of [d => d.snapshotId = report(1).reportId, d => d.report.reportId = report(2).reportId,
    d => d.draft.target.revision = 2, d => d.draft.fields.details = "short",
    d => d.draft.target.issueSlug = "other", d => d.password = "canary"]) {
    const changed = detail(); mutate(changed); assert.throws(() => parseInventedReviewDetail(changed, selected));
  }
  const alternate = detail(); alternate.draft.fields = { kind: "accessibility_problem",
    details: "Invented alternative page explanation with no source URL.", sourceUrl: "" };
  assert.equal(parseInventedReviewDetail(alternate, selected).draft.fields.sourceUrl, "");
  alternate.draft.fields.sourceUrl = "https://example.net/other";
  assert.throws(() => parseInventedReviewDetail(alternate, selected));
});
test("stored explanations preserve nonbreaking spaces and PostgreSQL code-point lengths exactly", () => {
  const selected = { schemaVersion: 1, snapshotId, reportId: report(1).reportId };
  for (const text of ["\u00a0Invented explanation with nonbreaking spaces.\u00a0", "😀".repeat(600), "😀".repeat(1000)]) {
    const value = detail(); value.draft.fields.details = text;
    assert.equal(parseInventedReviewDetail(value, selected).draft.fields.details, text);
  }
  for (const text of [" Ordinary leading space is not canonical.", "Ordinary trailing space is not canonical. ",
    "😀".repeat(1001), "Invented\u0007control character", "Invented lone surrogate \ud800 body"]) {
    const value = detail(); value.draft.fields.details = text;
    assert.throws(() => parseInventedReviewDetail(value, selected));
  }
});
