import { captureOwnEnumerableSelectors } from "./own-enumerable-selectors.ts";
import { auditRunReturnParams, type OperatorAuditRunReturn } from "./operator-audit-navigation.ts";
import { proposalScopeSchema, type ProposalScope } from "./operator-proposal-capture.ts";
import { heldBrowseSelection, type HeldReasonFilter } from "./operator-held-browse.ts";
import type { HeldDecisionScope } from "./operator-held-decisions.ts";

export type ProposalHeldReturn = { scope: HeldDecisionScope; reason: HeldReasonFilter; referenceQuery?: string; runReturn?: Readonly<OperatorAuditRunReturn> };
export function proposalBrowseSelection(input: unknown, rethrow?: (error: unknown) => void): { scope: Readonly<ProposalScope>; held: ProposalHeldReturn | null; query: Readonly<Record<string, string>> } | null {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const inputQuery = input as Record<string, unknown>, keys = Object.keys(inputQuery);
    if (!keys.includes("runId") || !keys.includes("decisionId") || keys.some(key =>
      !["runId", "decisionId", "beforeDecidedAt", "beforeDecisionId", "reason", "heldQ", "returnToRuns", "returnBeforeCreatedAt", "returnBeforeRunId", "returnRunState", "returnIssueQ"].includes(key))) return null;
    const query = captureOwnEnumerableSelectors(inputQuery, keys, true, rethrow);
    if (query === null) return null;
    const parsed = proposalScopeSchema.safeParse({ runId: query.runId, decisionId: query.decisionId });
    if (!parsed.success) return null;
    const context = keys.filter(key => key !== "decisionId");
    const held = heldBrowseSelection(Object.fromEntries(context.map(key => [key, query[key]])));
    if (held === null) return null;
    return { scope: Object.freeze(parsed.data), held: context.length > 1 ? held : null, query: Object.freeze({ ...query }) };
  } catch (error) { rethrow?.(error); return null; }
}

// Context selects a new held-page read, never a provider or proposal read scope.
export function capturedProposalHref(scope: ProposalScope, held: ProposalHeldReturn | null = null) {
  const query = new URLSearchParams({ runId: scope.runId, decisionId: scope.decisionId });
  if (held?.scope.runId === scope.runId) {
    if (held.scope.cursor) {
      query.set("beforeDecidedAt", held.scope.cursor.decidedAt);
      query.set("beforeDecisionId", held.scope.cursor.decisionId);
    }
    if (held.reason) query.set("reason", held.reason);
    if (held.referenceQuery) query.set("heldQ", held.referenceQuery);
    if (held.runReturn?.runId === scope.runId) for (const [key, value] of Object.entries(auditRunReturnParams(held.runReturn))) query.set(key, value);
  }
  return `/editorial-preview/held/proposal?${query}`;
}
