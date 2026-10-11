import { z } from "zod";
import { interpretPublicReadCandidate } from "./public-read-outcome.ts";
import type { PublicIssueProjection } from "./public-issue-projection.ts";
import { compareRecordedInstants } from "./recorded-instant-order.ts";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const expectationSchema = z.object({
  publicationId: z.uuid(), decisionId: z.uuid(), runId: z.uuid(),
  requestFingerprint: hash, publicationSha256: hash,
}).strict();
const resultSchema = expectationSchema.extend({
  schemaVersion: z.literal(1), status: z.enum(["activated", "already_activated"]),
  activatedAt: z.iso.datetime({ offset: true }), visibilityState: z.literal("pending"),
  currentHeadMatches: z.boolean(), candidate: z.unknown(),
}).strict();
const selectedConditionSchema = z.object({
  claims: z.array(z.unknown()).length(1), sources: z.array(z.unknown()).length(1),
  citations: z.array(z.object({
    publication_id: z.uuid(),
    machine_binding: z.object({ decisionId: z.uuid(), disposition: z.literal("eligible") }).passthrough(),
  }).passthrough()).length(1),
}).passthrough();

export type ActivationExpectation = z.infer<typeof expectationSchema>;
export type CheckedMachineActivation =
  | { kind: "candidate"; status: "activated"; visibilityState: "pending"; issue: PublicIssueProjection }
  | { kind: "receipt"; status: "already_activated"; visibilityState: "pending"; currentHeadMatches: boolean };

// The driver owns the SQL transaction and must rollback on rejection. A parsed
// result authenticates no actor and proves neither COMMIT nor public visibility.
export function checkMachineActivationResult(
  input: unknown, expectedInput: ActivationExpectation, observedAt: Date,
): CheckedMachineActivation {
  try {
    const expected = expectationSchema.parse(expectedInput);
    const result = resultSchema.parse(input);
    if (!Number.isFinite(observedAt.getTime()) ||
        compareRecordedInstants(result.activatedAt, observedAt.toISOString()) > 0 ||
        Object.entries(expected).some(([key, value]) =>
          result[key as keyof ActivationExpectation] !== value)) {
      throw new Error();
    }
    if (result.status === "already_activated") {
      if (result.candidate !== null) throw new Error();
      return { kind: "receipt", status: "already_activated", visibilityState: "pending",
        currentHeadMatches: result.currentHeadMatches };
    }
    if (!result.currentHeadMatches) throw new Error();
    const selected = selectedConditionSchema.parse(result.candidate);
    if (selected.citations[0].publication_id !== result.publicationId ||
        selected.citations[0].machine_binding.decisionId !== result.decisionId) throw new Error();
    const outcome = interpretPublicReadCandidate(result.candidate);
    if (outcome.kind !== "issue" || outcome.issue.publicationId !== result.publicationId ||
        outcome.issue.claims.length !== 1 || outcome.issue.claims[0].type !== "condition" ||
        outcome.issue.claims[0].evidence.length !== 1) {
      throw new Error();
    }
    return { kind: "candidate", status: "activated", visibilityState: "pending", issue: outcome.issue };
  } catch {
    throw new Error("Activation receipt is inconsistent");
  }
}
