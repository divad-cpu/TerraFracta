import { z } from "zod";
import { checkCorrectionDraft, correctionTargetSchema, correctionDraftFieldsSchema } from "./correction-target.ts";
import type { PublicReadOutcome } from "./public-read-outcome.ts";

// A request identity is private retry coordination, not proof of delivery or
// current publication eligibility. No network or storage; the caller owns
// identity generation, optionally supplied lazily for a changed intent.
export const correctionRequestSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: z.uuid().regex(/^[0-9a-f-]+$/),
  draft: z.strictObject({ target: correctionTargetSchema, fields: correctionDraftFieldsSchema }),
});
export type CorrectionRequest = z.infer<typeof correctionRequestSchema>;
export type CorrectionRequestOutcome =
  | { kind: "prepared"; request: CorrectionRequest; reused: boolean }
  | { kind: "held"; reason: "unavailable" | "invalid_target" | "changed" | "invalid_fields" | "invalid_request" };

export function checkCorrectionRequest(current: PublicReadOutcome, input: unknown): CorrectionRequestOutcome {
  const parsed = correctionRequestSchema.safeParse(input);
  if (!parsed.success) return { kind: "held", reason: "invalid_request" };
  const checked = checkCorrectionDraft(current, parsed.data.draft);
  if (checked.kind === "held") return checked;
  return { kind: "prepared", reused: false, request: { schemaVersion: 1, requestId: parsed.data.requestId,
    draft: { target: checked.draft.target, fields: checked.draft.fields } } };
}

// The caller supplies a fresh identity for a changed intent. A same-content
// retry retains its identity; changing an edition, claim or field does not.
// The connected editor uses this only in memory; no real intake or persistence.
export function prepareCorrectionRequest(current: PublicReadOutcome, draft: unknown,
  freshRequestId: string | (() => string), previous: unknown = null): CorrectionRequestOutcome {
  if (typeof freshRequestId === "function") {
    const prior = checkCorrectionRequest(current, previous);
    if (prior.kind === "prepared") {
      const repeated = checkCorrectionRequest(current, { schemaVersion: 1, requestId: prior.request.requestId, draft });
      if (repeated.kind === "held") return repeated;
      if (JSON.stringify(prior.request.draft) === JSON.stringify(repeated.request.draft)) {
        return { kind: "prepared", reused: true, request: prior.request };
      }
    }
    freshRequestId = freshRequestId();
  }
  const next = checkCorrectionRequest(current, { schemaVersion: 1, requestId: freshRequestId, draft });
  if (next.kind === "held") return next;
  const prior = checkCorrectionRequest(current, previous);
  if (prior.kind === "prepared" && JSON.stringify(prior.request.draft) === JSON.stringify(next.request.draft)) {
    return { kind: "prepared", reused: true, request: prior.request };
  }
  const previousEnvelope = correctionRequestSchema.safeParse(previous);
  if (previousEnvelope.success && previousEnvelope.data.requestId === next.request.requestId) {
    return { kind: "held", reason: "invalid_request" };
  }
  return next;
}

export const correctionRequestReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1), status: z.literal("recorded_private"), requestId: z.uuid(),
  reportId: z.uuid(), publicationId: z.uuid(), revision: z.number().int().positive().safe(), replayed: z.boolean(),
});
export function parseCorrectionRequestReceipt(input: unknown, request: CorrectionRequest) {
  const checkedRequest = correctionRequestSchema.parse(request);
  const receipt = correctionRequestReceiptSchema.parse(input);
  if (receipt.requestId !== checkedRequest.requestId || receipt.publicationId !== checkedRequest.draft.target.publicationId ||
      receipt.revision !== checkedRequest.draft.target.revision) throw new Error("Correction receipt identity differs");
  return receipt;
}
