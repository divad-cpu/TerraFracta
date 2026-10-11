import { samePresentationEdition } from "./same-presentation-edition.ts";
import type { PublicIssueProjection } from "./public-issue-projection.ts";
import { currentIssueSelection, currentIssueHref, currentIssueDirectoryFields, type CurrentIssueSelection } from "./current-issue-navigation.ts";
import { statementLabels, evidenceLabels } from "./issue-display-labels.ts";

export type CurrentIssueFilterAction = Readonly<{ field: "q" | "type" | "relation"; label: string; value: string; href: string }>;

// Navigation only. Removing a filter makes a fresh current read and retains the
// other admitted filters; it never changes the evidence or its qualification.
export function currentIssueFilterActions(issue: PublicIssueProjection, selection: CurrentIssueSelection): readonly CurrentIssueFilterAction[] {
  try {
    const keys = Object.keys(selection);
    const required = ["view", "publicationId", "query", "statementType", "relation"];
    if (required.some(key => !keys.includes(key)) || keys.some(key => !required.includes(key) && key !== "directory")) return [];
    const captured = Object.create(null) as Record<string, unknown>;
    for (const key of keys) captured[key] = selection[key as keyof CurrentIssueSelection];
    const { view, publicationId, query, statementType, relation } = captured;
    if ((view !== "search" && view !== "sources") || (publicationId !== null && !samePresentationEdition(publicationId, issue.publicationId)) ||
        (view === "search" && relation !== "")) return [];
    const checked = currentIssueSelection(view, { edition: issue.publicationId, q: query, type: statementType,
      ...(view === "sources" ? { relation } : {}) });
    if (!checked) return [];
    const fields = currentIssueDirectoryFields(issue, { ...checked, publicationId: publicationId as string | null,
      ...(keys.includes("directory") ? { directory: captured.directory as CurrentIssueSelection["directory"] } : {}) });
    const active = [
      ...(checked.query ? [{ field: "q" as const, label: "Search words", value: checked.query }] : []),
      ...(checked.statementType ? [{ field: "type" as const, label: "Statement type", value: statementLabels[checked.statementType] }] : []),
      ...(checked.relation ? [{ field: "relation" as const, label: "Reference role", value: evidenceLabels[checked.relation] }] : []),
    ];
    return Object.freeze(active.map(action => {
      const params = new URLSearchParams([["edition", issue.publicationId], ...fields]);
      if (checked.query && action.field !== "q") params.set("q", checked.query);
      if (checked.statementType && action.field !== "type") params.set("type", checked.statementType);
      if (checked.relation && action.field !== "relation") params.set("relation", checked.relation);
      return Object.freeze({ ...action, href: `${currentIssueHref(issue, view, false)}?${params}` });
    }));
  } catch { return []; }
}
