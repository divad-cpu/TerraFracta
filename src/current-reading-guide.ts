import { captureOwnEnumerableSelectors } from "./own-enumerable-selectors.ts";
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

// A separate bounded display target. Raw fragments in returnTo remain refused.
// This identifies a possible in-page destination, not current evidence eligibility.
export function canonicalReadingGuideAnchor(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 80) return null;
  const match = /^(?:claim-([0-9a-fA-F-]{36})|reference-([0-9a-fA-F-]{36})-([1-9]|1[0-2]))$/.exec(input);
  return match && publicIssueProjectionSchema.shape.issueId.safeParse(match[1] ?? match[2]).success ? input : null;
}
export function readingReturnHref(input: unknown, anchor?: unknown): string | null {
  const returnTo = canonicalReadingGuideReturn(input);
  if (!returnTo) return null;
  const target = canonicalReadingGuideAnchor(anchor);
  return target ? `${returnTo}#${target}` : returnTo;
}

export function readingGuideHref(input?: unknown, anchor?: unknown): string {
  const returnTo = canonicalReadingGuideReturn(input);
  const returnAnchor = returnTo ? canonicalReadingGuideAnchor(anchor) : null;
  return returnTo ? `${guidePath}?${new URLSearchParams({ returnTo, ...(returnAnchor ? { returnAnchor } : {}) })}` : guidePath;
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

// Explanatory pages accept the checked route and optional bounded target. Reject
// unknown enumerable keys before values; hidden/inherited fields add no target.
export function readingExplanationContext(input: unknown, rethrow?: (error: unknown) => void): { returnTo: string; returnAnchor?: string } | null {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const keys = Object.keys(input);
    if (keys.some(key => !["returnTo", "returnAnchor"].includes(key)) || !keys.includes("returnTo")) return null;
    // Observe own descriptors once, without borrowing a Proxy get result.
    // Forward any descriptor fault to the outer framework boundary only once.
    const values = captureOwnEnumerableSelectors(input, keys, false, error => { throw error; });
    if (!values) return null;
    const remaining = Object.keys(input);
    if (remaining.length !== keys.length || remaining.some(key => !keys.includes(key))) return null;
    const returnTo = canonicalReadingGuideReturn(values.returnTo);
    if (!returnTo) return null;
    const returnAnchor = keys.includes("returnAnchor") ? canonicalReadingGuideAnchor(values.returnAnchor) : null;
    return { returnTo, ...(returnAnchor ? { returnAnchor } : {}) };
  } catch (error) { rethrow?.(error); return null; }
}
export function readingExplanationReturn(input: unknown, rethrow?: (error: unknown) => void): string | null {
  return readingExplanationContext(input, rethrow)?.returnTo ?? null;
}

export function readingExplanationHref(page: "methodology" | "sources", input?: unknown, anchor?: unknown): string {
  const path = page === "sources" ? "/sources" : "/methodology";
  const returnTo = canonicalReadingGuideReturn(input);
  const returnAnchor = returnTo ? canonicalReadingGuideAnchor(anchor) : null;
  return returnTo ? `${path}?${new URLSearchParams({ returnTo, ...(returnAnchor ? { returnAnchor } : {}) })}` : path;
}

// Query admission may fail before its closed fields can be inspected. Keep
// explanatory content available with no return instead of exposing that fault.
export { awaitRouteSelectors as readingGuideSelectors } from "./await-route-selectors.ts";
