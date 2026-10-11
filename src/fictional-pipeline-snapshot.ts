import { z } from "zod";
import { compareRecordedInstants } from "./recorded-instant-order.ts";

const recordedTime = z.iso.datetime({ offset: true });

const caseKey = z.enum(["stored_fact", "held_finished", "missing_decision"]);
const sample = z.strictObject({
  caseKey, finishedAt: recordedTime,
  runState: z.enum(["completed", "partial"]), commitState: z.enum(["none", "committed"]),
  visibilityState: z.enum(["not_required", "pending"]), fixtureReads: z.literal(1),
  reservedBytes: z.literal(65537), measuredBytes: z.number().int().min(1).max(65536),
  sourceChecks: z.literal(1), savedManifests: z.literal(1), expectedItems: z.literal(1),
  decidedItems: z.number().int().min(0).max(1), heldItems: z.number().int().min(0).max(1),
  storedFacts: z.number().int().min(0).max(1), pendingItems: z.number().int().min(0).max(1),
  visibleFacts: z.literal(0),
}).superRefine((entry, context) => {
  const expected = {
    stored_fact: ["partial", "committed", "pending", 1, 0, 1, 0],
    held_finished: ["completed", "none", "not_required", 1, 1, 0, 0],
    missing_decision: ["partial", "none", "not_required", 0, 0, 0, 1],
  }[entry.caseKey];
  const actual = [entry.runState, entry.commitState, entry.visibilityState, entry.decidedItems,
    entry.heldItems, entry.storedFacts, entry.pendingItems];
  if (actual.some((value, index) => value !== expected[index])) {
    context.addIssue({ code: "custom", message: "Saved pipeline stages disagree with the named outcome" });
  }
});

const snapshot = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("isolated_fictional_captured_pipeline"),
  recordedAt: recordedTime, liveCollectionEnabled: z.literal(false),
  livePublicationEnabled: z.literal(false), runtimeVisibilityVerified: z.literal(false),
  externalSourceRequests: z.literal(0), displayRollbackVerified: z.literal(true),
  cases: z.array(sample).length(3),
  fact: z.strictObject({
    assertion: z.literal("In 2025, the fictional share was 27.4%."), periodLabel: z.literal("2025"),
    publisher: z.literal("Fictional statistics office"), title: z.literal("Fictional housing table"),
    url: z.literal("https://example.org/fictional-table"),
    locator: z.literal("series=fictional-share;geography=fictional-country;period=2025"),
    retrievedAt: recordedTime, lastEvidenceReviewOn: z.iso.date(),
  }),
}).superRefine((record, context) => {
  // Retain Zod validation failure without invoking chronology on invalid leaf times.
  if ([record.recordedAt, ...record.cases.map(entry => entry.finishedAt), record.fact.retrievedAt]
      .some(value => !recordedTime.safeParse(value).success)) return;
  if (new Set(record.cases.map((entry) => entry.caseKey)).size !== 3 ||
      new Set(record.cases.map((entry) => entry.measuredBytes)).size !== 1 ||
      record.cases.some((entry) => compareRecordedInstants(entry.finishedAt, record.recordedAt) > 0) ||
      compareRecordedInstants(record.fact.retrievedAt, record.cases.find((entry) => entry.caseKey === "stored_fact")!.finishedAt) > 0 ||
      record.fact.lastEvidenceReviewOn < record.fact.retrievedAt.slice(0, 10)) {
    context.addIssue({ code: "custom", message: "Fictional pipeline coverage or chronology disagrees" });
  }
});

export type FictionalPipelineSnapshot = z.infer<typeof snapshot>;
export type PipelineCase = FictionalPipelineSnapshot["cases"][number];
export type PipelineStage = { key: string; title: string; status: "passed" | "held" | "pending" | "not_needed"; detail: string };

export function parseFictionalPipelineSnapshot(input: unknown): FictionalPipelineSnapshot {
  return snapshot.parse(input);
}

export function pipelineStages(entry: PipelineCase): PipelineStage[] {
  // Re-validate before deriving labels; caller-supplied counters cannot grant a pass.
  const checked = sample.parse(entry);
  return [
    { key: "allowance", title: "Reading allowance saved", status: "passed", detail: `${checked.reservedBytes.toLocaleString("en-GB")} bytes reserved before reading.` },
    { key: "capture", title: "Source read once", status: "passed", detail: `${checked.measuredBytes} bytes measured from one local fictional fixture.` },
    { key: "source", title: "Source checked", status: "passed", detail: "The saved source version matches the measured content." },
    { key: "plan", title: "Expected finding saved", status: "passed", detail: "One expected finding stays in the record until it is resolved." },
    { key: "decision", title: "Finding decided", status: checked.heldItems ? "held" : checked.decidedItems ? "passed" : "pending", detail: checked.heldItems ? "The conflict is recorded and the finding is held." : checked.decidedItems ? "The fixed checks passed for the invented fact." : "The expected finding has no saved decision." },
    { key: "storage", title: "Fact stored", status: checked.storedFacts ? "passed" : "not_needed", detail: checked.storedFacts ? "One invented fact and its exact source link were saved." : "No fact was activated in this trial." },
    { key: "closeout", title: "Processing recorded", status: "passed", detail: checked.runState === "completed" ? "The held finding is resolved; processing finished." : "The saved result preserves the remaining work." },
    { key: "visibility", title: "Website views confirmed", status: checked.storedFacts ? "pending" : "not_needed", detail: checked.storedFacts ? "Issue page, overview, source panel and search still need independent checks." : "No activated fact requires a website check." },
  ];
}
