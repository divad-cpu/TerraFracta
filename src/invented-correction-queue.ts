import { z } from "zod";
import { correctionTargetSchema, correctionDraftFieldsSchema } from "./correction-target.ts";
import { parseInventedReviewStatus, inventedDatabaseInstantSchema as instant,
  inventedDatabaseMicroseconds as micros } from "./invented-correction-review.ts";

const id = z.uuid().regex(/^[0-9a-f-]+$/);
const issueId = "718863b9-75b8-572b-9184-3bc18a13658a";
const publications = ["92bb9213-05e0-550a-8b99-cbf65e786609", "6ac005f4-f9a0-5021-a3b5-28e1f1607397"];
const cursor = z.strictObject({ schemaVersion: z.literal(1), snapshotId: id.nullable(),
  offset: z.number().int().min(0).max(64) }).refine(value => value.offset % 2 === 0 && (value.snapshotId !== null || value.offset === 0));
export function parseInventedQueueRequest(input: unknown) { return cursor.parse(input); }
export function parseInventedDetailRequest(input: unknown) {
  return z.strictObject({ schemaVersion: z.literal(1), snapshotId: id, reportId: id }).parse(input);
}
const page = z.strictObject({ schemaVersion: z.literal(1), status: z.literal("private_invented_review_queue"),
  snapshotId: id, capturedAt: instant, expiresAt: instant, observedAt: instant,
  offset: z.number().int().min(0).max(64), total: z.number().int().min(0).max(64), items: z.array(z.unknown()).max(2),
  next: cursor.nullable(), membershipFrozen: z.literal(true), statesObservedPerPage: z.literal(true), liveReviewEnabled: z.literal(false),
});
export function parseInventedQueuePage(input: unknown, request: unknown) {
  const selected = cursor.parse(request), result = page.parse(input);
  if (result.offset !== selected.offset || (selected.snapshotId !== null && result.snapshotId !== selected.snapshotId) ||
      result.offset > result.total || (selected.snapshotId !== null && result.offset >= result.total) ||
      result.items.length !== Math.min(2, result.total - result.offset)) {
    throw new Error("Invented queue cursor differs");
  }
  const more = result.offset + result.items.length < result.total;
  if (more ? result.next === null || result.next.snapshotId !== result.snapshotId || result.next.offset !== result.offset + 2
      : result.next !== null) throw new Error("Invented queue continuation differs");
  const captured = micros(result.capturedAt), expiry = micros(result.expiresAt), observed = micros(result.observedAt);
  if (expiry <= captured || expiry - captured > BigInt(120_000_000) || observed < captured || observed >= expiry) {
    throw new Error("Invented queue lifetime differs");
  }
  const items = result.items.map(parseInventedReviewStatus);
  if (new Set(items.map(item => item.reportId)).size !== items.length || items.some(item =>
      !publications.includes(item.publicationId) || micros(item.reportedAt) > captured ||
      item.reviewedAt !== null && micros(item.reviewedAt) > observed)) throw new Error("Invented queue item differs");
  for (let index = 1; index < items.length; index++) {
    const prior = items[index - 1], item = items[index], before = micros(prior.reportedAt), after = micros(item.reportedAt);
    if (after < before || after === before && item.reportId <= prior.reportId) throw new Error("Invented queue item order differs");
  }
  return { ...result, items };
}

// Decode the stored PostgreSQL text exactly. Editor normalization is a separate
// input operation; applying it here would silently alter valid stored evidence.
const storedFields = z.strictObject({ kind: correctionDraftFieldsSchema.shape.kind,
  details: z.string().refine(value => {
    const count = [...value].length;
    return count >= 10 && count <= 1000 && value === value.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "") &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) && !/[\ud800-\udfff]/u.test(value);
  }), sourceUrl: z.union([z.literal(""), z.literal("https://example.org/fictional-correction-evidence")]),
});
const detail = z.strictObject({ schemaVersion: z.literal(1), status: z.literal("private_invented_review_detail"),
  snapshotId: id, report: z.unknown(), draft: z.strictObject({ target: correctionTargetSchema,
    fields: storedFields }),
});
export function parseInventedReviewDetail(input: unknown, request: unknown) {
  const selected = parseInventedDetailRequest(request), result = detail.parse(input), report = parseInventedReviewStatus(result.report);
  const target = result.draft.target;
  if (result.snapshotId !== selected.snapshotId || report.reportId !== selected.reportId || report.publicationId !== target.publicationId || target.issueId !== issueId ||
      ![1, 2].includes(target.revision) || target.publicationId !== publications[target.revision - 1] ||
      target.jurisdictionSlug !== "fictional-country" || target.issueSlug !== "fictional-share") {
    throw new Error("Invented review detail identity differs");
  }
  return { ...result, report };
}
