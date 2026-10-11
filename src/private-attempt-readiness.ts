import { z } from "zod";

const check = <K extends string>(key: K) => z.strictObject({ key: z.literal(key), state: z.enum(["observed", "held"]) });
const snapshot = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("saved_local_private_attempt_readiness"),
  recordedAt: z.iso.datetime({ offset: true }), state: z.literal("held"), liveStatus: z.literal(false),
  sourceReview: z.literal("private_attempt_supported"), retentionDays: z.literal(30),
  checks: z.tuple([check("cleanupSnapshot"), check("cleanupUnitBytes"), check("cleanupManager"),
    check("cleanupHistory"), check("selectedRawFolder")]),
  copyScope: z.literal("owner_context_pending"), liveEntry: z.literal("not_bound"),
  privateWriter: z.literal("not_selected"), sourceRequests: z.literal(0),
  collectionPermissionIssued: z.literal(false), publicationEnabled: z.literal(false),
});

export function parsePrivateAttemptReadiness(input: unknown) {
  return snapshot.parse(input);
}
