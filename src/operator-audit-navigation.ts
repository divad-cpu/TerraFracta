import { auditSourceQuery } from "./operator-audit-source-search.ts";
import { captureOwnEnumerableSelectors } from "./own-enumerable-selectors.ts";
import { z } from "zod";
import { recordedIssueQuery } from "./recorded-issue-choice-search.ts";
import { operatorAuditReportSchema, operatorAuditScopeSchema, type OperatorAuditScope } from "./operator-audit-report.ts";
import { operatorAuditChoicesSchema, operatorAuditChoiceIdSchema, operatorAuditRunCursorSchema } from "./operator-audit-choices.ts";

export const auditRunStates = operatorAuditChoicesSchema.shape.runs.element.shape.runState.options;
export type AuditRunStateFilter = typeof auditRunStates[number] | "";
export function auditRunStateFilter(value: unknown): AuditRunStateFilter | null {
  return value === undefined || value === "" ? "" : typeof value === "string" && auditRunStates.includes(value as typeof auditRunStates[number]) ? value as AuditRunStateFilter : null;
}
const runReturnSchema = z.strictObject({ runId: operatorAuditChoiceIdSchema, cursor: operatorAuditRunCursorSchema.nullable(), state: operatorAuditChoicesSchema.shape.runs.element.shape.runState.optional(), issueQuery: z.string().refine(value => recordedIssueQuery(value) !== null).transform(value => recordedIssueQuery(value)!).optional() });
export type OperatorAuditRunReturn = z.infer<typeof runReturnSchema>;
export const auditSourceOutcomes = operatorAuditReportSchema.shape.sources.element.shape.outcome.options;
export const auditSourceRegistrationStates = operatorAuditReportSchema.shape.sources.element.shape.registrationState.options;
export type AuditSourceRegistrationFilter = typeof auditSourceRegistrationStates[number] | "";
export function auditSourceRegistrationFilter(value: unknown): AuditSourceRegistrationFilter | null {
  return value === undefined || value === "" ? "" : typeof value === "string" && auditSourceRegistrationStates.includes(value as typeof auditSourceRegistrationStates[number]) ? value as AuditSourceRegistrationFilter : null;
}
export type AuditSourceOutcomeFilter = typeof auditSourceOutcomes[number] | "";
export function auditSourceOutcomeFilter(value: unknown): AuditSourceOutcomeFilter | null {
  return value === undefined || value === "" ? "" : typeof value === "string" && auditSourceOutcomes.includes(value as typeof auditSourceOutcomes[number]) ? value as AuditSourceOutcomeFilter : null;
}
export const auditPublicationKinds = operatorAuditReportSchema.shape.history.shape.publications.element.shape.publicationKind.options;
export type AuditPublicationKindFilter = typeof auditPublicationKinds[number] | "";
export function auditPublicationKindFilter(value: unknown): AuditPublicationKindFilter | null {
  return value === undefined || value === "" ? "" : typeof value === "string" && auditPublicationKinds.includes(value as typeof auditPublicationKinds[number]) ? value as AuditPublicationKindFilter : null;
}
const allowed = new Set(["runId", "issueId", "latestRevision", "headPublicationId", "beforeRevision", "returnToRuns", "returnBeforeCreatedAt", "returnBeforeRunId", "returnRunState", "outcome", "publicationKind", "returnIssueQ", "sourceQ", "registration"]);

export function canonicalAuditRunReturn(input: unknown): Readonly<OperatorAuditRunReturn> | null {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const keys = Object.keys(input);
    if (!keys.includes("runId") || !keys.includes("cursor") || keys.some(key => !["runId", "cursor", "state", "issueQuery"].includes(key))) return null;
    const captured = captureOwnEnumerableSelectors(input, keys);
    if (captured === null) return null;
    const parsed = runReturnSchema.safeParse(captured);
    if (!parsed.success) return null;
    if (parsed.data.cursor) Object.freeze(parsed.data.cursor);
    return Object.freeze(parsed.data);
  } catch { return null; }
}

// Return coordinates select a separate new run-list read. They never change the
// private audit's run/issue/history scope or establish list membership.
export function auditBrowseSelection(input: unknown, rethrow?: (error: unknown) => void): { scope: Readonly<OperatorAuditScope>; runReturn: Readonly<OperatorAuditRunReturn> | null; outcome?: AuditSourceOutcomeFilter; publicationKind?: AuditPublicationKindFilter; sourceQuery?: string; registrationState?: AuditSourceRegistrationFilter } | null {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const fields = input as Record<string, unknown>, keys = Object.keys(fields);
    if (!keys.includes("runId") || !keys.includes("issueId") || keys.some(key => !allowed.has(key))) return null;
    const hasHistory = keys.some(key => ["latestRevision", "headPublicationId", "beforeRevision"].includes(key));
    if (hasHistory && (!keys.includes("latestRevision") || !keys.includes("beforeRevision"))) return null;
    if ((keys.includes("returnRunState") || keys.includes("returnIssueQ")) && !keys.includes("returnToRuns")) return null;
    const hasReturnCursor = keys.includes("returnBeforeCreatedAt") || keys.includes("returnBeforeRunId");
    if (hasReturnCursor && (!keys.includes("returnToRuns") || keys.includes("returnBeforeCreatedAt") !== keys.includes("returnBeforeRunId"))) return null;
    const query = captureOwnEnumerableSelectors(fields, keys, true, rethrow);
    if (query === null) return null;
    if (hasHistory && (!/^[1-9]\d{0,9}$/.test(query.latestRevision) || !/^[1-9]\d{0,9}$/.test(query.beforeRevision))) return null;
    const parsed = operatorAuditScopeSchema.safeParse({ runId: query.runId, issueId: query.issueId, cursor: hasHistory ? {
      latestRevision: Number(query.latestRevision), beforeRevision: Number(query.beforeRevision),
      headPublicationId: !keys.includes("headPublicationId") || query.headPublicationId === "" ? null : query.headPublicationId,
    } : null });
    if (!parsed.success) return null;
    if (parsed.data.cursor) Object.freeze(parsed.data.cursor);
    const scope = Object.freeze(parsed.data);
    let runReturn: Readonly<OperatorAuditRunReturn> | null = null;
    if (keys.includes("returnToRuns")) {
      if (query.returnToRuns !== "1") return null;
      runReturn = canonicalAuditRunReturn({ runId: scope.runId, cursor: hasReturnCursor ? { createdAt: query.returnBeforeCreatedAt, runId: query.returnBeforeRunId } : null, ...(keys.includes("returnRunState") ? { state: query.returnRunState } : {}), ...(keys.includes("returnIssueQ") ? { issueQuery: query.returnIssueQ } : {}) });
      if (runReturn === null) return null;
    }
    const outcome = auditSourceOutcomeFilter(keys.includes("outcome") ? query.outcome : undefined);
    if (outcome === null) return null;
    const publicationKind = auditPublicationKindFilter(keys.includes("publicationKind") ? query.publicationKind : undefined);
    if (publicationKind === null) return null;
    const sourceQuery = auditSourceQuery(keys.includes("sourceQ") ? query.sourceQ : undefined);
    if (sourceQuery === null) return null;
    const registrationState = auditSourceRegistrationFilter(keys.includes("registration") ? query.registration : undefined);
    if (registrationState === null) return null;
    return { scope, runReturn, ...(keys.includes("sourceQ") ? { sourceQuery } : {}), ...(keys.includes("outcome") ? { outcome } : {}), ...(keys.includes("publicationKind") ? { publicationKind } : {}), ...(keys.includes("registration") ? { registrationState } : {}) };
  } catch (error) { rethrow?.(error); return null; }
}

export function auditRunReturnParams(selection: OperatorAuditRunReturn | null): Record<string, string> {
  if (selection === null) return {};
  return { returnToRuns: "1", ...(selection.state ? { returnRunState: selection.state } : {}), ...(selection.issueQuery ? { returnIssueQ: selection.issueQuery } : {}), ...(selection.cursor ? { returnBeforeCreatedAt: selection.cursor.createdAt, returnBeforeRunId: selection.cursor.runId } : {}) };
}
export function auditBrowseHref(scope: OperatorAuditScope, selection: OperatorAuditRunReturn | null = null, outcome: AuditSourceOutcomeFilter = "", publicationKind: AuditPublicationKindFilter = "", sourceQuery = "", registrationState: AuditSourceRegistrationFilter = ""): string {
  const query = new URLSearchParams({ runId: scope.runId, issueId: scope.issueId });
  if (scope.cursor) {
    query.set("latestRevision", String(scope.cursor.latestRevision)); query.set("headPublicationId", scope.cursor.headPublicationId ?? ""); query.set("beforeRevision", String(scope.cursor.beforeRevision));
  }
  if (selection?.runId === scope.runId) for (const [key, value] of Object.entries(auditRunReturnParams(selection))) query.set(key, value);
  if (outcome) query.set("outcome", outcome);
  if (publicationKind) query.set("publicationKind", publicationKind);
  const sourceSearch = auditSourceQuery(sourceQuery);
  if (sourceSearch) query.set("sourceQ", sourceSearch);
  const registration = auditSourceRegistrationFilter(registrationState);
  if (registration) query.set("registration", registration);
  return `/editorial-preview/audit?${query}`;
}
export function auditRunReturnHref(selection: OperatorAuditRunReturn): string {
  const query = new URLSearchParams({ runId: selection.runId });
  if (selection.cursor) { query.set("beforeCreatedAt", selection.cursor.createdAt); query.set("beforeRunId", selection.cursor.runId); }
  if (selection.state) query.set("state", selection.state);
  if (selection.issueQuery) query.set("issueQ", selection.issueQuery);
  return `/editorial-preview/audit/select?${query}`;
}
