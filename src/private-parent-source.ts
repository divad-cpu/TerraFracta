import { z } from "zod";

const utcTime = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)$/).refine((value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() > 0 && date.toISOString().slice(0, 19) === value.slice(0, 19);
}, "Valid UTC observation time required");

export const privateParentSourceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidenceKind: z.literal("saved_private_parent_api_source_preparation"),
  recordedAt: utcTime,
  state: z.literal("held"),
  sourceFiles: z.number().int().min(4).max(132),
  privateApiVersion: z.literal(2),
  sourceBytesVerified: z.literal(true),
  candidateModulesImported: z.literal(false),
  workerExecuted: z.literal(false),
  completeRuntimeSealed: z.literal(false),
  deploymentReviewComplete: z.literal(false),
  operationalContextSelected: z.literal(false),
  copyCoverageAccepted: z.literal(false),
  collectionPermissionIssued: z.literal(false),
  sourceRequests: z.literal(0),
  publicationEnabled: z.literal(false),
  scheduleEnabled: z.literal(false),
  externalBackup: z.literal(false),
});

export type PrivateParentSource = z.infer<typeof privateParentSourceSchema>;
export function parsePrivateParentSource(value: unknown): PrivateParentSource {
  return privateParentSourceSchema.parse(value);
}
