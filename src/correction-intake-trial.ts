import { z } from "zod";

const edition = <R extends number>(revision: R) => z.strictObject({
  revision: z.literal(revision), privateReports: z.literal(2), targets: z.tuple([z.literal("claim"), z.literal("page")]),
  reviewState: z.literal("new"),
});
const snapshot = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("saved_invented_correction_intake"),
  recordedAt: z.iso.datetime({ offset: true }), liveStatus: z.literal(false), privateReports: z.literal(4),
  editions: z.tuple([edition(1), edition(2)]), staleEditionRefused: z.literal(true), withdrawnSourceRefused: z.literal(true),
  privateReadRefused: z.literal(true), reviewStateAssignmentRefused: z.literal(true),
  sourceRequests: z.literal(0), realReports: z.literal(0), contactCollected: z.literal(false),
  publicContentChanged: z.literal(false), liveIntakeEnabled: z.literal(false),
});

export function parseCorrectionIntakeTrial(input: unknown) { return snapshot.parse(input); }
