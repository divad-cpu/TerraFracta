import { z } from "zod";

// Only checked private record references or independently canonical selection
// may supply context. A held row alone has no issue target.
const id = z.uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const scope = z.strictObject({ runId: id.optional(), issueId: id.optional(), decisionId: id.optional() })
  .refine(value => (!value.issueId && !value.decisionId) || !!value.runId);
export type OperatorWorkspaceContext = z.infer<typeof scope>;
export type OperatorWorkspaceLocation = "overview" | "runs" | "holds" | "comparison" | "audit";
export function operatorWorkspaceLinks(input: unknown) {
  const parsed = scope.safeParse(input), context = parsed.success ? parsed.data : {};
  const run = context.runId ? new URLSearchParams({ runId: context.runId }) : null;
  const audit = context.runId && context.issueId ? `/editorial-preview/audit?${new URLSearchParams({ runId: context.runId, issueId: context.issueId })}` : null;
  return { context, links: [
    { key: "overview", label: "Workspace overview", href: "/editorial-preview/exceptions" },
    { key: "runs", label: "Recorded runs", href: run ? `/editorial-preview/audit/select?${run}` : "/editorial-preview/audit/select" },
    { key: "holds", label: "Held candidates", href: run ? `/editorial-preview/held?${run}` : null },
    { key: "comparison", label: "Proposal comparison", href: run && context.decisionId ? `/editorial-preview/held/proposal?${new URLSearchParams({ runId: context.runId!, decisionId: context.decisionId })}` : null },
    { key: "audit", label: "Recorded source checks", href: audit ? `${audit}#audit-sources-heading` : null },
    { key: "audit", label: "Publication records", href: audit ? `${audit}#audit-history-heading` : null },
  ] };
}
