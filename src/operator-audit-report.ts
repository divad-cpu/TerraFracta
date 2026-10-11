import { z } from "zod";

// Recorded private audit metadata, not current source health, eligibility or
// proof that a stored head is visible on the website. No raw evidence fields.
const revision = z.number().int().min(1).max(2_147_483_647);
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const instant = z.iso.datetime().regex(instantPattern);
export const operatorAuditCursorSchema = z.strictObject({
  latestRevision: revision,
  headPublicationId: uuid.nullable(),
  beforeRevision: revision,
}).refine(value => value.beforeRevision <= value.latestRevision);
export const operatorAuditScopeSchema = z.strictObject({
  runId: uuid,
  issueId: uuid,
  cursor: operatorAuditCursorSchema.nullable(),
});
export type OperatorAuditScope = z.infer<typeof operatorAuditScopeSchema>;
export type OperatorAuditCursor = z.infer<typeof operatorAuditCursorSchema>;

// Preserve PostgreSQL microseconds for temporal comparisons; Date.parse alone
// would silently round different instants into the same millisecond.
function micros(value: string): bigint {
  const epoch = Date.parse(value.slice(0, 19) + "Z");
  const fraction = value.includes(".") ? value.slice(20, -1) : "";
  // Zod may also run this refinement after a failed string-format check. Keep
  // malformed input a validation result instead of throwing from safeParse.
  if (!instantPattern.test(value) || !Number.isFinite(epoch)) return BigInt(0);
  return BigInt(epoch) * BigInt(1_000) + BigInt(fraction.padEnd(6, "0"));
}
const sourceSchema = z.strictObject({
  registrationId: uuid,
  sourceKey: z.string().regex(/^[a-z0-9][a-z0-9:-]{0,119}$/),
  registrationState: z.enum(["candidate", "approved", "suspended", "retired"]),
  allowFetch: z.boolean(),
  fetchEnabled: z.boolean(),
  reviewedAt: instant.nullable(),
  outcome: z.enum(["captured", "unchanged", "failed", "deferred", "not_recorded"]),
  checkedAt: instant.nullable(),
  sourceVersionId: uuid.nullable(),
});
const publicationSchema = z.strictObject({
  publicationId: uuid,
  revision,
  supersedesPublicationId: uuid.nullable(),
  publicationKind: z.enum(["draft", "accepted", "correction", "suppression"]),
  createdAt: instant,
  isHead: z.boolean(),
});
export const operatorAuditReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: z.literal("ok"),
  requested: operatorAuditScopeSchema,
  observedAt: instant,
  run: z.strictObject({
    runId: uuid,
    jurisdictionId: z.string().min(1).max(80),
    mode: z.enum(["shadow", "publish_eligible"]),
    runState: z.enum(["queued", "running", "completed", "partial", "failed", "rejected"]),
    commitState: z.enum(["none", "committed", "partial"]),
    visibilityState: z.enum(["not_required", "pending", "verified", "failed", "mixed"]),
    createdAt: instant,
    finishedAt: instant.nullable(),
  }),
  expectedSourcesKnown: z.boolean(),
  sources: z.array(sourceSchema).max(50),
  history: z.strictObject({
    issueId: uuid,
    latestRevision: z.number().int().min(0).max(2_147_483_647),
    headPublicationId: uuid.nullable(),
    headRevision: revision.nullable(),
    publications: z.array(publicationSchema).max(20),
    nextCursor: operatorAuditCursorSchema.nullable(),
  }),
}).superRefine((report, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const observed = micros(report.observedAt), started = micros(report.run.createdAt);
  const scope = report.requested, history = report.history, cursor = scope.cursor;
  if (scope.runId !== report.run.runId || scope.issueId !== history.issueId) fail("Scope mismatch");
  if (started > observed || report.run.finishedAt !== null &&
      (micros(report.run.finishedAt) < started || micros(report.run.finishedAt) > observed)) fail("Invalid run timeline");
  if (new Set(report.sources.map(source => source.registrationId)).size !== report.sources.length ||
      new Set(report.sources.map(source => source.sourceKey)).size !== report.sources.length) fail("Duplicate source");
  if (report.expectedSourcesKnown && report.sources.length === 0) fail("Known manifest has no sources");
  for (let index = 0; index < report.sources.length; index++) {
    const source = report.sources[index];
    if (index > 0 && report.sources[index - 1].sourceKey >= source.sourceKey) fail("Source order mismatch");
    if (source.registrationState === "approved" && source.reviewedAt === null ||
        source.fetchEnabled && (source.registrationState !== "approved" || !source.allowFetch)) fail("Invalid registration state");
    if (source.reviewedAt !== null && micros(source.reviewedAt) > observed) fail("Future registration review");
    if (source.outcome === "not_recorded") {
      if (source.checkedAt !== null || source.sourceVersionId !== null || !report.expectedSourcesKnown) fail("Unknown check represented as recorded");
    } else {
      if (source.checkedAt === null || micros(source.checkedAt) < started || micros(source.checkedAt) > observed) fail("Invalid check timeline");
      const successful = source.outcome === "captured" || source.outcome === "unchanged";
      if (successful !== (source.sourceVersionId !== null)) fail("Check version mismatch");
    }
  }
  if ((history.headPublicationId === null) !== (history.headRevision === null) ||
      history.headRevision !== null && history.headRevision > history.latestRevision) fail("Head mismatch");
  if (cursor !== null && (cursor.latestRevision !== history.latestRevision ||
      cursor.headPublicationId !== history.headPublicationId)) fail("Changed history admitted");
  if (new Set(history.publications.map(publication => publication.publicationId)).size !== history.publications.length) fail("Duplicate publication");
  const publications = history.publications;
  if (cursor === null && ((history.latestRevision === 0) !== (publications.length === 0) ||
      publications.length > 0 && publications[0].revision !== history.latestRevision)) fail("Latest revision absent");
  for (let index = 0; index < publications.length; index++) {
    const publication = publications[index];
    if (publication.revision > history.latestRevision ||
        cursor !== null && publication.revision >= cursor.beforeRevision ||
        index > 0 && publications[index - 1].revision <= publication.revision) fail("Revision order mismatch");
    if (micros(publication.createdAt) > observed) fail("Future publication record");
    if (publication.isHead !== (publication.publicationId === history.headPublicationId) ||
        (publication.revision === history.headRevision) !== publication.isHead) fail("Head row mismatch");
    if (publication.supersedesPublicationId === publication.publicationId) fail("Self supersession");
    const parent = publications.find(row => row.publicationId === publication.supersedesPublicationId);
    if (parent && (parent.revision >= publication.revision || micros(parent.createdAt) > micros(publication.createdAt))) fail("Invalid parent record");
  }
  if (history.nextCursor !== null && (publications.length !== 20 ||
      history.nextCursor.latestRevision !== history.latestRevision ||
      history.nextCursor.headPublicationId !== history.headPublicationId ||
      history.nextCursor.beforeRevision !== publications.at(-1)?.revision)) fail("Invalid continuation cursor");
});
const heldEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: z.enum(["not_found", "changed"]),
  requested: operatorAuditScopeSchema,
}).refine(value => value.status !== "changed" || value.requested.cursor !== null);
export const operatorAuditEnvelopeSchema = z.union([operatorAuditReportSchema, heldEnvelopeSchema]);
export type OperatorAuditReport = z.infer<typeof operatorAuditReportSchema>;
