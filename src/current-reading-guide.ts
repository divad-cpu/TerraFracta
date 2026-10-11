import { currentIssueInspectionHref, currentIssueSelection, type CurrentIssueSelection } from "./current-issue-navigation.ts";
import { publicIssueProjectionSchema, type PublicIssueProjection } from "./public-issue-projection.ts";

const guidePath = "/methodology/glossary";
const origin = "https://reading-guide.invalid";
export const READING_GUIDE_RETURN_LIMIT = 2_048;

// Navigation only: one same-edition current dossier route, never an external
// address, stored snapshot, provider, role or approval. Following it reads now.
export function canonicalReadingGuideReturn(input: unknown): string | null {
  if (typeof input !== "string" || input.length > READING_GUIDE_RETURN_LIMIT ||
      input.includes("#") || !input.startsWith("/reader-preview/") || /[\u0000-\u0020\u007f\\]/.test(input)) return null;
  try {
    const url = new URL(input, origin);
    const route = /^\/reader-preview\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/issue$/.exec(url.pathname);
    if (url.origin !== origin || url.hash || !route ||
        !publicIssueProjectionSchema.shape.jurisdictionSlug.safeParse(route[1]).success ||
        !publicIssueProjectionSchema.shape.issueSlug.safeParse(route[2]).success) return null;
    const query = Object.create(null) as Record<string, string>;
    for (const [key, value] of url.searchParams) {
      if (Object.hasOwn(query, key)) return null;
      query[key] = value;
    }
    const selected = currentIssueSelection("issue", query);
    if (!selected || selected.publicationId === null) return null;
    return `${url.pathname}?${url.searchParams}`;
  } catch { return null; }
}

export function readingGuideHref(input?: unknown): string {
  const returnTo = canonicalReadingGuideReturn(input);
  return returnTo ? `${guidePath}?${new URLSearchParams({ returnTo })}` : guidePath;
}

export function currentReadingGuideReturn(issue: PublicIssueProjection, selection: CurrentIssueSelection): string | null {
  try {
    // An issue visit may already carry the explicit selected-result return.
    // Reuse its existing checked serializer instead of losing that context.
    const selected = selection.view === "issue" && selection.returnTo ?
      { ...selection, view: selection.returnTo.view, query: selection.returnTo.query,
        statementType: selection.returnTo.statementType, relation: selection.returnTo.relation } : selection;
    return canonicalReadingGuideReturn(currentIssueInspectionHref(issue, selected));
  } catch { return null; }
}

// Explanatory pages accept only the existing checked return selector. Reject
// unknown enumerable keys before values; hidden/inherited fields add no target.
export function readingExplanationReturn(input: unknown, rethrow?: (error: unknown) => void): string | null {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const values = input as Record<string, unknown>, keys = Object.keys(values);
    if (keys.some(key => key !== "returnTo") || !keys.includes("returnTo")) return null;
    return canonicalReadingGuideReturn(values.returnTo);
  } catch (error) { rethrow?.(error); return null; }
}

export function readingExplanationHref(page: "methodology" | "sources", input?: unknown): string {
  const path = page === "sources" ? "/sources" : "/methodology";
  const returnTo = canonicalReadingGuideReturn(input);
  return returnTo ? `${path}?${new URLSearchParams({ returnTo })}` : path;
}

// Query admission may fail before its closed fields can be inspected. Keep
// explanatory content available with no return instead of exposing that fault.
export { awaitRouteSelectors as readingGuideSelectors } from "./await-route-selectors.ts";
