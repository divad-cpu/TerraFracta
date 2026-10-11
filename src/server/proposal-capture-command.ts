import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { z } from "zod";
import { Buffer } from "node:buffer";
import { operatorAuditChoiceIdSchema as uuid } from "../operator-audit-choices.ts";
import { proposalMicros } from "../operator-proposal-capture.ts";
import { encodeProposalCapture, decodeProposalCapture, parseCapturedProposalEnvelope } from "./proposal-capture.ts";

// Trusted backend command preparation only. No connection, writer grant,
// public API, runtime selector, source interpretation or automatic invocation.
export const PROPOSAL_CAPTURE_SQL = `SELECT terra_private.capture_held_proposal(
 $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text)::text AS capture`;
export const proposalCaptureSelectionSchema = z.strictObject({
  captureId: uuid, runId: uuid, decisionId: uuid, issueId: uuid, basePublicationId: uuid.nullable(),
});
export type PreparedProposalCapture = Readonly<{
  selection: Readonly<z.infer<typeof proposalCaptureSelectionSchema>>;
  proposalSha256: string; values: readonly (string | null)[];
}>;
export function prepareProposalCaptureCommand(selection: unknown, payload: unknown): PreparedProposalCapture {
  const s = Object.freeze(proposalCaptureSelectionSchema.parse(selection));
  const encoded = encodeProposalCapture(payload);
  return Object.freeze({ selection: s, proposalSha256: encoded.proposalSha256,
    values: Object.freeze([s.captureId, s.runId, s.decisionId, s.issueId, s.basePublicationId, encoded.proposalJson]) });
}
const recoverySelection = z.strictObject({ runId: uuid, decisionId: uuid, issueId: uuid });
// Recover only the immutable bytes/identity from an already bounded private read.
// No regenerated wording, source interpretation, lease/account authentication,
// retry, write or publication eligibility is supplied by this pure preparation.
export function recoverProposalCaptureCommand(selection: unknown, report: unknown): PreparedProposalCapture {
  const expected = recoverySelection.parse(selection), stored = parseCapturedProposalEnvelope(report);
  if (stored.status !== "ok" || stored.requested.runId !== expected.runId ||
      stored.requested.decisionId !== expected.decisionId || stored.target.issueId !== expected.issueId) {
    throw Error("proposal_capture_unavailable");
  }
  const payload = decodeProposalCapture(stored.capture.proposalJson, stored.capture.proposalSha256);
  const command = prepareProposalCaptureCommand({ ...expected, captureId: stored.capture.captureId,
    basePublicationId: stored.capture.basePublicationId }, payload);
  if (command.values[5] !== stored.capture.proposalJson || command.proposalSha256 !== stored.capture.proposalSha256) {
    throw Error("proposal_capture_unavailable");
  }
  return command;
}
const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(v => !v.startsWith("0000-"));
const receipt = proposalCaptureSelectionSchema.extend({ schemaVersion: z.literal(1),
  status: z.enum(["stored", "replayed"]), proposalSha256: z.string().regex(/^[0-9a-f]{64}$/),
  capturedAt: instant, observedAt: instant });
export type ProposalCaptureReceipt = z.infer<typeof receipt>;
export function verifyProposalCaptureReceipt(raw: unknown, command: PreparedProposalCapture): ProposalCaptureReceipt {
  const bytes = new Uint8Array(2048);
  const size = copyNativeByteChunk(bytes, 0, raw);
  if (size < 2) throw Error("proposal_capture_unavailable");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)), value = JSON.parse(text);
  // Refuse ambiguous duplicate/escaped aliases while allowing native jsonb key order.
  const pairs = text.match(/"(?:[^"\\]|\\.)*"\s*:/g) ?? [];
  const keys = pairs.map(p => JSON.parse(p.slice(0, p.lastIndexOf(":" )).trim()));
  if (new Set(keys).size !== keys.length) throw Error("proposal_capture_unavailable");
  const r = receipt.parse(value), s = command.selection;
  if (r.captureId !== s.captureId || r.runId !== s.runId || r.decisionId !== s.decisionId ||
      r.issueId !== s.issueId || r.basePublicationId !== s.basePublicationId || r.proposalSha256 !== command.proposalSha256 ||
      proposalMicros(r.capturedAt) > proposalMicros(r.observedAt) || Buffer.byteLength(text, "utf8") > 2048) throw Error("proposal_capture_unavailable");
  return r;
}
