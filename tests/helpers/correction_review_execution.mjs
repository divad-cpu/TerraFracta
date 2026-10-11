export function correctionReviewExecution() {
  return { schemaVersion: 1, evidenceKind: "fresh_invented_correction_review_result_v2", recordedAt: "2026-10-03T05:01:00+00:00",
    state: "completed_invented_review", privateReports: 4, requestReceipts: 4, reviewEvents: 3,
    newReports: 2, underReviewReports: 1, closedReports: 1, eventsAppendOnly: true,
    historicalReplayDidNotReopen: true, historyPreserved: true, temporaryAccountsRetired: true, ownedCloneStopped: true,
    sourceRequests: 0, modelCalls: 0, realReports: 0, liveReviewEnabled: false, publicContentChangedByReports: false };
}

export function supervisedCorrectionReviewExecution() {
  return { ...correctionReviewExecution(), evidenceKind: "fresh_invented_supervised_correction_review_result_v3",
    workerExitObserved: true, custodianRolesRetired: true, custodianCloneStopped: true };
}
