import { z } from "zod";
import { compareRecordedInstants } from "./recorded-instant-order.ts";

const recordedTime = z.iso.datetime({ offset: true });

const count = z.number().int().min(0).max(50);
const trial = z.strictObject({
  caseKey: z.enum(["shared_limit", "measured_replay", "crash_takeover"]),
  savedAt: recordedTime,
  byteCap: z.literal(101), chargedBytes: z.number().int().min(0).max(101),
  reservations: z.literal(1), dispatches: count, settlements: count, workClaims: count.min(1),
}).superRefine((entry, context) => {
  const agrees = entry.caseKey === "shared_limit"
    ? entry.chargedBytes === 101 && entry.dispatches === 0 && entry.settlements === 0 && entry.workClaims === 1
    : entry.caseKey === "measured_replay"
      ? entry.chargedBytes === 3 && entry.dispatches === 1 && entry.settlements === 1 && entry.workClaims === 1
      : entry.chargedBytes === 101 && entry.dispatches === 1 && entry.settlements === 0 && entry.workClaims === 2;
  if (!agrees) context.addIssue({ code: "custom", message: "Named retained response outcome disagrees with counts" });
});

const snapshot = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("isolated_fictional_response_reservations"),
  recordedAt: recordedTime, actualSourceFetches: z.literal(0),
  liveCollectionEnabled: z.literal(false), livePublicationEnabled: z.literal(false),
  displayedRuns: z.literal(3), cases: z.array(trial).length(3),
}).superRefine((record, context) => {
  // Retain Zod validation failure without invoking chronology on invalid leaf times.
  if ([record.recordedAt, ...record.cases.map(entry => entry.savedAt)]
      .some(value => !recordedTime.safeParse(value).success)) return;
  if (new Set(record.cases.map((entry) => entry.caseKey)).size !== 3 ||
      record.cases.some((entry) => compareRecordedInstants(entry.savedAt, record.recordedAt) > 0)) {
    context.addIssue({ code: "custom", message: "Retained response trial set or recording time disagrees" });
  }
});

export type FictionalResponseSnapshot = z.infer<typeof snapshot>;
export function parseFictionalResponseSnapshot(input: unknown): FictionalResponseSnapshot {
  return snapshot.parse(input);
}
