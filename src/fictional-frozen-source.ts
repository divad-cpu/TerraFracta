import { z } from "zod";

const held = { rawPairRetained: z.literal(true), outcomeHeld: z.literal(true), automaticRestage: z.literal(false) };
const snapshot = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("isolated_frozen_fictional_source_capture"),
  recordedAt: z.iso.datetime({ offset: true }), realSourceRequests: z.literal(0),
  livePublicationEnabled: z.literal(false), websiteVisibilityVerified: z.literal(false),
  reviewedCodeUsed: z.literal(true), admittedRequestMatched: z.literal(true),
  pairsStored: z.literal(1), sourceVersions: z.literal(2), rawPairMatched: z.literal(true),
  collectionState: z.literal("pending"), processingState: z.literal("partial"),
  faults: z.tuple([
    z.strictObject({ scenario: z.literal("database_rejected_after_raw"), databasePairStored: z.literal(false), ...held }),
    z.strictObject({ scenario: z.literal("raw_store_reply_lost"), databasePairStored: z.literal(true), ...held }),
    z.strictObject({ scenario: z.literal("raw_binding_read_before_commit"), databasePairStored: z.literal(false), ...held }),
  ]),
});

export function parseFictionalFrozenSource(input: unknown) {
  return snapshot.parse(input);
}
