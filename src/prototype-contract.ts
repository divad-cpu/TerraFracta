import { z } from "zod";

// This contract is deliberately limited to the visible synthetic prototype.
// It cannot turn a research or publication record into reader content.
const shortText = z.string().trim().min(1).max(240);
const bodyText = z.string().trim().min(1).max(1200);

// Declared precision is retained. Missing/year/month values cannot be turned
// into a guessed day, and no stage is inferred from the clock.
export const illustrativeDateSchema = z.discriminatedUnion("precision", [
  z.strictObject({ precision: z.literal("day"), value: z.iso.date() }),
  z.strictObject({ precision: z.literal("month"), value: z.string().regex(/^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])$/) }),
  z.strictObject({ precision: z.literal("year"), value: z.string().regex(/^[1-9][0-9]{3}$/) }),
  z.strictObject({ precision: z.literal("period"), label: shortText }),
  z.strictObject({ precision: z.literal("not_supplied") }),
]);
export type IllustrativeDate = z.infer<typeof illustrativeDateSchema>;

const indicator = z.strictObject({
  value: shortText,
  label: shortText,
  period: shortText,
  source: z.null(),
});

const event = z.strictObject({
  kind: z.enum(["Policy decision", "Funding allocation", "Delivery report", "Outcome evidence"]),
  title: shortText,
  detail: bodyText,
  stage: z.enum(["planned_example", "recorded_example", "not_assessed"]),
  eventDate: illustrativeDateSchema,
  reportedDate: illustrativeDateSchema,
  source: z.null(),
});

export const illustrativeIssueSchema = z.strictObject({
  contentKind: z.literal("synthetic_local_example"),
  reviewState: z.literal("not_reviewed"),
  country: z.literal("Norway"),
  title: shortText,
  slug: z.literal("housing-costs"),
  summary: bodyText,
  brief: z.strictObject({ problem: bodyText, response: bodyText, outcomes: bodyText }),
  scope: z.strictObject({
    population: bodyText, geography: bodyText, definition: bodyText,
    denominator: bodyText, observationPeriods: bodyText,
    selectionRationale: bodyText, searchScope: bodyText,
  }),
  indicators: z.array(indicator).min(1).max(4),
  timeline: z.array(event).min(1).max(8),
});

export type IllustrativeIssue = z.infer<typeof illustrativeIssueSchema>;

export function parseIllustrativeIssue(input: unknown): IllustrativeIssue {
  return illustrativeIssueSchema.parse(input);
}
