import { z } from "zod";
import { compareRecordedInstants } from "./recorded-instant-order.ts";

const recordedTime = z.iso.datetime({ offset: true });

const count = z.number().int().min(0).max(50);
const trial = z.strictObject({
  caseKey: z.enum(["stored_fact", "held_finished", "missing_decision"]),
  finishedAt: recordedTime,
  runState: z.enum(["completed", "partial"]),
  commitState: z.enum(["none", "committed", "partial"]),
  visibilityState: z.enum(["not_required", "pending", "verified", "failed", "mixed"]),
  expectedSources: count.min(1), coveredSources: count,
  expectedItems: count, decidedItems: count, heldItems: count, pendingItems: count,
  storedFacts: count, visibleFacts: count,
}).superRefine((entry, context) => {
  const namedOutcomeAgrees = entry.caseKey === "stored_fact"
    ? entry.storedFacts > 0 && entry.visibleFacts === 0 && entry.visibilityState === "pending" &&
      entry.runState === "partial" && entry.commitState === "committed"
    : entry.caseKey === "held_finished"
      ? entry.heldItems > 0 && entry.runState === "completed" && entry.storedFacts === 0
      : entry.decidedItems < entry.expectedItems && entry.pendingItems > 0 &&
        entry.runState === "partial" && entry.storedFacts === 0;
  if (!namedOutcomeAgrees) {
    context.addIssue({ code: "custom", message: "Named fictional outcome disagrees with stored stages" });
  }
  if (entry.coveredSources > entry.expectedSources || entry.decidedItems > entry.expectedItems ||
      entry.heldItems > entry.decidedItems || entry.pendingItems > entry.expectedItems ||
      entry.storedFacts > entry.decidedItems || entry.visibleFacts > entry.storedFacts ||
      (entry.commitState === "none") !== (entry.storedFacts === 0) ||
      (entry.visibilityState === "not_required") !== (entry.storedFacts === 0) ||
      (entry.visibilityState === "verified" && entry.visibleFacts !== entry.storedFacts) ||
      (entry.runState === "completed" && (entry.coveredSources !== entry.expectedSources ||
        entry.decidedItems !== entry.expectedItems || entry.pendingItems !== 0 || entry.visibleFacts !== entry.storedFacts))) {
    context.addIssue({ code: "custom", message: "Stored fictional stages or counts disagree" });
  }
});

const snapshot = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("isolated_fictional_closeouts"),
  recordedAt: recordedTime,
  liveCollectionEnabled: z.literal(false), livePublicationEnabled: z.literal(false),
  displayedRuns: z.literal(3), sourceContentVersions: z.literal(1), freshSourceChecks: z.literal(3), unchangedSourceChecks: z.literal(2),
  cases: z.array(trial).length(3),
}).superRefine((record, context) => {
  // Retain Zod validation failure without invoking chronology on invalid leaf times.
  if ([record.recordedAt, ...record.cases.map(entry => entry.finishedAt)]
      .some(value => !recordedTime.safeParse(value).success)) return;
  if (new Set(record.cases.map((entry) => entry.caseKey)).size !== 3 ||
      record.cases.some((entry) => compareRecordedInstants(entry.finishedAt, record.recordedAt) > 0)) {
    context.addIssue({ code: "custom", message: "Fictional trial set or recording time disagrees" });
  }
});

export type FictionalCompletionSnapshot = z.infer<typeof snapshot>;

export function parseFictionalCompletionSnapshot(input: unknown): FictionalCompletionSnapshot {
  return snapshot.parse(input);
}
