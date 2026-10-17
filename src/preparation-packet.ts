import { z } from "zod";
import { canonicalProposalJson } from "./operator-proposal-capture.ts";
import { checkedResponsibilityContext, reopenResponsibilityDraftJson } from "./responsibility-draft.ts";
import { reopenScopeDraftJson } from "./issue-scope-draft.ts";
import { reopenPolicyEventDraftJson } from "./policy-event-draft.ts";
import { reopenFundingDraftJson } from "./funding-draft.ts";
import { reopenIndicatorDraftJson } from "./indicator-draft.ts";
import { reopenDeliveryDraftJson } from "./delivery-draft.ts";

// A private, editable handoff envelope. Exact copied parts remain in their
// existing formats; this neither merges claims nor creates review authority.
export const PREPARATION_PACKET_BYTES = 131_072;
export const preparationPacketLabels = {
  scope: "Dossier scope", responsibility: "Responsibility", policyEvents: "Policy events",
  funding: "Funding", indicators: "Indicators", delivery: "Delivery",
} as const;
export type PreparationPart = keyof typeof preparationPacketLabels;
export const preparationPacketTargets: Record<PreparationPart, string> = {
  scope: "proposal-scope-preparation", responsibility: "proposal-responsibility-preparation", policyEvents: "proposal-policy-event-preparation",
  funding: "proposal-funding-preparation", indicators: "proposal-indicator-preparation", delivery: "proposal-delivery-preparation",
};
const text = z.string().max(16_384).nullable();
const partsSchema = z.strictObject({ scope: text, responsibility: text, policyEvents: text, funding: text, indicators: text, delivery: text });
const binding = z.strictObject({ runId: z.uuid(), decisionId: z.uuid(), captureId: z.uuid(), issueId: z.uuid(),
  comparisonSha256: z.string().regex(/^[0-9a-f]{64}$/), proposalSha256: z.string().regex(/^[0-9a-f]{64}$/) });
const schema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("editorial_preparation_packet"), binding, preparations: partsSchema });
export type PreparationPacket = z.infer<typeof schema>;
const readers = { scope: reopenScopeDraftJson, responsibility: reopenResponsibilityDraftJson, policyEvents: reopenPolicyEventDraftJson,
  funding: reopenFundingDraftJson, indicators: reopenIndicatorDraftJson, delivery: reopenDeliveryDraftJson };

export function checkPreparationPacket(input: unknown, contextInput: unknown): PreparationPacket | null {
  try {
    const checked = checkedResponsibilityContext(contextInput); if (!checked) return null;
    const value = schema.parse(input);
    if (canonicalProposalJson(value.binding) !== canonicalProposalJson(checked.context.binding)) return null;
    let supplied = false;
    for (const name of Object.keys(preparationPacketLabels) as PreparationPart[]) {
      const part = value.preparations[name]; if (part === null) continue;
      supplied = true; if (readers[name](part, checked.context) === null) return null;
    }
    return supplied ? value : null;
  } catch { return null; }
}

export function preparationPacketFromParts(input: unknown, contextInput: unknown): PreparationPacket | null {
  try {
    const checked = checkedResponsibilityContext(contextInput); if (!checked) return null;
    const preparations = partsSchema.parse(input);
    return checkPreparationPacket({ schemaVersion: 1, kind: "editorial_preparation_packet", binding: checked.context.binding, preparations }, checked.context);
  } catch { return null; }
}

export function preparationPacketJson(input: unknown, context: unknown): string | null {
  const value = checkPreparationPacket(input, context); if (!value) return null;
  const json = JSON.stringify(value, null, 2);
  return new TextEncoder().encode(json).byteLength <= PREPARATION_PACKET_BYTES ? json : null;
}

export function reopenPreparationPacketJson(input: unknown, context: unknown): PreparationPacket | null {
  try {
    if (typeof input !== "string" || input.length > PREPARATION_PACKET_BYTES || new TextEncoder().encode(input).byteLength > PREPARATION_PACKET_BYTES) return null;
    const value = checkPreparationPacket(JSON.parse(input), context);
    return value && preparationPacketJson(value, context) === input ? value : null;
  } catch { return null; }
}

export type PreparationPacketRow = {
  part: PreparationPart; status: "not_supplied" | "empty" | "supplied";
  entries: number; suppliedFields: number; unknownFields: number;
};
// Counts describe editing material, never completion of factual/editorial,
// rights, access, independent-review, operational or publication requirements.
export function inspectPreparationPacket(input: unknown, contextInput: unknown): PreparationPacketRow[] | null {
  const checked = checkedResponsibilityContext(contextInput); if (!checked) return null;
  const packet = checkPreparationPacket(input, checked.context); if (!packet) return null;
  return (Object.keys(preparationPacketLabels) as PreparationPart[]).map(part => {
    const text = packet.preparations[part];
    if (text === null) return { part, status: "not_supplied", entries: 0, suppliedFields: 0, unknownFields: 0 };
    const draft = readers[part](text, checked.context)!;
    const entries = "entries" in draft ? draft.entries : [{ fields: draft.fields }];
    const fields = entries.flatMap(entry => Object.values(entry.fields)), suppliedFields = fields.filter(field => field !== null).length;
    return { part, status: entries.length === 0 ? "empty" : "supplied", entries: entries.length,
      suppliedFields, unknownFields: fields.length - suppliedFields };
  });
}

export type PreparationPacketFeedback = {
  invalidParts: Record<PreparationPart, boolean>; missing: boolean; oversized: boolean;
};
// Manual editing hints only; keep saved-packet/File reopening opaque. Original
// readers decide each format/binding. No supplied bytes are repaired or moved.
export function preparationPacketFeedbackFromParts(input: unknown, contextInput: unknown): PreparationPacketFeedback | null {
  try {
    const checked = checkedResponsibilityContext(contextInput);
    if (!checked || input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const names = Object.keys(preparationPacketLabels) as PreparationPart[], keys = Object.keys(input);
    if (keys.length !== names.length || keys.some(key => !names.includes(key as PreparationPart))) return null;
    const parts = {} as PreparationPacket["preparations"], invalidParts = {} as Record<PreparationPart, boolean>;
    let supplied = 0;
    for (const name of names) {
      const value = (input as Record<string, unknown>)[name]; if (value !== null && typeof value !== "string") return null;
      parts[name] = value;
      if (value === null) { invalidParts[name] = false; continue; }
      supplied++;
      invalidParts[name] = value.length > 16_384 || new TextEncoder().encode(value).byteLength > 16_384 || readers[name](value, checked.context) === null;
    }
    const hint = { invalidParts, missing: supplied === 0, oversized: false };
    if (hint.missing || Object.values(invalidParts).some(Boolean)) return hint;
    const candidate = preparationPacketFromParts(parts, checked.context); if (!candidate) return null;
    if (preparationPacketJson(candidate, checked.context) === null) {
      // A null codec result alone is not evidence of a size failure. Confirm
      // the original exact encoding exceeds the outer byte limit explicitly.
      const json = JSON.stringify(candidate, null, 2);
      if (typeof json !== "string" || new TextEncoder().encode(json).byteLength <= PREPARATION_PACKET_BYTES) return null;
      hint.oversized = true;
    }
    return hint;
  } catch { return null; }
}
