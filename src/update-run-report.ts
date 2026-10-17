import { z } from "zod";
import { compareRecordedInstants } from "./recorded-instant-order.ts";

const recordedTime = z.iso.datetime({ offset: true });
import { publicSourceUrl } from "./public-issue-projection.ts";
import { fictionalPublicationDraftSchema } from "./fictional-publication-draft.ts";

// A bounded operator display shape. Parsing is not proof that a run occurred or
// that a source or publication passed its real database authority checks.
const text = (limit: number) => z.string().trim().min(1).max(limit);
const sourceKey = z.string().regex(/^[a-z0-9][a-z0-9:-]{0,119}$/);
const source = z.strictObject({
  sourceVersionId: z.uuid(),
  publisher: text(160),
  title: text(240),
  url: publicSourceUrl,
  locator: text(300),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceKey,
});
const item = z.strictObject({
  itemKey: text(160),
  outcome: z.enum(["unchanged", "shadow_only", "held", "deferred", "model_candidate", "eligible_for_activation_check", "published", "visibility_unverified"]),
  reasonCodes: z.array(text(120)).min(1).max(24),
  sourceKey,
  sourceBindingValid: z.boolean(),
  source: source.nullable(),
  publicUrl: publicSourceUrl.nullable(),
});

export function osloScheduledKey(dueAt: string, scope: string): string | null {
  const instant = new Date(dueAt);
  if (Number.isNaN(instant.getTime()) || instant.getUTCMilliseconds() !== 0 ||
      /\.[0-9]*[1-9][0-9]*(?:Z|[+-]\d{2}:\d{2})$/.test(dueAt)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const value = (name: string) => Number(parts.find((part) => part.type === name)?.value);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (value("hour") !== 8 || value("minute") !== 0 || value("second") !== 0) return null;
  const monday = new Date(Date.UTC(year, month - 1, day));
  if (monday.getUTCDay() !== 1) return null;
  const thursday = new Date(Date.UTC(year, month - 1, day + 3));
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  firstThursday.setUTCDate(4 + 3 - ((firstThursday.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604_800_000);
  return `weekly:${isoYear}w${String(week).padStart(2, "0")}:${scope}`;
}

export const updateRunReportSchema = z.strictObject({
  schemaVersion: z.literal(3),
  reportKind: z.enum(["fictional_rehearsal", "verified_run"]),
  runId: z.uuid(),
  requestKey: text(160).regex(/^[a-z0-9][a-z0-9:_-]*$/),
  requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  trigger: z.enum(["manual", "scheduled"]),
  scheduledDueAt: recordedTime.nullable(),
  mode: z.enum(["shadow", "publish_eligible"]),
  scope: text(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  dueSourceKeys: z.array(sourceKey).min(1).max(50),
  coveredSourceKeys: z.array(sourceKey).max(50),
  state: z.enum(["completed", "partial", "failed"]),
  startedAt: recordedTime,
  finishedAt: recordedTime,
  publicChanges: z.number().int().min(0).max(50),
  items: z.array(item).max(50),
  fictionalCandidate: fictionalPublicationDraftSchema.nullable(),
}).superRefine((report, context) => {
  // ISO format failures are continuable Zod issues; compare only validated leaf times.
  if ([report.startedAt, report.finishedAt, ...(report.scheduledDueAt === null ? [] : [report.scheduledDueAt])]
      .some(value => !recordedTime.safeParse(value).success)) return;
  if (compareRecordedInstants(report.finishedAt, report.startedAt) < 0) {
    context.addIssue({ code: "custom", message: "Run finished before it started" });
  }
  if (report.trigger === "scheduled") {
    if (!report.scheduledDueAt ||
        osloScheduledKey(report.scheduledDueAt, report.scope) !== report.requestKey ||
        compareRecordedInstants(report.startedAt, report.scheduledDueAt) < 0) {
      context.addIssue({ code: "custom", message: "Scheduled request does not match Monday 08:00 Oslo" });
    }
  } else if (report.scheduledDueAt !== null) {
    context.addIssue({ code: "custom", message: "Manual request has a scheduled due instant" });
  }
  const keys = report.items.map((entry) => entry.itemKey);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "Duplicate update item" });
  }
  const due = new Set(report.dueSourceKeys);
  const covered = new Set(report.coveredSourceKeys);
  if (due.size !== report.dueSourceKeys.length || covered.size !== report.coveredSourceKeys.length ||
      [...covered].some((key) => !due.has(key)) ||
      report.items.some((entry) => !due.has(entry.sourceKey))) {
    context.addIssue({ code: "custom", message: "Source coverage set is inconsistent" });
  }
  if (report.state === "completed" &&
      (due.size !== covered.size || [...due].some((key) => !covered.has(key)))) {
    context.addIssue({ code: "custom", message: "Completed run has missing source coverage" });
  }
  if (report.publicChanges !== report.items.filter((entry) => entry.outcome === "published").length) {
    context.addIssue({ code: "custom", message: "Public-change count disagrees with item outcomes" });
  }
  for (const entry of report.items) {
    const bindingError = entry.reasonCodes.includes("source_reference_invalid") ||
      entry.reasonCodes.includes("candidate_binding_invalid");
    if (entry.sourceBindingValid !== !bindingError ||
        (!entry.sourceBindingValid && entry.outcome !== "held") ||
        (entry.source !== null && entry.source.sourceKey !== entry.sourceKey) ||
        (entry.source === null && !entry.reasonCodes.includes("source_reference_invalid")) ||
        (entry.reasonCodes.includes("source_reference_invalid") && entry.source !== null)) {
      context.addIssue({ code: "custom", message: "Item source binding and disclosure disagree" });
    }
    // Format issues are continuable; do not inspect a URL already held by its leaf schema.
    if (report.reportKind === "fictional_rehearsal" && entry.source !== null &&
        publicSourceUrl.safeParse(entry.source.url).success && new URL(entry.source.url).hostname !== "example.org") {
      context.addIssue({ code: "custom", message: "Fictional reports may reference only example.org" });
    }
    if (entry.outcome === "published" && (!entry.publicUrl || report.mode !== "publish_eligible" || report.reportKind !== "verified_run")) {
      context.addIssue({ code: "custom", message: "Published item lacks a verified publication route" });
    }
    if (entry.outcome !== "published" && entry.publicUrl !== null) {
      context.addIssue({ code: "custom", message: "Unpublished item must not claim a public URL" });
    }
  }
  const checked = new Set(report.items.filter((entry) => entry.sourceBindingValid).map((entry) => entry.sourceKey));
  for (const entry of report.items) if (!entry.sourceBindingValid) checked.delete(entry.sourceKey);
  if (checked.size !== covered.size || [...checked].some((key) => !covered.has(key))) {
    context.addIssue({ code: "custom", message: "Covered sources disagree with checked item bindings" });
  }
  if (report.reportKind === "fictional_rehearsal" && report.mode !== "shadow") {
    context.addIssue({ code: "custom", message: "Fictional rehearsal must stay in shadow mode" });
  }
  if (report.state === "completed" && report.items.some((entry) =>
    entry.outcome === "deferred" || entry.outcome === "visibility_unverified" ||
    entry.outcome === "model_candidate" || entry.outcome === "eligible_for_activation_check")) {
    context.addIssue({ code: "custom", message: "Unresolved work cannot be reported as completed" });
  }
  if (report.state === "failed" && report.publicChanges > 0) {
    context.addIssue({ code: "custom", message: "A run with visible changes must report partial progress" });
  }
  if (report.fictionalCandidate !== null) {
    const candidate = report.fictionalCandidate;
    const origin = report.items.find((entry) => entry.itemKey === candidate.itemKey);
    // Minimum array-length issues are continuable. Keep incomplete source
    // evidence inside the normal validation refusal instead of dereferencing it.
    const selected = candidate.publication.snapshot.claims[0]?.evidence[0];
    if (report.reportKind !== "fictional_rehearsal" || report.mode !== "shadow" ||
        !selected || !origin || origin.outcome !== "shadow_only" || !origin.sourceBindingValid || !origin.source ||
        origin.source.sourceVersionId !== candidate.decision.sourceVersionId ||
        origin.source.contentSha256 !== candidate.decision.contentSha256 ||
        origin.source.url !== candidate.decision.publicCitationUrl ||
        origin.source.locator !== candidate.decision.locator ||
        origin.source.publisher !== selected.publisher || origin.source.title !== selected.title) {
      context.addIssue({ code: "custom", message: "Fictional page draft is not bound to this report item" });
    }
  }
});

export type UpdateRunReport = z.infer<typeof updateRunReportSchema>;

export function parseUpdateRunReport(input: unknown): UpdateRunReport {
  return updateRunReportSchema.parse(input);
}
