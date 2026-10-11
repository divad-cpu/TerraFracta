import { z } from "zod";

// Navigation metadata only. Neither stored run state nor an issue key is a
// source-health assessment, publication attribution or reviewed political text.
export const operatorAuditChoiceIdSchema = z.uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const instant = z.iso.datetime().regex(instantPattern).refine(value => !value.startsWith("0000-"));
export const operatorAuditRunCursorSchema = z.strictObject({
  createdAt: z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(value => !value.startsWith("0000-")),
  runId: operatorAuditChoiceIdSchema,
});
export type OperatorAuditRunCursor = z.infer<typeof operatorAuditRunCursorSchema>;
function micros(value: string): bigint {
  const epoch = Date.parse(value.slice(0, 19) + "Z");
  if (!instantPattern.test(value) || !Number.isFinite(epoch)) return BigInt(0);
  const fraction = value.includes(".") ? value.slice(20, -1) : "";
  return BigInt(epoch) * BigInt(1_000) + BigInt(fraction.padEnd(6, "0"));
}
const runSchema = z.strictObject({
  runId: operatorAuditChoiceIdSchema,
  jurisdictionId: z.string().regex(/^[a-z0-9][a-z0-9:-]{0,79}$/),
  createdAt: instant,
  runState: z.enum(["queued", "running", "completed", "partial", "failed", "rejected"]),
});
function compareTuple(left: { createdAt: string; runId: string }, right: { createdAt: string; runId: string }): number {
  const a = micros(left.createdAt), b = micros(right.createdAt);
  return a < b ? -1 : a > b ? 1 : left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0;
}
export const operatorAuditChoicesSchema = z.strictObject({
  schemaVersion: z.literal(2),
  status: z.literal("ok"),
  observedAt: instant,
  requestedRunId: operatorAuditChoiceIdSchema.nullable(),
  requestedCursor: operatorAuditRunCursorSchema.nullable(),
  runs: z.array(runSchema).max(20),
  moreRuns: z.boolean(),
  selectedRun: runSchema.nullable(),
  issues: z.array(z.strictObject({
    issueId: operatorAuditChoiceIdSchema,
    issueKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/),
  })).max(50),
  moreIssues: z.boolean(),
  nextCursor: operatorAuditRunCursorSchema.nullable(),
}).superRefine((report, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (report.moreRuns && report.runs.length !== 20 || report.moreIssues && report.issues.length !== 50) fail("Invalid bounded continuation");
  if (new Set(report.runs.map(run => run.runId)).size !== report.runs.length) fail("Duplicate run");
  const observed = micros(report.observedAt);
  const cursor = report.requestedCursor;
  if (cursor !== null && micros(cursor.createdAt) > observed) fail("Future continuation anchor");
  for (let index = 0; index < report.runs.length; index++) {
    const run = report.runs[index], created = micros(run.createdAt), previous = report.runs[index - 1];
    if (created > observed) fail("Future run");
    if (cursor !== null && compareTuple(run, cursor) >= 0) fail("Run outside requested continuation");
    if (previous && (micros(previous.createdAt) < created ||
      micros(previous.createdAt) === created && previous.runId <= run.runId)) fail("Run ordering mismatch");
  }
  const last = report.runs.at(-1);
  if (report.moreRuns !== (report.nextCursor !== null) || report.nextCursor !== null &&
    (!last || report.nextCursor.createdAt !== last.createdAt || report.nextCursor.runId !== last.runId)) fail("Continuation mismatch");
  if (report.selectedRun === null) {
    if (report.issues.length !== 0 || report.moreIssues) fail("Issues without a selected run");
    if (report.runs.some(run => run.runId === report.requestedRunId)) fail("Listed selected run absent");
  } else {
    const selected = report.selectedRun;
    if (selected.runId !== report.requestedRunId || micros(selected.createdAt) > observed) fail("Selection mismatch");
    const listed = report.runs.find(run => run.runId === selected.runId);
    if (listed && (listed.jurisdictionId !== selected.jurisdictionId || listed.createdAt !== selected.createdAt ||
      listed.runState !== selected.runState)) fail("Inconsistent selected run");
    if (!listed && (cursor === null || compareTuple(selected, cursor) < 0)) {
      const oldest = report.runs.at(-1);
      if (!report.moreRuns || !oldest || micros(selected.createdAt) > micros(oldest.createdAt) ||
        micros(selected.createdAt) === micros(oldest.createdAt) && selected.runId >= oldest.runId) fail("Selected run outside complete or ordered overview");
    }
  }
  if (new Set(report.issues.map(issue => issue.issueId)).size !== report.issues.length ||
    new Set(report.issues.map(issue => issue.issueKey)).size !== report.issues.length) fail("Duplicate issue");
  for (let index = 1; index < report.issues.length; index++) {
    if (report.issues[index - 1].issueKey >= report.issues[index].issueKey) fail("Issue ordering mismatch");
  }
});
const changedSchema = z.strictObject({
  schemaVersion: z.literal(2),
  status: z.literal("changed"),
  requestedRunId: operatorAuditChoiceIdSchema.nullable(),
  requestedCursor: operatorAuditRunCursorSchema,
});
export const operatorAuditChoicesEnvelopeSchema = z.union([operatorAuditChoicesSchema, changedSchema]);
export type OperatorAuditChoices = z.infer<typeof operatorAuditChoicesSchema>;
