import { samePresentationEdition } from "./same-presentation-edition.ts";
import { captureOwnEnumerableSelectors } from "./own-enumerable-selectors.ts";
import { z } from "zod";
import { searchText } from "./search-text.ts";
import { publicIssueProjectionSchema, type PublicIssueProjection } from "./public-issue-projection.ts";
import type { PublicReadResponseDecision } from "./public-read-response.ts";

// A single server-owned reader slot. Its presence is not country coverage,
// source approval, a configured provider or a fallback to the illustration.
export const currentVisitorEntry = Object.freeze({
  jurisdictionSlug: "norway", issueSlug: "housing-costs", country: "Norway",
  countryAliases: Object.freeze(["Norway", "Norge"]), topic: "housing", topicLabel: "Housing",
});
export type CurrentVisitorEntry = Readonly<{ jurisdictionSlug: string; issueSlug: string; country: string;
  countryAliases: readonly string[]; topic: string; topicLabel: string }>;
export const currentCatalogueViews = ["overview", "countries", "issues"] as const;
export type CurrentCatalogueView = typeof currentCatalogueViews[number];
export type CurrentCatalogueSelection = { view: CurrentCatalogueView; query: string; country: string; topic: string; publicationId: string | null };

export function currentCatalogueSelection(input: unknown, entry: CurrentVisitorEntry = currentVisitorEntry, rethrow?: (error: unknown) => void): CurrentCatalogueSelection | null {
  try {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const inputValues = input as Record<string, unknown>, keys = Object.keys(inputValues);
  if (keys.some(key => !["view", "q", "country", "topic", "edition"].includes(key))) return null;
  // Keep one own-enumerable scalar snapshot before validation and the current read.
  const values = captureOwnEnumerableSelectors(inputValues, keys, false, rethrow);
  if (values === null) return null;
  const view = values.view === undefined ? "overview" : values.view;
  const search = searchText(values.q === undefined ? "" : values.q);
  const country = values.country === undefined ? "" : values.country;
  const topic = values.topic === undefined ? "" : values.topic;
  const edition = values.edition === undefined ? null : z.uuid().safeParse(values.edition);
  if (!currentCatalogueViews.includes(view as CurrentCatalogueView) || search.kind !== "valid" ||
      (country !== "" && country !== entry.jurisdictionSlug) || (topic !== "" && topic !== entry.topic) ||
      (edition !== null && !edition.success)) return null;
  return { view: view as CurrentCatalogueView, query: search.query, country: country as string,
    topic: topic as string, publicationId: edition?.data ?? null };
  } catch (error) { rethrow?.(error); return null; }
}

export type CurrentCatalogueResult =
  | { kind: "invalid" }
  | { kind: "absent" | "unavailable" | "changed"; selection: CurrentCatalogueSelection }
  | { kind: "available"; selection: CurrentCatalogueSelection; issue: PublicIssueProjection; matches: boolean };

function catalogueSearchFields(issue: PublicIssueProjection, selection: CurrentCatalogueSelection, entry: CurrentVisitorEntry) {
  const country = { key: "country", label: "Country names", values: entry.countryAliases };
  return selection.view === "countries" ? [country] : [country,
    { key: "topic", label: "Topic", values: [entry.topicLabel] },
    { key: "title", label: "Dossier title", values: [issue.title] },
    { key: "summary", label: "Summary", values: [issue.summary] }];
}

// Explain literal locations in already checked discovery fields. This never
// decides eligibility or adds statement/source fields to directory search.
export function currentCatalogueSearchBasis(issue: PublicIssueProjection, selection: CurrentCatalogueSelection,
  entry: CurrentVisitorEntry = currentVisitorEntry) {
  const search = searchText(selection.query);
  if (search.kind !== "valid" || !search.query) return { fields: [], countryNames: [] };
  const words = search.query.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  const matches = (value: string) => words.some(word => value.normalize("NFKC").toLocaleLowerCase("en").includes(word));
  const fields = catalogueSearchFields(issue, selection, entry).filter(field => field.values.some(matches)).map(field => field.label);
  const countryNames = [...new Set(entry.countryAliases.filter(value => value !== entry.country && matches(value)))];
  return { fields, countryNames };
}

// The supplied decision must come from the checked current reader. Rechecking
// its closed display shape here grants no independent eligibility or rights.
export function currentCatalogueResult(decision: PublicReadResponseDecision, selection: CurrentCatalogueSelection,
  entry: CurrentVisitorEntry = currentVisitorEntry): CurrentCatalogueResult {
  if (decision.status === 404) return { kind: "absent", selection };
  if (decision.status !== 200) return { kind: "unavailable", selection };
  const parsed = publicIssueProjectionSchema.safeParse(decision.issue);
  if (!parsed.success || parsed.data.jurisdictionSlug !== entry.jurisdictionSlug || parsed.data.issueSlug !== entry.issueSlug)
    return { kind: "unavailable", selection };
  const issue = parsed.data;
  if (selection.publicationId !== null && !samePresentationEdition(selection.publicationId, issue.publicationId)) return { kind: "changed", selection };
  const words = selection.query.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  const fields = catalogueSearchFields(issue, selection, entry).flatMap(field => field.values).join(" ");
  const searchable = fields.normalize("NFKC").toLocaleLowerCase("en");
  return { kind: "available", selection, issue, matches: words.every(word => searchable.includes(word)) };
}

export function currentCatalogueHref(view: CurrentCatalogueView, publicationId: string | null = null, country = "") {
  const query = new URLSearchParams({ view });
  if (publicationId !== null) query.set("edition", publicationId);
  if (country) query.set("country", country);
  return `/reader-preview/catalogue?${query}`;
}

export type CurrentCatalogueFilterAction = Readonly<{ field: "q" | "country" | "topic"; label: string; value: string; href: string }>;

// Removing a presentation filter makes a new checked directory visit. The
// current publication and other selections stay bound; no coverage is granted.
export function currentCatalogueFilterActions(issue: PublicIssueProjection, selection: CurrentCatalogueSelection,
  entry: CurrentVisitorEntry = currentVisitorEntry): readonly CurrentCatalogueFilterAction[] {
  try {
    const keys = Object.keys(selection), required = ["view", "query", "country", "topic", "publicationId"];
    if (required.some(key => !keys.includes(key)) || keys.some(key => !required.includes(key))) return [];
    const values = captureOwnEnumerableSelectors(selection, keys);
    if (values === null) return [];
    const { view, query, country, topic, publicationId } = values;
    if (typeof query !== "string" || typeof country !== "string" || typeof topic !== "string" ||
        (publicationId !== null && typeof publicationId !== "string") ||
        (publicationId !== null && !samePresentationEdition(publicationId, issue.publicationId)) ||
        issue.jurisdictionSlug !== entry.jurisdictionSlug || issue.issueSlug !== entry.issueSlug) return [];
    const checked = currentCatalogueSelection({ view, q: query, country, topic, edition: issue.publicationId }, entry);
    if (!checked) return [];
    const active = [
      ...(checked.query ? [{ field: "q" as const, label: "Search words", value: checked.query }] : []),
      ...(checked.country ? [{ field: "country" as const, label: "Country", value: entry.country }] : []),
      ...(checked.topic ? [{ field: "topic" as const, label: "Topic", value: entry.topicLabel }] : []),
    ];
    return Object.freeze(active.map(action => {
      const params = new URLSearchParams({ view: checked.view, edition: issue.publicationId });
      if (checked.query && action.field !== "q") params.set("q", checked.query);
      if (checked.country && action.field !== "country") params.set("country", checked.country);
      if (checked.topic && action.field !== "topic") params.set("topic", checked.topic);
      return Object.freeze({ ...action, href: `/reader-preview/catalogue?${params}` });
    }));
  } catch { return []; }
}
