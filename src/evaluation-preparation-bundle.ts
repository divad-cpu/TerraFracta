import { z } from "zod";
import { canonicalProposalJson } from "./operator-proposal-capture.ts";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { reopenPreparationPacketJson, inspectPreparationPacket, PREPARATION_PACKET_BYTES } from "./preparation-packet.ts";
import { reopenEvaluationDraftJson, EVALUATION_DRAFT_BYTES } from "./evaluation-draft.ts";
import { copyNativeArrayBuffer } from "./native-byte-chunk.ts";

// A distinct private carrier for unchanged six-slot v1 bytes and an optional
// separately described evaluation. Never upgrade, merge or approve either part.
export const EVALUATION_BUNDLE_BYTES = 196_608;
const binding = z.strictObject({ runId: z.uuid(), decisionId: z.uuid(), captureId: z.uuid(), issueId: z.uuid(),
  comparisonSha256: z.string().regex(/^[0-9a-f]{64}$/), proposalSha256: z.string().regex(/^[0-9a-f]{64}$/) });
const parts = z.strictObject({ preparationPacket: z.string().max(PREPARATION_PACKET_BYTES).nullable(),
  evaluation: z.string().max(EVALUATION_DRAFT_BYTES).nullable() });
const schema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("editorial_evaluation_preparation_bundle"), binding, preparations: parts });
export type EvaluationPreparationBundle = z.infer<typeof schema>;
export function checkEvaluationPreparationBundle(input: unknown, contextInput: unknown): EvaluationPreparationBundle | null {
  try {
    const checked = checkedResponsibilityContext(contextInput); if (!checked) return null;
    const value = schema.parse(input), p = value.preparations;
    if (canonicalProposalJson(value.binding) !== canonicalProposalJson(checked.context.binding) ||
        (p.preparationPacket === null && p.evaluation === null)) return null;
    if (p.preparationPacket !== null && reopenPreparationPacketJson(p.preparationPacket, checked.context) === null) return null;
    if (p.evaluation !== null && reopenEvaluationDraftJson(p.evaluation, checked.context) === null) return null;
    return value;
  } catch { return null; }
}
export function evaluationPreparationBundleFromParts(input: unknown, contextInput: unknown): EvaluationPreparationBundle | null {
  try {
    const checked = checkedResponsibilityContext(contextInput); if (!checked) return null;
    return checkEvaluationPreparationBundle({ schemaVersion: 1, kind: "editorial_evaluation_preparation_bundle",
      binding: checked.context.binding, preparations: parts.parse(input) }, checked.context);
  } catch { return null; }
}
export function evaluationPreparationBundleJson(input: unknown, context: unknown): string | null {
  const value = checkEvaluationPreparationBundle(input, context); if (!value) return null;
  const raw = JSON.stringify(value, null, 2);
  return new TextEncoder().encode(raw).byteLength <= EVALUATION_BUNDLE_BYTES ? raw : null;
}
export function reopenEvaluationPreparationBundleJson(input: unknown, context: unknown): EvaluationPreparationBundle | null {
  try {
    if (typeof input !== "string" || input.length > EVALUATION_BUNDLE_BYTES || new TextEncoder().encode(input).byteLength > EVALUATION_BUNDLE_BYTES) return null;
    const value = checkEvaluationPreparationBundle(JSON.parse(input), context);
    return value && evaluationPreparationBundleJson(value, context) === input ? value : null;
  } catch { return null; }
}
export function readEvaluationPreparationBundleFile(bytes: ArrayBuffer, expectedBytes: number, context: unknown): EvaluationPreparationBundle | null {
  try {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 2 || expectedBytes > EVALUATION_BUNDLE_BYTES) return null;
    const owned = new Uint8Array(EVALUATION_BUNDLE_BYTES), size = copyNativeArrayBuffer(owned, bytes);
    if (size !== expectedBytes) return null;
    return reopenEvaluationPreparationBundleJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(owned.subarray(0, size)), context);
  } catch { return null; }
}
export function inspectEvaluationPreparationBundle(input: unknown, context: unknown) {
  try {
    const checked = checkedResponsibilityContext(context); if (!checked) return null;
    const value = checkEvaluationPreparationBundle(input, checked.context); if (!value) return null;
    const packet = value.preparations.preparationPacket;
    const legacy = packet === null ? null : inspectPreparationPacket(reopenPreparationPacketJson(packet, checked.context), checked.context);
    const evaluation = value.preparations.evaluation === null ? null : reopenEvaluationDraftJson(value.preparations.evaluation, checked.context);
    const fields = evaluation?.entries.flatMap(entry => Object.values(entry.fields)) ?? [];
    return { preparationPacket: legacy, evaluation: evaluation === null ? null : { entries: evaluation.entries.length,
      suppliedFields: fields.filter(field => field !== null).length, unknownFields: fields.filter(field => field === null).length } };
  } catch { return null; }
}
