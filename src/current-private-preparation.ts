import { z } from "zod";
import { isRecentUtcObservation } from "./exact-utc-observation.ts";

const check = <K extends string>(key: K) => z.strictObject({ key: z.literal(key), state: z.enum(["observed", "held"]) });
const utc = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/)
  .refine(value => !value.startsWith("0000-"));
const observation = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("current_local_preparation_observation"),
  recordedAt: utc, state: z.literal("held"), liveStatus: z.literal(false), pointInTimeOnly: z.literal(true),
  sourceReview: z.literal("private_attempt_supported"), retentionDays: z.literal(30),
  checks: z.tuple([check("cleanupSnapshot"), check("cleanupUnitBytes"), check("cleanupManager"),
    check("cleanupHistory"), check("selectedRawFolder")]),
  copyScope: z.literal("owner_context_pending"), liveEntry: z.literal("not_bound"), privateWriter: z.literal("not_selected"),
  sourceRequests: z.literal(0), collectionPermissionIssued: z.literal(false), publicationEnabled: z.literal(false),
});
const status = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("observed"), observation }),
  z.strictObject({ state: z.literal("held"), reason: z.literal("local_observation_unavailable") }),
]);
export type CurrentPreparationStatus = z.infer<typeof status>;
export function parseCurrentPreparationStatus(input: unknown): CurrentPreparationStatus { return status.parse(input); }
export function requireRecentPreparationStatus(input: unknown, now = Date.now()): CurrentPreparationStatus {
  const value = parseCurrentPreparationStatus(input);
  if (value.state === "observed") {
    if (!isRecentUtcObservation(value.observation.recordedAt, now)) throw new Error("Current observation time unavailable");
  }
  return value;
}
