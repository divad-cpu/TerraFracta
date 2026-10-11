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
  const fields = selection.view === "countries" ? entry.countryAliases.join(" ") :
    `${entry.countryAliases.join(" ")} ${entry.topicLabel} ${issue.title} ${issue.summary}`;
  const searchable = fields.normalize("NFKC").toLocaleLowerCase("en");
  return { kind: "available", selection, issue, matches: words.every(word => searchable.includes(word)) };
}

export function currentCatalogueHref(view: CurrentCatalogueView, publicationId: string | null = null, country = "") {
  const query = new URLSearchParams({ view });
  if (publicationId !== null) query.set("edition", publicationId);
  if (country) query.set("country", country);
  return `/reader-preview/catalogue?${query}`;
}
