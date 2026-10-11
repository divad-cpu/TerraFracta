import { z } from "zod";

const fault = <S extends string, P extends number, C extends number>(scenario: S, pairs: P, closeouts: C) =>
  z.strictObject({ scenario: z.literal(scenario), result: z.literal("held"), savedPairs: z.literal(pairs),
    savedCloseouts: z.literal(closeouts), automaticRetry: z.literal(false) });

const snapshot = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("saved_invented_private_custodian_trial"),
  recordedAt: z.iso.datetime({ offset: true }), liveStatus: z.literal(false), nativeAdmissionChecked: z.literal(true),
  savedPairs: z.literal(1), pendingYears: z.tuple([z.literal(2024), z.literal(2025)]),
  rawBindingMatched: z.literal(true), ownedProcessesEnded: z.literal(true),
  faults: z.tuple([fault("metadata_dispatch_receipt_lost", 0, 0), fault("store_receipt_lost", 1, 0),
    fault("closeout_receipt_lost", 1, 1)]),
  sourceRequests: z.literal(0), modelCalls: z.literal(0), publicQualificationIssued: z.literal(false),
  checkpointAdvanced: z.literal(false), publicationEnabled: z.literal(false),
});

export function parsePrivateCustodianTrial(input: unknown) { return snapshot.parse(input); }
