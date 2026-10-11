import { captureOwnEnumerableSelectors } from "./own-enumerable-selectors.ts";
import { demoIssue } from "./demo-content.ts";
import { searchText } from "./search-text.ts";

// A presentation catalog of the one existing illustrative case. Never source
// qualification, a publication projection, or a fallback for a failed reader.
export const visitorTopics = [{ slug: "housing", label: "Housing" }] as const;
export const sampleIssuePath = "/countries/norway/issues/housing-costs";
export const illustrativeCountry = Object.freeze({ slug: "norway", name: demoIssue.country, aliases: Object.freeze(["norway", "norge"]),
  href: "/countries/norway", monogram: "NO", coverage: "Demonstration only" });
const issue = Object.freeze({
  title: demoIssue.title, summary: demoIssue.summary, country: demoIssue.country,
  topic: "housing", topicLabel: "Housing", href: sampleIssuePath,
  coverage: "Demonstration only", evidenceReview: "Not performed",
});

// Only admitted own-enumerable fields may select an illustrative search or
// correction target. Capture once before validation and reuse that snapshot.
function illustrativeSelectors(input: unknown, allowed: readonly string[], rethrow?: (error: unknown) => void): Record<string, unknown> | null {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const keys = Object.keys(input);
    if (keys.some(key => !allowed.includes(key))) return null;
    return captureOwnEnumerableSelectors(input, keys, false, rethrow);
  } catch (error) { rethrow?.(error); return null; }
}

export function findIllustrativeIssues(input: unknown, rethrow?: (error: unknown) => void) {
  const values = illustrativeSelectors(input, ["q", "topic"], rethrow);
  if (values === null)
    return { kind: "invalid" as const, query: "", topic: "", issues: [] };
  const search = searchText(values.q === undefined ? "" : values.q);
  const topic = values.topic === undefined ? "" : values.topic;
  if (search.kind !== "valid" || (topic !== "" && topic !== "housing"))
    return { kind: "invalid" as const, query: "", topic: "", issues: [] };
  const words = search.query.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  const searchable = `${issue.title} ${issue.country} Norge ${issue.topicLabel} household budgets`.toLocaleLowerCase("en");
  return { kind: "valid" as const, query: search.query, topic,
    issues: words.every(word => searchable.includes(word)) ? [issue] : [] };
}

// Country and issue discovery share the same illustrative entry, with identical
// closed search handling. An unavailable current reader never supplies it.
export function findIllustrativeCountries(input: unknown, rethrow?: (error: unknown) => void) {
  const values = illustrativeSelectors(input, ["q"], rethrow);
  if (values === null)
    return { kind: "invalid" as const, query: "", countries: [] };
  const result = findIllustrativeIssues(values);
  if (result.kind === "invalid") return { kind: "invalid" as const, query: "", countries: [] };
  const words = result.query.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  return { kind: "valid" as const, query: result.query,
    countries: words.every(word => illustrativeCountry.aliases.some(name => name.includes(word))) ? [illustrativeCountry] : [] };
}

export const sampleSections = {
  problem: "The problem", response: "The response", uncertainty: "What remains unknown",
  sources: "Evidence and sources",
} as const;
export type SampleSection = keyof typeof sampleSections;

// Only the four already visible sample sections are admitted. No report, source,
// arbitrary path, publication ID, contact information or storage selector.
export function sampleCorrectionSection(input: unknown, rethrow?: (error: unknown) => void): SampleSection | null | "invalid" {
  const values = illustrativeSelectors(input, ["section"], rethrow);
  if (values === null) return "invalid";
  if (values.section === undefined) return null;
  if (typeof values.section !== "string" || !Object.hasOwn(sampleSections, values.section)) return "invalid";
  return values.section as SampleSection;
}
