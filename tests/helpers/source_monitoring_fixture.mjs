const id = n => `A0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-10-14T12:00:00.000001Z";
export const source = (changes = {}) => ({ registrationId: id(1), sourceKey: "fictional-one", label: "Invented source one",
  registrationState: "approved", fetchPermission: "allowed", dueAt: at, lastAttempt: null, ...changes });
export const snapshot = (sources = [source()]) => ({ schemaVersion: 1, evidenceKind: "invented_source_monitoring_snapshot", observedAt: at, sources });
export const attempt = (changes = {}) => ({ checkedAt: at, outcome: "unchanged", httpStatus: 200,
  expectedUnits: 2, completedUnits: 2, failedUnits: 0, pendingUnits: 0, ...changes });
export { id };
