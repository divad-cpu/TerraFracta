import { z } from "zod";
const observation = (name: string, outcome: "recorded" | "not_observed", current: "closed" | "new", historical: "closed" | "in_review" | null) =>
  z.strictObject({ case: z.literal(name), outcome: z.literal(outcome), currentState: z.literal(current), historicalState: z.literal(historical) });
const saved = z.strictObject({ schemaVersion: z.literal(1), evidenceKind: z.literal("saved_invented_review_receipt_recovery"),
  recordedAt: z.iso.datetime({ offset: true }), liveStatus: z.literal(false),
  observations: z.tuple([
    observation("closure_after_unconsumed_commit", "recorded", "closed", "closed"),
    observation("historical_start_with_current_closed", "recorded", "closed", "in_review"),
    observation("never_dispatched_on_new_report", "not_observed", "new", null),
    observation("same_event_id_different_principal", "not_observed", "closed", null),
  ]), readOnlyApplicationRows: z.literal(true), writePrivilegeRevoked: z.literal(true), missingEventDispatched: z.literal(false),
  historicalEventReopenedReport: z.literal(false), privateEventExposedAcrossAccounts: z.literal(false),
  sourceRequests: z.literal(0), modelCalls: z.literal(0), realReports: z.literal(0),
  publicContentChanged: z.literal(false), liveReviewEnabled: z.literal(false),
});
export function parseCorrectionRecoveryTrial(input: unknown) { return saved.parse(input); }
