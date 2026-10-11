import { z } from "zod";
import { inventedDatabaseInstantSchema as instant, inventedDatabaseMicroseconds as micros } from "./invented-correction-review.ts";
const row = (sample: number, revision: 1 | 2) => z.strictObject({ sample: z.literal(sample), revision: z.literal(revision),
  reportedAt: instant, reviewState: z.literal("new") });
const saved = z.strictObject({ schemaVersion: z.literal(1), evidenceKind: z.literal("saved_invented_correction_queue_membership"),
  capturedAt: instant, liveStatus: z.literal(false), earlierCapturedMembers: z.literal(4), capturedMembers: z.literal(5),
  reports: z.tuple([row(1, 1), row(2, 1), row(3, 2), row(4, 2), row(5, 2)]),
  privateDetailsExported: z.literal(false), reviewActionsEnabled: z.literal(false),
  sourceRequests: z.literal(0), realReports: z.literal(0), publicContentChanged: z.literal(false),
}).refine(value => value.reports.every((item, index) => micros(item.reportedAt) <= micros(value.capturedAt) &&
  (index === 0 || micros(item.reportedAt) >= micros(value.reports[index - 1].reportedAt))));
export type CorrectionQueueTrial = z.infer<typeof saved>;
export function parseCorrectionQueueTrial(input: unknown) { return saved.parse(input); }
