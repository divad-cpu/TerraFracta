import { z } from "zod";

const result = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("fresh_invented_private_custodian_result"),
  recordedAt: z.iso.datetime({ offset: true }), state: z.literal("pending_private"),
  selectedYears: z.tuple([z.literal(2024), z.literal(2025)]), savedPairs: z.literal(1), sourceChecks: z.literal(2),
  rawBindingMatched: z.literal(true), nativeAdmissionChecked: z.literal(true), ownedProcessesEnded: z.literal(true),
  sourceRequests: z.literal(0), modelCalls: z.literal(0), originalHttpModuleExecuted: z.literal(false),
  sourcePermissionIssued: z.literal(false), publicQualificationIssued: z.literal(false),
  checkpointAdvanced: z.literal(false), publicationEnabled: z.literal(false), historyPreserved: z.literal(true),
});
const retainedResult = result.extend({ evidenceKind: z.literal("fresh_invented_retained_custodian_result"),
  retainedStoreTransaction: z.literal(true) });
const journaledResult = retainedResult.extend({ evidenceKind: z.literal("fresh_invented_journaled_custodian_result_v4"),
  privateJournalRecorded: z.literal(true), creatingParentGuardRequested: z.literal(true),
  nativeCleanupConfirmed: z.literal(true), remoteRollbackAttested: z.literal(false), historicalObservationOnly: z.literal(true) });
const execution = z.union([result, retainedResult, journaledResult]);
const status = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("idle") }), z.strictObject({ state: z.literal("running") }),
  z.strictObject({ state: z.literal("checked"), result: execution }),
  z.strictObject({ state: z.literal("held"), reason: z.literal("private_test_unavailable") }),
]);

export type PrivateCustodianOperationStatus = z.infer<typeof status>;
export function parsePrivateCustodianExecution(input: unknown) { return execution.parse(input); }
export function parsePrivateCustodianOperationStatus(input: unknown) { return status.parse(input); }
