import { z } from "zod";
import { compareRecordedInstants } from "./recorded-instant-order.ts";

const recordedTime = z.iso.datetime({ offset: true });

const captureFailure = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("isolated_fictional_capture_failure"),
  recordedAt: recordedTime, finishedAt: recordedTime,
  runtimeEnabled: z.literal(false), externalSourceRequests: z.literal(0), runState: z.literal("partial"),
  storedFacts: z.literal(0), requiredSources: z.literal(2), coveredSources: z.literal(0),
  failedSources: z.literal(1), deferredSources: z.literal(1), savedSourceChecks: z.literal(2), savedCloseouts: z.literal(1),
  readingAllowanceBytes: z.literal(65537), retainedChargeBytes: z.literal(65537), measuredResponseBytes: z.null(),
  dependentSourceRequests: z.literal(0), sourceVersions: z.literal(0), expectedFindings: z.literal(0),
}).superRefine((record, context) => {
  // Retain Zod validation failure without invoking chronology on invalid leaf times.
  if ([record.recordedAt, record.finishedAt]
      .some(value => !recordedTime.safeParse(value).success)) return;
  if (compareRecordedInstants(record.finishedAt, record.recordedAt) > 0) {
    context.addIssue({ code: "custom", message: "The recorded incomplete run has impossible chronology" });
  }
});

export type FictionalCaptureFailure = z.infer<typeof captureFailure>;
export function parseFictionalCaptureFailure(input: unknown): FictionalCaptureFailure {
  return captureFailure.parse(input);
}
