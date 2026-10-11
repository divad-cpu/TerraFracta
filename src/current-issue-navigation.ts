import { samePresentationEdition } from "./same-presentation-edition.ts";
import { captureOwnEnumerableSelectors } from "./own-enumerable-selectors.ts";
import { z } from "zod";
import { searchText } from "./search-text.ts";
import type { PublicIssueProjection } from "./public-issue-projection.ts";
import type { PublicReadResponseDecision } from "./public-read-response.ts";
import { evidenceLabels, statementLabels, type StatementType, type EvidenceRelation } from "./issue-display-labels.ts";
import { issueReferenceAnchor } from "./issue-source-index.ts";
import { currentCatalogueSelection, currentCatalogueViews, currentVisitorEntry, type CurrentCatalogueSelection, type CurrentCatalogueView } from "./current-visitor-catalog.ts";

export const currentIssueViews = ["issue", "sources", "search"] as const;
export type CurrentIssueView = typeof currentIssueViews[number];
export type CurrentIssueReturnSelection = Readonly<{ view: "search" | "sources"; query: string;
  statementType: StatementType | ""; relation: EvidenceRelation | "" }>;
export type CurrentIssueSelection = { view: CurrentIssueView; publicationId: string | null; query: string;
  statementType: StatementType | ""; relation: EvidenceRelation | ""; returnTo?: CurrentIssueReturnSelection; directory?: Readonly<CurrentCatalogueSelection> };

// Closed presentation selectors; neither an edition nor a search can select a
// stored candidate, source, SQL statement or role. The caller always reads now.
export function currentIssueSelection(view: unknown, input: unknown, rethrow?: (error: unknown) => void): CurrentIssueSelection | null {
  try {
  if (!currentIssueViews.includes(view as CurrentIssueView) || input === null ||
      typeof input !== "object" || Array.isArray(input)) return null;
  const inputQuery = input as Record<string, unknown>, keys = Object.keys(inputQuery);
  const searchable = view === "search" || view === "sources";
  const returnKeys = ["returnView", "returnQ", "returnType", "returnRelation"];
  const directoryKeys = ["directoryView", "directoryQ", "directoryCountry", "directoryTopic"];
  if (keys.some(key => key !== "edition" && !(searchable && ["q", "type"].includes(key)) &&
      !(view === "sources" && key === "relation") && !(view === "issue" && returnKeys.includes(key)) && !directoryKeys.includes(key))) return null;
  // Read each admitted own-enumerable value once. Later navigation must not
  // borrow prototype fields or reread a changing caller across the reader await.
  const query = captureOwnEnumerableSelectors(inputQuery, keys, false, rethrow);
  if (query === null) return null;
  const publicationId = query.edition === undefined ? null : z.uuid().safeParse(query.edition);
  if (publicationId !== null && !publicationId.success) return null;
  const search = searchText(query.q === undefined ? "" : query.q);
  if (search.kind !== "valid") return null;
  const statementType = query.type === undefined ? "" : query.type, relation = query.relation === undefined ? "" : query.relation;
  if (typeof statementType !== "string" || (statementType !== "" && !Object.hasOwn(statementLabels, statementType)) ||
      typeof relation !== "string" || (relation !== "" && !Object.hasOwn(evidenceLabels, relation))) return null;
  let returnTo: CurrentIssueReturnSelection | undefined;
  if (keys.some(key => returnKeys.includes(key))) {
    const returnView = query.returnView;
    if (publicationId === null || !keys.includes("edition") ||
        (returnView !== "search" && returnView !== "sources") ||
        (returnView === "search" && keys.includes("returnRelation"))) return null;
    const checked = currentIssueSelection(returnView, { edition: publicationId.data, q: query.returnQ, type: query.returnType,
      ...(returnView === "sources" ? { relation: query.returnRelation } : {}) });
    if (checked === null) return null;
    returnTo = Object.freeze({ view: returnView, query: checked.query, statementType: checked.statementType, relation: checked.relation });
  }
  let directory: Readonly<CurrentCatalogueSelection> | undefined;
  if (keys.some(key => directoryKeys.includes(key))) {
    if (publicationId === null || !keys.includes("edition") || !keys.includes("directoryView") ||
        !currentCatalogueViews.includes(query.directoryView as CurrentCatalogueView)) return null;
    const checked = currentCatalogueSelection({ view: query.directoryView, q: query.directoryQ,
      country: query.directoryCountry, topic: query.directoryTopic, edition: publicationId.data });
    if (checked === null) return null;
    directory = Object.freeze(checked);
  }
  return { view: view as CurrentIssueView, publicationId: publicationId?.data ?? null, query: search.query,
    statementType: statementType as CurrentIssueSelection["statementType"], relation: relation as CurrentIssueSelection["relation"],
    ...(returnTo ? { returnTo } : {}), ...(directory ? { directory } : {}) };
  } catch (error) { rethrow?.(error); return null; }
}

export function currentIssueHref(issue: PublicIssueProjection, view: CurrentIssueView, bindEdition = true) {
  const route = `/reader-preview/${issue.jurisdictionSlug}/${issue.issueSlug}/${view}`;
  return bindEdition ? `${route}?edition=${issue.publicationId}` : route;
}

// Directory context remains limited to the one server-owned catalogue route.
// It is navigation only, not stored coverage, a provider selector or a return URL.
function ownDirectoryValues(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const keys = Object.keys(input), fields = ["view", "query", "country", "topic", "publicationId"];
  if (fields.some(field => !keys.includes(field)) || keys.some(key => !fields.includes(key))) return null;
  const values = captureOwnEnumerableSelectors(input, keys);
  if (values === null) return null;
  if (typeof values.query !== "string" || typeof values.country !== "string" || typeof values.topic !== "string" ||
      (values.publicationId !== null && typeof values.publicationId !== "string")) return null;
  return currentCatalogueViews.includes(values.view as CurrentCatalogueView) ? values : null;
}
function checkedIssueDirectory(issue: PublicIssueProjection, selection: CurrentIssueSelection) {
  try {
    const keys = Object.keys(selection);
    if (!keys.includes("directory") || !keys.includes("publicationId")) return null;
    const { directory, publicationId } = selection;
    if (!directory || !samePresentationEdition(publicationId, issue.publicationId) ||
        issue.jurisdictionSlug !== currentVisitorEntry.jurisdictionSlug || issue.issueSlug !== currentVisitorEntry.issueSlug) return null;
    const captured = ownDirectoryValues(directory);
    if (!captured) return null;
    const { view, query, country, topic, publicationId: edition } = captured;
    if (!samePresentationEdition(edition, issue.publicationId) || !currentCatalogueViews.includes(view as CurrentCatalogueView)) return null;
    return currentCatalogueSelection({ view, q: query, country, topic, edition });
  } catch { return null; }
}
export function currentIssueDirectoryFields(issue: PublicIssueProjection, selection: CurrentIssueSelection): [string, string][] {
  const checked = checkedIssueDirectory(issue, selection);
  if (!checked) return [];
  return [["directoryView", checked.view], ...[...(checked.query ? [["directoryQ", checked.query]] : []),
    ...(checked.country ? [["directoryCountry", checked.country]] : []), ...(checked.topic ? [["directoryTopic", checked.topic]] : [])] as [string, string][]];
}
function issueDirectoryFieldsHref(issue: PublicIssueProjection, view: CurrentIssueView, fields: [string, string][]) {
  if (!fields.length) return currentIssueHref(issue, view);
  const params = new URLSearchParams([["edition", issue.publicationId], ...fields]);
  return `${currentIssueHref(issue, view, false)}?${params}`;
}
export function currentIssueSelectedHref(issue: PublicIssueProjection, view: CurrentIssueView, selection: CurrentIssueSelection) {
  if (!currentIssueViews.includes(view)) return currentIssueHref(issue, "issue");
  return issueDirectoryFieldsHref(issue, view, currentIssueDirectoryFields(issue, selection));
}
export function currentIssueDirectoryHref(issue: PublicIssueProjection, selection: CurrentIssueSelection): string | null {
  const checked = checkedIssueDirectory(issue, selection);
  if (!checked) return null;
  const params = new URLSearchParams({ view: checked.view, edition: issue.publicationId });
  if (checked.query) params.set("q", checked.query);
  if (checked.country) params.set("country", checked.country);
  if (checked.topic) params.set("topic", checked.topic);
  return `/reader-preview/catalogue?${params}`;
}
export function currentCatalogueIssueHref(issue: PublicIssueProjection, view: CurrentIssueView, selection: CurrentCatalogueSelection) {
  if (!currentIssueViews.includes(view)) return currentIssueHref(issue, "issue");
  const plain = currentIssueHref(issue, view);
  try {
    const captured = ownDirectoryValues(selection);
    if (!captured) return plain;
    const { view: directoryView, query, country, topic, publicationId } = captured;
    if (publicationId !== null && !samePresentationEdition(publicationId, issue.publicationId)) return plain;
    const directory = currentCatalogueSelection({ view: directoryView, q: query, country, topic, edition: issue.publicationId });
    if (!directory) return plain;
    return currentIssueSelectedHref(issue, view, { view, publicationId: issue.publicationId, query: "", statementType: "", relation: "", directory });
  } catch { return plain; }
}

// The context is a bounded presentation selection, not a return address or a
// stored result. Both directions use a new current-route read in the same edition.
export function currentIssueInspectionHref(issue: PublicIssueProjection, selection: CurrentIssueSelection) {
  try {
    const keys = Object.keys(selection);
    const { view, publicationId, query, statementType, relation } = selection;
    const directory = keys.includes("directory") && keys.includes("publicationId") ? selection.directory : undefined;
    const fields = currentIssueDirectoryFields(issue, { view, publicationId, query, statementType, relation,
      ...(directory ? { directory } : {}) });
    const plain = issueDirectoryFieldsHref(issue, "issue", fields);
    if ((view !== "search" && view !== "sources") ||
        (publicationId !== null && !samePresentationEdition(publicationId, issue.publicationId)) || (view === "search" && relation !== "")) return plain;
    const checked = currentIssueSelection(view, { edition: issue.publicationId, q: query, type: statementType,
      ...(view === "sources" ? { relation } : {}) });
    if (checked === null) return plain;
    const params = new URLSearchParams([["edition", issue.publicationId], ["returnView", view], ...fields]);
    if (checked.query) params.set("returnQ", checked.query);
    if (checked.statementType) params.set("returnType", checked.statementType);
    if (checked.relation) params.set("returnRelation", checked.relation);
    return `${currentIssueHref(issue, "issue", false)}?${params}`;
  } catch { return currentIssueHref(issue, "issue"); }
}

export function currentIssueReturnHref(issue: PublicIssueProjection, selection: CurrentIssueSelection): string | null {
  try {
    if (selection.view !== "issue" || !samePresentationEdition(selection.publicationId, issue.publicationId) || !selection.returnTo) return null;
    const { view, query, statementType, relation } = selection.returnTo;
    if ((view !== "search" && view !== "sources") || (view === "search" && relation !== "")) return null;
    const checked = currentIssueSelection(view, { edition: issue.publicationId, q: query, type: statementType,
      ...(view === "sources" ? { relation } : {}) });
    if (checked === null) return null;
    const params = new URLSearchParams([["edition", issue.publicationId], ...currentIssueDirectoryFields(issue, selection)]);
    if (checked.query) params.set("q", checked.query);
    if (checked.statementType) params.set("type", checked.statementType);
    if (checked.relation) params.set("relation", checked.relation);
    return `${currentIssueHref(issue, view, false)}?${params}`;
  } catch { return null; }
}

export type CurrentIssueVisit =
  | { kind: "issue"; issue: PublicIssueProjection }
  | { kind: "changed" }
  | { kind: "absent" }
  | { kind: "unavailable" };

export function currentIssueVisit(decision: PublicReadResponseDecision, expectedPublicationId: string | null): CurrentIssueVisit {
  if (decision.status === 404) return { kind: "absent" };
  if (decision.status !== 200) return { kind: "unavailable" };
  if (expectedPublicationId !== null && !samePresentationEdition(expectedPublicationId, decision.issue.publicationId)) return { kind: "changed" };
  return { kind: "issue", issue: decision.issue };
}

export function searchCurrentIssue(issue: PublicIssueProjection, query: string) {
  return currentIssueSearchMatches(issue, query).map(item => item.claim);
}

// Explain literal matches without manufacturing a source interpretation, score
// or ranking. Every term must occur somewhere in this same record's fields.
function matchFields(fields: [string, string][], query: string) {
  const search = searchText(query);
  if (search.kind !== "valid") return { matched: false, fields: [] as string[] };
  const words = search.query.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  const normalized = fields.map(([label, value]) => [label, value.normalize("NFKC").toLocaleLowerCase("en")] as const);
  const matched = words.every(word => normalized.some(([, value]) => value.includes(word)));
  return { matched, fields: words.length ? [...new Set(normalized.filter(([, value]) => words.some(word => value.includes(word))).map(([label]) => label))] : [] };
}

function sourceSearchFields(source: PublicIssueProjection["claims"][number]["evidence"][number]): [string, string][] {
  return [["Source title", source.title], ["Publisher", source.publisher], ["Exact location", source.locator]];
}

export function currentIssueSearchMatches(issue: PublicIssueProjection, query: string, type: StatementType | "" = "") {
  let referenceNumber = 0;
  return issue.claims.flatMap(claim => {
    const references = claim.evidence.map((source, index) => ({ source, referenceNumber: ++referenceNumber,
      anchor: issueReferenceAnchor(claim.id, index) }));
    if (type && claim.type !== type) return [];
    const matched = matchFields([["Issue title", issue.title], ["Statement", claim.assertion], ["Data period", claim.periodLabel],
      ...claim.evidence.flatMap(sourceSearchFields)], query);
    if (!matched.matched) return [];
    // A statement may match across several fields/references. These links locate
    // any search word in this occurrence; they do not assert full-query support.
    const matchedReferences = references.flatMap(reference => {
      const fields = matchFields(sourceSearchFields(reference.source), query).fields;
      return fields.length ? [{ ...reference, matchedFields: fields }] : [];
    });
    return [{ claim, matchedFields: matched.fields, matchedReferences }];
  });
}

export function currentIssueReferenceMatches(issue: PublicIssueProjection, selection: Pick<CurrentIssueSelection, "query" | "statementType" | "relation">) {
  let referenceNumber = 0;
  const references = issue.claims.flatMap(claim => claim.evidence.map((source, index) => ({ claim, source,
    referenceNumber: ++referenceNumber, anchor: issueReferenceAnchor(claim.id, index) })));
  const matched = references.flatMap(row => {
    if ((selection.statementType && row.claim.type !== selection.statementType) || (selection.relation && row.source.relation !== selection.relation)) return [];
    const match = matchFields([["Issue title", issue.title], ["Statement", row.claim.assertion], ["Data period", row.claim.periodLabel],
      ["Source title", row.source.title], ["Publisher", row.source.publisher], ["Exact location", row.source.locator],
      ["Source URL", row.source.url], ["Source published", row.source.sourcePublishedOn ?? ""], ["Retrieved", row.source.retrievedAt]], selection.query);
    return match.matched ? [{ ...row, matchedFields: match.fields }] : [];
  });
  return { total: references.length, references: matched,
    matchingStatements: new Set(matched.map(row => row.claim.id)).size,
    dossierConflictReferences: references.filter(row => row.source.relation === "contradicts").length };
}
