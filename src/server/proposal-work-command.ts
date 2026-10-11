import { z } from "zod";
import { operatorAuditChoiceIdSchema as uuid } from "../operator-audit-choices.ts";
import { prepareProposalCaptureCommand, recoverProposalCaptureCommand, verifyProposalCaptureReceipt,
  type PreparedProposalCapture } from "./proposal-capture-command.ts";

// Pure preparation for a future trusted worker. Database authorization and
// current lease checks remain mandatory; these identifiers are not credentials.
export const WORK_PROPOSAL_CAPTURE_SQL = `SELECT terra_private.capture_held_proposal_for_work(
 $1::uuid,$2::text,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::text)::text AS capture`;
const workUuid = uuid.refine(v => v[14] === "4");
const workSchema = z.strictObject({ runId: workUuid,
  requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/), workClaimId: workUuid });
export type PreparedWorkProposalCapture = Readonly<{
  work: Readonly<z.infer<typeof workSchema>>; capture: PreparedProposalCapture;
  values: readonly (string | null)[];
}>;
function bind(work: unknown, capture: PreparedProposalCapture): PreparedWorkProposalCapture {
  const w = Object.freeze(workSchema.parse(work));
  if (w.runId !== capture.selection.runId) throw Error("proposal_capture_unavailable");
  const s = capture.selection;
  return Object.freeze({ work: w, capture, values: Object.freeze([w.runId, w.requestFingerprint,
    w.workClaimId, s.captureId, s.decisionId, s.issueId, s.basePublicationId, capture.values[5]!]) });
}
export function prepareWorkProposalCapture(work: unknown, selection: unknown, payload: unknown): PreparedWorkProposalCapture {
  return bind(work, prepareProposalCaptureCommand(selection, payload));
}
export function recoverWorkProposalCapture(work: unknown, selection: unknown, report: unknown): PreparedWorkProposalCapture {
  return bind(work, recoverProposalCaptureCommand(selection, report));
}
export function verifyWorkProposalCaptureReceipt(raw: unknown, command: PreparedWorkProposalCapture) {
  return verifyProposalCaptureReceipt(raw, command.capture);
}
