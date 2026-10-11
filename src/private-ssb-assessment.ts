import { z } from "zod";

const year = <Y extends number>(value: Y) => z.strictObject({ year: z.literal(value), state: z.literal("held") });
const snapshot = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("saved_invented_private_ssb_assessment"),
  recordedAt: z.iso.datetime({ offset: true }), liveStatus: z.literal(false), pairStatus: z.literal("pending"),
  retainedPairMatched: z.literal(true), candidates: z.tuple([year(2024), year(2025)]),
  unresolvedMeanings: z.tuple([z.literal("respondent_count_unit"), z.literal("fieldwork_period"), z.literal("upper_band_boundary")]),
  numericCellsIncluded: z.literal(false), sourceRequests: z.literal(0), modelCalls: z.literal(0),
  publicQualificationIssued: z.literal(false), checkpointAdvanced: z.literal(false), publicationEnabled: z.literal(false),
});

export function parsePrivateSSBAssessment(input: unknown) { return snapshot.parse(input); }
