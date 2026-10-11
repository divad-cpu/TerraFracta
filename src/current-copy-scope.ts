import { z } from "zod";
import { isRecentUtcObservation } from "./exact-utc-observation.ts";

const utc = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/)
  .refine(value => !value.startsWith("0000-"));
const observation = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("current_local_copy_scope_observation"),
  recordedAt: utc, pointInTimeOnly: z.literal(true), state: z.literal("held"),
  backupExclusion: z.enum(["observed", "not_established"]), syncSetup: z.enum(["present", "not_found", "unavailable"]),
  otherCopies: z.literal("owner_context_pending"), allCopyPathsVerified: z.literal(false),
  credentialFilesRead: z.literal(false), rawBodiesRead: z.literal(false), configurationChanged: z.literal(false),
  sourceRequests: z.literal(0), collectionPermissionIssued: z.literal(false), publicationEnabled: z.literal(false),
});
const status = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("observed"), observation }),
  z.strictObject({ state: z.literal("held"), reason: z.literal("copy_observation_unavailable") }),
]);
export type CurrentCopyScopeStatus = z.infer<typeof status>;
export function parseCurrentCopyScopeStatus(input: unknown): CurrentCopyScopeStatus { return status.parse(input); }
export function requireRecentCopyScopeStatus(input: unknown, now = Date.now()): CurrentCopyScopeStatus {
  const value = parseCurrentCopyScopeStatus(input);
  if (value.state === "observed") {
    if (!isRecentUtcObservation(value.observation.recordedAt, now)) throw new Error("Copy observation time unavailable");
  }
  return value;
}
