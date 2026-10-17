import type { InventedSourceMonitoringInput } from "../../../src/source-monitoring-snapshot.ts";

// Fixed invented metadata only. Construction occurs after the development
// route gate; dates never advance merely because this fixture is rendered.
export function createInventedSourceMonitoringSnapshot(): InventedSourceMonitoringInput {
  const complete = { checkedAt: "2026-10-13T08:00:00.000000Z", outcome: "unchanged" as const,
    httpStatus: 200, expectedUnits: 3, completedUnits: 3, failedUnits: 0, pendingUnits: 0 };
  const source = (n: number, label: string) => ({ registrationId: `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    sourceKey: `fictional-monitor-${n}`, label, registrationState: "approved" as const, fetchPermission: "allowed" as const,
    dueAt: "2026-10-14T08:00:00.000000Z", lastAttempt: null });
  return { schemaVersion: 1, evidenceKind: "invented_source_monitoring_snapshot", observedAt: "2026-10-14T12:00:00.000000Z", sources: [
    { ...source(1, "Invented annual release"), dueAt: "2026-10-19T08:00:00.000000Z" },
    { ...source(2, "Invented complete check"), lastAttempt: complete },
    { ...source(3, "Invented partial traversal"), lastAttempt: { ...complete, completedUnits: 1, pendingUnits: 1 } },
    { ...source(4, "Invented failed check"), lastAttempt: { ...complete, outcome: "failed", httpStatus: 503, completedUnits: 1, failedUnits: 2 } },
    { ...source(5, "Invented suspended registration"), registrationState: "suspended", lastAttempt: { ...complete } },
    { ...source(6, "Invented unresolved permission"), registrationState: "candidate", fetchPermission: "unresolved", dueAt: null },
    { ...source(7, "Invented unknown coverage"), lastAttempt: { ...complete, expectedUnits: null, completedUnits: 1 } },
    { ...source(8, "Invented denied retrieval"), fetchPermission: "denied", lastAttempt: { ...complete, outcome: "changed" } },
  ] };
}
