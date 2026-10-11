import { z } from "zod";

const entry = <S extends string, T extends string, P extends number, I extends boolean, C extends boolean>(
  scenario: S, state: T, savedPairs: P, rawIntegrityChecked: I, nativeCloseoutPresent: C) =>
  z.strictObject({ scenario: z.literal(scenario), state: z.literal(state), savedPairs: z.literal(savedPairs),
    rawIntegrityChecked: z.literal(rawIntegrityChecked), nativeCloseoutPresent: z.literal(nativeCloseoutPresent) });

const snapshot = z.strictObject({ schemaVersion: z.literal(1),
  evidenceKind: z.literal("saved_invented_private_attempt_recovery"), recordedAt: z.iso.datetime({ offset: true }),
  liveStatus: z.literal(false), cases: z.tuple([
    entry("before_saving", "incomplete_before_private_store", 0, false, false),
    entry("saving_reply_lost", "stored_pending_closeout_unconfirmed", 1, true, false),
    entry("finish_reply_lost", "stored_pending_closeout_confirmed", 1, true, true),
    entry("completed_sample", "stored_pending_closeout_confirmed", 1, true, true),
  ]), historicalAdmissionOnly: z.literal(true), runtimeAccountsStayedRetired: z.literal(true),
  sourceRequests: z.literal(0), automaticRetry: z.literal(false), repairPerformed: z.literal(false),
  publicationEnabled: z.literal(false),
});

export function parsePrivateRecoveryTrial(input: unknown) { return snapshot.parse(input); }
