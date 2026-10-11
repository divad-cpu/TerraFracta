import { z } from "zod";
import { inventedDatabaseMicroseconds, parseInventedReviewRequest, parseInventedReviewReceipt,
  parseInventedReviewStatus } from "./invented-correction-review.ts";

// An observation of a private historical event, never a retry instruction.
const recovery = z.strictObject({ schemaVersion: z.literal(1),
  status: z.literal("private_invented_review_recovery"), outcome: z.enum(["recorded", "not_observed"]),
  recordedEvent: z.unknown(), current: z.unknown(),
});
export function parseInventedReviewRecovery(input: unknown, request: unknown) {
  const selected = parseInventedReviewRequest(request), result = recovery.parse(input);
  const current = parseInventedReviewStatus(result.current);
  if (current.reportId !== selected.reportId) throw new Error("Invented recovery report differs");
  if (result.outcome === "not_observed") {
    if (result.recordedEvent !== null) throw new Error("Invented missing event has a receipt");
    return { ...result, recordedEvent: null, current };
  }
  const recordedEvent = parseInventedReviewReceipt(result.recordedEvent, selected);
  const historical = current.events[recordedEvent.sequence - 1];
  if (!recordedEvent.replayed || !historical || historical.fromState !== recordedEvent.fromState ||
      historical.toState !== recordedEvent.toState ||
      inventedDatabaseMicroseconds(historical.recordedAt) !== inventedDatabaseMicroseconds(recordedEvent.recordedAt)) {
    throw new Error("Invented recovered event differs from current history");
  }
  return { ...result, recordedEvent, current };
}
