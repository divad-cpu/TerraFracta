import { z } from "zod";
import { schemaCheckedUtcMicroseconds as micros } from "./exact-utc-observation.ts";

const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/)
  .refine(value => !value.startsWith("0000-"));
const unitCount = z.number().int().min(0).max(1000);
const attempt = z.strictObject({
  checkedAt: instant, outcome: z.enum(["changed", "unchanged", "failed"]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  expectedUnits: z.number().int().min(1).max(1000).nullable(),
  completedUnits: unitCount, failedUnits: unitCount, pendingUnits: unitCount,
}).superRefine((value, context) => {
  if (value.expectedUnits !== null && value.completedUnits + value.failedUnits + value.pendingUnits > value.expectedUnits)
    context.addIssue({ code: "custom", message: "Recorded unit coverage inconsistent" });
  if (value.outcome !== "failed" && value.httpStatus !== null &&
      !(value.httpStatus >= 200 && value.httpStatus < 300 || value.httpStatus === 304 && value.outcome === "unchanged"))
    context.addIssue({ code: "custom", message: "Recorded transport and check outcome inconsistent" });
});
const row = z.strictObject({
  registrationId: z.uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  sourceKey: z.string().regex(/^[a-z0-9][a-z0-9:-]{0,119}$/),
  label: z.string().min(1).max(160).refine(value => !!value.trim() && !/[\u0000-\u001f\u007f]/.test(value)),
  registrationState: z.enum(["candidate", "approved", "suspended", "retired"]),
  fetchPermission: z.enum(["allowed", "denied", "unresolved"]),
  dueAt: instant.nullable(), lastAttempt: attempt.nullable(),
});
const snapshotSchema = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("invented_source_monitoring_snapshot"),
  observedAt: instant, sources: z.array(row).max(50),
}).superRefine((value, context) => {
  if (new Set(value.sources.map(source => source.registrationId.toLowerCase())).size !== value.sources.length ||
      new Set(value.sources.map(source => source.sourceKey)).size !== value.sources.length ||
      value.sources.some(source => source.lastAttempt !== null && micros(source.lastAttempt.checkedAt) > micros(value.observedAt)))
    context.addIssue({ code: "custom", message: "Invented monitoring identity or chronology inconsistent" });
});
export type InventedSourceMonitoringInput = z.infer<typeof snapshotSchema>;
type Source = z.infer<typeof row>;
function checkState(source: Source) {
  const check = source.lastAttempt;
  if (check === null) return "not_recorded" as const;
  if (check.outcome === "failed") return "failed" as const;
  if (check.expectedUnits === null) return "coverage_unknown" as const;
  if (check.completedUnits !== check.expectedUnits || check.failedUnits !== 0 || check.pendingUnits !== 0) return "incomplete" as const;
  return check.outcome === "changed" ? "complete_changed" as const : "complete_unchanged" as const;
}

// This parses invented supplied observations only. No clock, provider, source
// fetch, current-rights inference, operational fallback or quality score.
export function sourceMonitoringSnapshot(input: unknown) {
  try {
    const snapshot = snapshotSchema.parse(input);
    const rows = snapshot.sources.map(source => ({ ...source,
      due: source.dueAt === null ? "unknown" as const : micros(source.dueAt) > micros(snapshot.observedAt) ? "not_due" as const : "due" as const,
      check: checkState(source),
    }));
    return { observedAt: snapshot.observedAt, rows, counts: {
      due: rows.filter(source => source.due === "due").length,
      notDue: rows.filter(source => source.due === "not_due").length,
      dueUnknown: rows.filter(source => source.due === "unknown").length,
      suspended: rows.filter(source => source.registrationState === "suspended").length,
      permissionDenied: rows.filter(source => source.fetchPermission === "denied").length,
      permissionUnresolved: rows.filter(source => source.fetchPermission === "unresolved").length,
      noCheck: rows.filter(source => source.check === "not_recorded").length,
      complete: rows.filter(source => source.check === "complete_changed" || source.check === "complete_unchanged").length,
      incomplete: rows.filter(source => source.check === "incomplete").length,
      coverageUnknown: rows.filter(source => source.check === "coverage_unknown").length,
      failed: rows.filter(source => source.check === "failed").length,
    } };
  } catch { return null; }
}
