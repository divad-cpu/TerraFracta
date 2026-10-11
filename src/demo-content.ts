/** Screen content for the local UI prototype. None of these values are source evidence. */
import { parseIllustrativeIssue } from "./prototype-contract.ts";

export const demoIssue = parseIllustrativeIssue({
  contentKind: "synthetic_local_example",
  reviewState: "not_reviewed",
  country: "Norway",
  title: "Housing costs and household budgets",
  slug: "housing-costs",
  summary:
    "A demonstration of how TerraFracta could separate a measured problem, a documented response, delivery, and observed outcomes.",
  brief: {
    problem: "A hypothetical household-budget measure. Every displayed figure is fabricated.",
    response: "An invented rule, allocation and delivery record. They describe no actual Norwegian measure.",
    outcomes: "No real outcome or policy effect has been assessed. Evidence remains absent.",
  },
  scope: {
    population: "Hypothetical households used to demonstrate the display; no actual survey population is supplied.",
    geography: "Norway is the page label. These examples establish no geographical finding.",
    definition: "A chosen hypothetical housing-cost threshold within a household budget; no real indicator definition has been qualified.",
    denominator: "Hypothetical households with an example budget; no respondent count or sample size is supplied.",
    observationPeriods: "Example periods A and B; no calendar coverage or fieldwork dates are supplied.",
    selectionRationale: "Chosen to exercise problem, response, funding, delivery and outcome distinctions; not a ranking of Norway's most important issues.",
    searchScope: "No real-source search has been performed for this demonstration. Missing records cannot establish that no action exists.",
  },
  indicators: [
    {
      value: "24%",
      label: "Illustrative share of households above a chosen cost threshold",
      period: "Example period A",
      source: null,
    },
    {
      value: "19%",
      label: "Illustrative share using the same hypothetical definition",
      period: "Example period B",
      source: null,
    },
  ],
  timeline: [
    {
      kind: "Policy decision",
      title: "An example eligibility rule is changed",
      detail: "This card demonstrates how a dated rule change would be described. It is not a claim about an actual Norwegian measure.",
      stage: "planned_example",
      eventDate: { precision: "year", value: "2030" },
      reportedDate: { precision: "day", value: "2026-09-08" },
      source: null,
    },
    {
      kind: "Funding allocation",
      title: "An example budget allocates funding",
      detail: "An allocation would be shown separately from actual spending. This invented entry establishes neither money spent nor households helped.",
      stage: "recorded_example",
      eventDate: { precision: "month", value: "2026-08" },
      reportedDate: { precision: "day", value: "2026-09-10" },
      source: null,
    },
    {
      kind: "Delivery report",
      title: "An example agency reports applications processed",
      detail: "A delivery count would be shown separately from the number of households helped and any measured outcome.",
      stage: "recorded_example",
      eventDate: { precision: "period", label: "Example delivery period" },
      reportedDate: { precision: "not_supplied" },
      source: null,
    },
    {
      kind: "Outcome evidence",
      title: "No verified causal conclusion in this demonstration",
      detail: "A change in an indicator alone would not establish that the example policy caused it.",
      stage: "not_assessed",
      eventDate: { precision: "not_supplied" },
      reportedDate: { precision: "not_supplied" },
      source: null,
    },
  ],
});
