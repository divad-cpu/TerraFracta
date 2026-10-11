import { captureOwnEnumerableSelectors } from "./own-enumerable-selectors.ts";
import { auditRunReturnParams, canonicalAuditRunReturn, type OperatorAuditRunReturn } from "./operator-audit-navigation.ts";
import { heldReasonCodes, heldDecisionScopeSchema, type HeldDecisionScope } from "./operator-held-decisions.ts";

export type HeldReasonFilter = typeof heldReasonCodes[number] | "";
export function heldReasonFilter(value: unknown): HeldReasonFilter | null {
  return value === undefined || value === "" ? "" : typeof value === "string" && heldReasonCodes.includes(value as typeof heldReasonCodes[number]) ? value as HeldReasonFilter : null;
}

// Presentation-only filter. The private read remains scoped solely to the exact
// run/cursor; filtering cannot select a provider or extend its bounded page.
export function heldBrowseSelection(input: unknown, rethrow?: (error: unknown) => void): { scope: HeldDecisionScope; reason: HeldReasonFilter; runReturn?: Readonly<OperatorAuditRunReturn> } | null {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const inputQuery = input as Record<string, unknown>, keys = Object.keys(inputQuery);
    if (!keys.includes("runId") || keys.some(key => !["runId", "beforeDecidedAt", "beforeDecisionId", "reason", "returnToRuns", "returnBeforeCreatedAt", "returnBeforeRunId"].includes(key))) return null;
    if (keys.includes("beforeDecidedAt") !== keys.includes("beforeDecisionId")) return null;
    const hasReturnCursor = keys.includes("returnBeforeCreatedAt") || keys.includes("returnBeforeRunId");
    if (hasReturnCursor && (!keys.includes("returnToRuns") || keys.includes("returnBeforeCreatedAt") !== keys.includes("returnBeforeRunId"))) return null;
    // Capture only admitted own-enumerable strings once. Validation and the
    // subsequent private read must use the same run, tuple and display filter.
    const query = captureOwnEnumerableSelectors(inputQuery, keys, true, rethrow);
    if (query === null) return null;
    const reason = heldReasonFilter(keys.includes("reason") ? query.reason : undefined);
    if (reason === null) return null;
    const cursor = keys.includes("beforeDecidedAt") || keys.includes("beforeDecisionId")
      ? { decidedAt: query.beforeDecidedAt, decisionId: query.beforeDecisionId } : null;
    const checked = heldDecisionScopeSchema.safeParse({ runId: query.runId, cursor });
    if (!checked.success) return null;
    if (!keys.includes("returnToRuns")) return { scope: checked.data, reason };
    if (query.returnToRuns !== "1") return null;
    const runReturn = canonicalAuditRunReturn({ runId: checked.data.runId, cursor: hasReturnCursor ? { createdAt: query.returnBeforeCreatedAt, runId: query.returnBeforeRunId } : null });
    return runReturn === null ? null : { scope: checked.data, reason, runReturn };
  } catch (error) { rethrow?.(error); return null; }
}

export function heldBrowseHref(scope: HeldDecisionScope, reason: HeldReasonFilter = "", runReturn: OperatorAuditRunReturn | null = null) {
  const query = new URLSearchParams({ runId: scope.runId });
  if (scope.cursor) { query.set("beforeDecidedAt", scope.cursor.decidedAt); query.set("beforeDecisionId", scope.cursor.decisionId); }
  if (reason) query.set("reason", reason);
  if (runReturn?.runId === scope.runId) for (const [key, value] of Object.entries(auditRunReturnParams(runReturn))) query.set(key, value);
  return `/editorial-preview/held?${query}`;
}
