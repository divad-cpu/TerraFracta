import { z } from "zod";

// Closed invented-only contracts. A recorded transition is historical; replay
// of an old event must not be mistaken for the current review state.
export const inventedClosureNote = "Invented technical closure; no public content was changed.";
const privateId = z.uuid().regex(/^[0-9a-f-]+$/);
const databaseInstant = z.iso.datetime({ offset: true }).refine(value =>
  (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1].length ?? 0) <= 6 && Number.isSafeInteger(Date.parse(value)));
function microseconds(value: string): bigint {
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "";
  // Date.parse retains milliseconds. Add the remaining PostgreSQL precision
  // as an integer, including for negative epochs and equivalent UTC offsets.
  return BigInt(Date.parse(value)) * BigInt(1000) + BigInt(fraction.padEnd(6, "0").slice(3));
}
export { databaseInstant as inventedDatabaseInstantSchema, microseconds as inventedDatabaseMicroseconds };
const transition = z.strictObject({
  schemaVersion: z.literal(1), eventId: privateId, reportId: privateId,
  expectedState: z.enum(["new", "in_review"]), nextState: z.enum(["in_review", "closed"]),
  resolutionNote: z.literal(inventedClosureNote).nullable(),
}).refine(value => value.expectedState === "new"
  ? value.nextState === "in_review" && value.resolutionNote === null
  : value.nextState === "closed" && value.resolutionNote === inventedClosureNote);
export type InventedReviewRequest = z.infer<typeof transition>;
export function parseInventedReviewRequest(input: unknown) { return transition.parse(input); }

const event = z.strictObject({ sequence: z.union([z.literal(1), z.literal(2)]),
  fromState: z.enum(["new", "in_review"]), toState: z.enum(["in_review", "closed"]),
  recordedAt: databaseInstant,
}).refine(value => value.sequence === 1
  ? value.fromState === "new" && value.toState === "in_review"
  : value.fromState === "in_review" && value.toState === "closed");
const receipt = z.strictObject({
  schemaVersion: z.literal(1), status: z.literal("recorded_private_transition"), eventId: privateId, reportId: privateId,
  sequence: z.union([z.literal(1), z.literal(2)]), fromState: z.enum(["new", "in_review"]),
  toState: z.enum(["in_review", "closed"]), recordedAt: databaseInstant, replayed: z.boolean(),
});
export function parseInventedReviewReceipt(input: unknown, request: InventedReviewRequest) {
  const selected = transition.parse(request), result = receipt.parse(input);
  event.parse({ sequence: result.sequence, fromState: result.fromState, toState: result.toState, recordedAt: result.recordedAt });
  if (result.eventId !== selected.eventId || result.reportId !== selected.reportId ||
      result.fromState !== selected.expectedState || result.toState !== selected.nextState) {
    throw new Error("Invented review receipt identity differs");
  }
  return result;
}

const status = z.strictObject({
  schemaVersion: z.literal(1), status: z.literal("private_review_snapshot"), reportId: privateId, publicationId: privateId,
  reviewState: z.enum(["new", "in_review", "closed"]), reportedAt: databaseInstant,
  reviewedAt: databaseInstant.nullable(), events: z.array(event).max(2),
});
export function parseInventedReviewStatus(input: unknown) {
  const result = status.parse(input);
  const expectedCount = { new: 0, in_review: 1, closed: 2 }[result.reviewState];
  if (result.events.length !== expectedCount || result.events.some((item, index) => item.sequence !== index + 1) ||
      (expectedCount === 0 ? result.reviewedAt !== null : result.reviewedAt === null)) {
    throw new Error("Invented review history differs");
  }
  let previous = microseconds(result.reportedAt);
  for (const item of result.events) {
    const atTime = microseconds(item.recordedAt);
    if (atTime < previous) throw new Error("Invented review time precedes its history");
    previous = atTime;
  }
  if (expectedCount && microseconds(result.reviewedAt!) !== previous) throw new Error("Invented review timestamp differs");
  return result;
}
