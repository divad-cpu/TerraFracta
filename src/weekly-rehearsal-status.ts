import { z } from "zod";
import { isRecentUtcObservation } from "./exact-utc-observation.ts";
import { osloScheduledKey } from "./update-run-report.ts";
import { inventedDatabaseMicroseconds as micros } from "./invented-correction-review.ts";

function observationWindow(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const value = (key: string) => Number(parts.find(part => part.type === key)?.value);
  const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const year = date.getUTCFullYear(), firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(4 + 3 - ((firstThursday.getUTCDay() + 6) % 7));
  return `${year}-W${String(1 + Math.round((date.getTime() - firstThursday.getTime()) / 604_800_000)).padStart(2, "0")}`;
}

const utc = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/)
  .refine(value => !value.startsWith("0000-"));
const count = z.number().int().min(0).max(100);
export const weeklyRehearsalObservationSchema = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("current_local_fictional_weekly_status"),
  observedAt: utc, dueAt: utc, windowKey: z.string().regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/),
  graceMinutes: z.literal(60), state: z.enum(["pending", "healthy", "attention", "held", "invalid"]),
  reason: z.enum(["history_incomplete", "latest_receipt_ambiguous", "not_due", "window_invalid",
    "run_receipt_invalid", "run_not_completed", "due_source_coverage_incomplete", "visibility_unverified",
    "scheduled_run_late", "due_window_completed", "within_grace_window", "scheduled_run_missing",
    "scheduled_run_missing_manual_catchup_complete", "scheduled_run_missing_manual_catchup_incomplete"]),
  coverage: z.enum(["unknown", "incomplete", "complete"]),
  totalReceipts: count, unreadableReceipts: count, pendingReceipts: count,
  realScheduleEnabled: z.literal(false), trustedRunLedger: z.literal(false), sourceRequests: z.literal(0),
  publicationEnabled: z.literal(false), alertsSent: z.literal(0),
}).superRefine((value, context) => {
  const dueKey = osloScheduledKey(value.dueAt, "fictional-country");
  const expected = `weekly:${value.windowKey.slice(0, 4)}w${value.windowKey.slice(6)}:fictional-country`;
  if (dueKey !== expected || value.windowKey !== observationWindow(value.observedAt) ||
      /\.[0-9]*[1-9][0-9]*(?:Z|\+00:00)$/.test(value.dueAt))
    context.addIssue({ code: "custom", message: "Current Oslo weekly window disagrees" });
  if (value.unreadableReceipts > value.totalReceipts || value.totalReceipts + value.pendingReceipts > 100)
    context.addIssue({ code: "custom", message: "Receipt counts disagree" });
  const outcomes: Record<string, [string, string]> = {
    history_incomplete: ["held", "unknown"], latest_receipt_ambiguous: ["held", "unknown"],
    not_due: ["pending", "unknown"], within_grace_window: ["pending", "unknown"],
    window_invalid: ["invalid", "unknown"], run_receipt_invalid: ["invalid", "unknown"],
    run_not_completed: ["attention", "unknown"], due_source_coverage_incomplete: ["attention", "incomplete"],
    visibility_unverified: ["attention", "complete"], scheduled_run_late: ["attention", "complete"],
    due_window_completed: ["healthy", "complete"], scheduled_run_missing: ["attention", "unknown"],
    scheduled_run_missing_manual_catchup_complete: ["attention", "complete"],
    scheduled_run_missing_manual_catchup_incomplete: ["attention", "incomplete"],
  };
  const [state, coverage] = outcomes[value.reason];
  if (value.state !== state || value.coverage !== coverage ||
      ((value.unreadableReceipts > 0 || value.pendingReceipts > 0) && value.reason !== "history_incomplete")) {
    context.addIssue({ code: "custom", message: "Weekly reason, coverage and state disagree" });
  }
  const observed = micros(value.observedAt), due = micros(value.dueAt), deadline = due + BigInt(3_600_000_000);
  const supported = value.totalReceipts - value.unreadableReceipts;
  const needsReceipt = ["run_receipt_invalid", "run_not_completed", "due_source_coverage_incomplete", "visibility_unverified",
    "scheduled_run_late", "due_window_completed", "scheduled_run_missing_manual_catchup_complete",
    "scheduled_run_missing_manual_catchup_incomplete"].includes(value.reason);
  const afterGrace = ["scheduled_run_late", "scheduled_run_missing", "scheduled_run_missing_manual_catchup_complete",
    "scheduled_run_missing_manual_catchup_incomplete"].includes(value.reason);
  const afterDue = ["run_receipt_invalid", "run_not_completed", "due_source_coverage_incomplete", "visibility_unverified",
    "due_window_completed"].includes(value.reason);
  if ((needsReceipt && supported < 1) || (value.reason === "latest_receipt_ambiguous" && supported < 2)
      || (value.reason === "not_due" && observed >= due)
      || (value.reason === "within_grace_window" && (observed < due || observed > deadline))
      || (afterDue && observed < due) || (afterGrace && observed <= deadline)) {
    context.addIssue({ code: "custom", message: "Weekly reason lacks its time or receipt support" });
  }
});
const status = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("observed"), observation: weeklyRehearsalObservationSchema }),
  z.strictObject({ state: z.literal("held"), reason: z.literal("weekly_rehearsal_unavailable") }),
]);
export type WeeklyRehearsalStatus = z.infer<typeof status>;
export function parseWeeklyRehearsalStatus(value: unknown): WeeklyRehearsalStatus { return status.parse(value); }
export function requireRecentWeeklyRehearsalStatus(input: unknown, now = Date.now()): WeeklyRehearsalStatus {
  const value = parseWeeklyRehearsalStatus(input);
  if (value.state === "observed") {
    if (!isRecentUtcObservation(value.observation.observedAt, now)) throw new Error("Weekly observation time unavailable");
  }
  return value;
}
