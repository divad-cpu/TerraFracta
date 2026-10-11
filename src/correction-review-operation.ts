import { z } from "zod";

const utcInstant = z.iso.datetime({ offset: true }).refine(value =>
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)$/.test(value) &&
  Number(value.slice(0, 4)) > 0);
const execution = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("fresh_invented_correction_review_result_v2"),
  recordedAt: utcInstant, state: z.literal("completed_invented_review"),
  privateReports: z.literal(4), requestReceipts: z.literal(4), reviewEvents: z.literal(3),
  newReports: z.literal(2), underReviewReports: z.literal(1), closedReports: z.literal(1),
  eventsAppendOnly: z.literal(true), historicalReplayDidNotReopen: z.literal(true), historyPreserved: z.literal(true),
  temporaryAccountsRetired: z.literal(true), ownedCloneStopped: z.literal(true),
  sourceRequests: z.literal(0), modelCalls: z.literal(0), realReports: z.literal(0),
  liveReviewEnabled: z.literal(false), publicContentChangedByReports: z.literal(false),
});
const status = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("idle") }), z.strictObject({ state: z.literal("running") }),
  z.strictObject({ state: z.literal("checked"), result: execution }),
  z.strictObject({ state: z.literal("held"), reason: z.literal("private_test_unavailable") }),
]);
const supervisedExecution = execution.extend({
  evidenceKind: z.literal("fresh_invented_supervised_correction_review_result_v3"),
  workerExitObserved: z.literal(true), custodianRolesRetired: z.literal(true), custodianCloneStopped: z.literal(true),
});
const supervisedStatus = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("idle") }), z.strictObject({ state: z.literal("running") }),
  z.strictObject({ state: z.literal("checked"), result: supervisedExecution }),
  z.strictObject({ state: z.literal("held"), reason: z.literal("private_test_unavailable") }),
]);
export type CorrectionReviewOperationStatus = z.infer<typeof status>;
export type SupervisedCorrectionReviewOperationStatus = z.infer<typeof supervisedStatus>;
export type ReviewObservation = CorrectionReviewOperationStatus | SupervisedCorrectionReviewOperationStatus;
export function parseCorrectionReviewExecution(input: unknown) { return execution.parse(input); }
export function parseCorrectionReviewOperationStatus(input: unknown) { return status.parse(input); }
export function parseSupervisedCorrectionReviewOperationStatus(input: unknown) { return supervisedStatus.parse(input); }
