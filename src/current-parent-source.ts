import { z } from "zod";
import { schemaCheckedUtcMicroseconds as utcMicros, isRecentUtcObservation } from "./exact-utc-observation.ts";

const utc = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/)
  .refine(value => !value.startsWith("0000-"));

const count = z.number().int().min(0).max(132);
const observation = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("current_named_parent_source_comparison"),
  recordedAt: utc, preparedAt: utc, pointInTimeOnly: z.literal(true), preparedFilesOnly: z.literal(true),
  preparedFiles: z.number().int().min(4).max(132), comparison: z.enum(["matched", "changed", "unavailable"]),
  matchedFiles: count, changedFiles: count, unavailableFiles: count,
  deploymentReviewComplete: z.literal(false), collectionPermissionIssued: z.literal(false),
  candidateModulesImported: z.literal(false), workerExecuted: z.literal(false), configurationChanged: z.literal(false),
  sourceRequests: z.literal(0), publicationEnabled: z.literal(false), scheduleEnabled: z.literal(false),
}).refine(value => value.matchedFiles + value.changedFiles + value.unavailableFiles === value.preparedFiles
  && value.comparison === (value.unavailableFiles ? "unavailable" : value.changedFiles ? "changed" : "matched")
  && utcMicros(value.preparedAt) <= utcMicros(value.recordedAt), "Comparison counts, state and chronology must agree");
const status = z.discriminatedUnion("state", [z.strictObject({ state: z.literal("observed"), observation }),
  z.strictObject({ state: z.literal("held"), reason: z.literal("parent_source_comparison_unavailable") })]);
export type CurrentParentSourceStatus = z.infer<typeof status>;
export function parseCurrentParentSource(input: unknown): CurrentParentSourceStatus { return status.parse(input); }
export function requireRecentParentSource(input: unknown, now = Date.now()): CurrentParentSourceStatus {
  const value = parseCurrentParentSource(input);
  if (value.state === "observed") {
    if (!isRecentUtcObservation(value.observation.recordedAt, now)) throw new Error("Parent comparison time unavailable");
  }
  return value;
}
