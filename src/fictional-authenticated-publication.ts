import { z } from "zod";

const snapshot = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("isolated_authenticated_fictional_publication"),
  recordedAt: z.iso.datetime({ offset: true }), realSourceRequests: z.literal(0),
  livePublicationEnabled: z.literal(false), websiteVisibilityVerified: z.literal(false),
  qualifiedFactStored: z.literal(1), withdrawnRightsHeld: z.literal(1),
  badDisplayRolledBack: z.literal(true), expiredPermissionRolledBack: z.literal(true),
  simultaneousAttempts: z.literal(2), resultingActivations: z.literal(1), replayRefetched: z.literal(false),
});

export function parseFictionalAuthenticatedPublication(input: unknown) {
  return snapshot.parse(input);
}
