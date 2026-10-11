import { canonicalReadingGuideReturn, readingGuideHref } from "./current-reading-guide.ts";
import { statementLabels, evidenceLabels } from "./issue-display-labels.ts";
import { searchText } from "./search-text.ts";

// Reader guidance from the existing editorial method, never a source verdict.
// Search preserves this authored order and cannot inspect dossiers or archives.
export const glossaryCategories = {
  statements: "Statements and public responses", evidence: "Sources and evidence",
  dates: "Dates and versions", interpretation: "Reading numbers and uncertainty",
} as const;
export type GlossaryCategory = keyof typeof glossaryCategories;
export const glossaryTerms = [
  { slug: "condition", category: "statements", label: statementLabels.condition,
    explanation: "A measured or documented situation for a stated population, place and period. Its units and definition determine what the observation means.",
    question: "Who and what were measured, over which period, and with which limitations?" },
  { slug: "policy-action", category: "statements", label: statementLabels.policy_action,
    explanation: "A documented decision or action by an identified authority. Announced, authorized, in force and implemented describe different stages.",
    question: "Which stage does the source establish, and when did it happen?" },
  { slug: "funding", category: "statements", label: statementLabels.funding,
    explanation: "Money announced, allocated, disbursed or spent. Keep the financial year, currency and whether amounts are cumulative visible. A budget allocation does not establish expenditure.",
    question: "Was the amount promised, allocated, transferred or actually spent?" },
  { slug: "delivery", category: "statements", label: statementLabels.delivery,
    explanation: "Evidence of what was provided or implemented, for whom and when. Delivery may be recorded without establishing a change in the underlying problem.",
    question: "What was delivered, to whom, and what evidence checks that delivery?" },
  { slug: "attributed-finding", category: "statements", label: statementLabels.attributed_finding,
    explanation: "A finding reported by a named source. Attribution identifies who made the assertion; it does not independently verify the assertion.",
    question: "Who reports this finding, and has it been independently examined?" },
  { slug: "evaluation", category: "statements", label: statementLabels.evaluation,
    explanation: "An identified study or assessment with its methods and limitations. Present a causal finding as that evaluation's finding; a change after a policy alone cannot establish its effect.",
    question: "How did the evaluation separate the policy's effect from other explanations?" },
  { slug: "supports", category: "evidence", label: evidenceLabels.supports,
    explanation: "The exact cited location supports the specific statement's wording. It does not automatically support a broader claim or prove that the source is independent of other references.",
    question: "Does this location establish the whole wording, including its scope and dates?" },
  { slug: "conflict", category: "evidence", label: evidenceLabels.contradicts,
    explanation: "Evidence challenges the statement or shows a material difference in definitions, periods or interpretation. Inspect the disagreement rather than counting references as votes.",
    question: "What differs, and how does that difference limit the statement?" },
  { slug: "context", category: "evidence", label: evidenceLabels.context,
    explanation: "Material that helps explain the situation without establishing the statement itself. A relevant background source is not automatically supporting evidence.",
    question: "What does this reference explain, and what does it leave unestablished?" },
  { slug: "source-reference", category: "evidence", label: "Exact source reference",
    explanation: "A particular source version and location linked to a statement. Several references may reuse one source or repeat one originating assertion; their number is not a count of independent confirmations.",
    question: "Can I locate the evidence, and do these references have a shared origin?" },
  { slug: "data-period", category: "dates", label: "Data period",
    explanation: "The time covered by an observation or statement. A newly published document can describe an older period. Unknown date precision remains unknown.",
    question: "When does this observation apply?" },
  { slug: "source-published", category: "dates", label: "Source publication date",
    explanation: "When the publisher released the material. This can differ from the date of an action, the data period and the time TerraFracta retrieved it. A missing date should remain labelled as missing.",
    question: "When was this material published, and which event or period does it describe?" },
  { slug: "retrieved", category: "dates", label: "Retrieved",
    explanation: "When a particular source version was obtained. Retrieval does not establish that the source describes current conditions or that its conclusions were newly reviewed.",
    question: "Which version was obtained, and when?" },
  { slug: "evidence-review", category: "dates", label: "Last evidence review",
    explanation: "The dossier's recorded evidence-review date. Opening or reloading the page does not conduct a new evidence review.",
    question: "When were these statements and their evidence last reviewed?" },
  { slug: "publication-revision", category: "dates", label: "Publication revision",
    explanation: "A version of the dossier. A revision number identifies a version; by itself it does not explain what changed or establish that an earlier publication remains current.",
    question: "What changed, and am I reading the current eligible publication?" },
  { slug: "observed-outcome", category: "interpretation", label: "Observed outcome",
    explanation: "A change in an indicator over a stated interval. Other events, measurement changes and population differences can affect it; the change alone does not identify a policy's causal effect.",
    question: "Are these observations comparable, and what could explain the change?" },
  { slug: "percentage-points", category: "interpretation", label: "Percent and percentage points",
    explanation: "The difference between two percentages is a percentage-point change. In an invented arithmetic example, a share rising from 10% to 12% rises by 2 percentage points and by 20% relative to the original share.",
    question: "Is the statement comparing shares directly or describing a relative change?" },
  { slug: "comparability", category: "interpretation", label: "Comparable observations",
    explanation: "Values need compatible definitions, units, populations and methods to support a comparison. A changed definition can create a break in a series rather than evidence of a trend.",
    question: "Are the denominator, coverage, units and method consistent?" },
  { slug: "missing-evidence", category: "interpretation", label: "Missing evidence and held findings",
    explanation: "An unavailable source or an unclear finding limits what can be established. A held candidate is a processing outcome; a failed collection is a coverage failure. Neither establishes government inaction.",
    question: "What was actually reviewed, what remains unknown, and which conclusion must wait?" },
] as const satisfies readonly { slug: string; category: GlossaryCategory; label: string; explanation: string; question: string }[];
export type GlossaryTermSlug = typeof glossaryTerms[number]["slug"];
export const glossaryHref = (slug?: GlossaryTermSlug) => `/methodology/glossary${slug ? `#${slug}` : ""}`;

// Only authored definitions can supply the fragment. The return remains a
// separately checked same-edition navigation selector, never a stored result.
export function glossaryDefinitionHref(slug: unknown, returnTo?: unknown): string {
  const guide = readingGuideHref(returnTo);
  return typeof slug === "string" && glossaryTerms.some(term => term.slug === slug) ? `${guide}#${slug}` : guide;
}


export function findGlossaryTerms(input: unknown, rethrow?: (error: unknown) => void) {
  let returnTo: string | null = null;
  const invalid = () => ({ kind: "invalid" as const, query: "", category: "" as GlossaryCategory | "", terms: [] as typeof glossaryTerms[number][], ...(returnTo ? { returnTo } : {}) });
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
    const values = input as Record<string, unknown>, keys = Object.keys(values);
    if (keys.some(key => !["q", "category", "returnTo"].includes(key))) return invalid();
    const returnValue = keys.includes("returnTo") ? values.returnTo : undefined;
    if (returnValue !== undefined) {
      returnTo = canonicalReadingGuideReturn(returnValue);
      if (returnTo === null) return invalid();
    }
    // Admit own enumerable selectors before observing each value once. Hidden
    // or inherited fields do not become a search or a category selection.
    const queryValue = keys.includes("q") ? values.q : undefined;
    const categoryValue = keys.includes("category") ? values.category : undefined;
    const search = searchText(queryValue === undefined ? "" : queryValue);
    const category = categoryValue === undefined ? "" : categoryValue;
    if (search.kind !== "valid" || typeof category !== "string" || (category !== "" && !Object.hasOwn(glossaryCategories, category))) return invalid();
    const words = search.query.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
    const terms = glossaryTerms.filter(term => (!category || term.category === category) && words.every(word =>
      [term.label, term.explanation, term.question].some(text => text.normalize("NFKC").toLocaleLowerCase("en").includes(word))));
    return { kind: "valid" as const, query: search.query, category: category as GlossaryCategory | "", terms, ...(returnTo ? { returnTo } : {}) };
  } catch (error) { rethrow?.(error); return invalid(); }
}
