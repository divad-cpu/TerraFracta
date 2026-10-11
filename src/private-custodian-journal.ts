import { z } from "zod";
import { inventedDatabaseInstantSchema as instant, inventedDatabaseMicroseconds as micros } from "./invented-correction-review.ts";

const entry = <S extends string, T extends string, A extends boolean, F extends boolean, C extends boolean | null>(
  scenario: S, state: T, admission: A, finish: F, cleanup: C,
) => z.strictObject({ scenario: z.literal(scenario), state: z.literal(state), recordedAt: instant,
  admissionRecorded: z.literal(admission), finishRecorded: z.literal(finish), nativeCleanupConfirmed: z.literal(cleanup) });

const snapshot = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("saved_invented_private_custodian_journal"),
  recordedAt: instant,
  entries: z.tuple([
    entry("missing_finish", "outcome_not_recorded", false, false, null),
    entry("failed_before_admission", "failed_held", false, true, true),
    entry("interrupted_after_admission", "interrupted_held", true, true, true),
    entry("cleanup_unknown", "local_cleanup_unconfirmed", true, true, false),
  ]),
  historicalObservationOnly: z.literal(true), sourceRequests: z.literal(0), nativeQueries: z.literal(0),
  modelCalls: z.literal(0), originalHttpExecuted: z.literal(false), actualNativeFailureObserved: z.literal(false),
  cleanupUncertaintyInjected: z.literal(true), automaticRetry: z.literal(false), publicationEnabled: z.literal(false),
}).superRefine((value, context) => {
  const times = value.entries.map((item) => micros(item.recordedAt));
  if (times.some((time, index) => index > 0 && time < times[index - 1]) || micros(value.recordedAt) !== times[3]) {
    context.addIssue({ code: "custom", message: "Saved journal chronology differs" });
  }
});

export function parsePrivateCustodianJournal(input: unknown) { return snapshot.parse(input); }

const nativeEntry = <S extends string, J extends string, T extends string, P extends number, F extends boolean, R extends boolean>(
  scenario: S, journalState: J, state: T, pairs: P, finish: F, returned: R,
) => z.strictObject({ scenario: z.literal(scenario), journalState: z.literal(journalState), state: z.literal(state),
  recordedAt: instant, savedPairs: z.literal(pairs), nativeCloseoutPresent: z.literal(finish),
  returnedResultAccepted: z.literal(returned), nativeCleanupConfirmed: z.literal(true) });

const nativeSnapshot = z.strictObject({ schemaVersion: z.literal(1),
  evidenceKind: z.literal("saved_invented_journaled_native_integration"), recordedAt: instant,
  entries: z.tuple([
    nativeEntry("retained_nominal", "pending_held", "stored_pending_closeout_confirmed", 1, true, true),
    nativeEntry("store_receipt_lost", "failed_held", "stored_pending_closeout_unconfirmed", 1, false, false),
    nativeEntry("journal_finish_receipt_lost", "pending_held", "stored_pending_closeout_confirmed", 1, true, false),
    nativeEntry("owned_cancellation", "interrupted_held", "incomplete_before_private_store", 0, false, false),
  ]),
  historicalObservationOnly: z.literal(true), liveStatus: z.literal(false), freshProcessReadback: z.literal(true),
  runtimeAccountsStayedRetired: z.literal(true), creatingParentGuardRequested: z.literal(true),
  remoteRollbackAttested: z.literal(false), sourceRequests: z.literal(0), originalHttpExecuted: z.literal(false),
  automaticRetry: z.literal(false), repairPerformed: z.literal(false), publicationEnabled: z.literal(false),
}).superRefine((value, context) => {
  const times = value.entries.map((item) => micros(item.recordedAt));
  if (times.some((time, index) => index > 0 && time <= times[index - 1]) || micros(value.recordedAt) < times[3]) {
    context.addIssue({ code: "custom", message: "Saved integration chronology differs" });
  }
});

export function parseJournaledNativeIntegration(input: unknown) { return nativeSnapshot.parse(input); }
