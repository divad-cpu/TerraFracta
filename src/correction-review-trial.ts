import { z } from "zod";
const states = z.strictObject({ new: z.number().int().min(0).max(2), in_review: z.number().int().min(0).max(1), closed: z.number().int().min(0).max(1) });
const edition = (revision: 1 | 2) => z.strictObject({ revision: z.literal(revision), privateReports: z.literal(2), states });
const snapshot = z.strictObject({
  schemaVersion: z.literal(1), evidenceKind: z.literal("saved_invented_correction_private_review"), recordedAt: z.iso.datetime({ offset: true }),
  liveStatus: z.literal(false), privateReports: z.literal(4), reviewEvents: z.literal(3), states,
  editions: z.tuple([edition(1), edition(2)]), duplicateRequestsRefusedOrReplayed: z.literal(true),
  historicalEventReplayPreservedClosedState: z.literal(true), eventsAppendOnly: z.literal(true),
  sourceRequests: z.literal(0), modelCalls: z.literal(0), realReports: z.literal(0), contactCollected: z.literal(false),
  notificationSent: z.literal(false), publicContentChanged: z.literal(false), liveIntakeEnabled: z.literal(false), liveReviewEnabled: z.literal(false),
}).refine(value => value.states.new === 2 && value.states.in_review === 1 && value.states.closed === 1 &&
  value.editions.every(item => Object.values(item.states).reduce((sum, count) => sum + count, 0) === item.privateReports) &&
  (["new", "in_review", "closed"] as const).every(key => value.editions.reduce((sum, item) => sum + item.states[key], 0) === value.states[key]));
export function parseCorrectionReviewTrial(input: unknown) { return snapshot.parse(input); }
