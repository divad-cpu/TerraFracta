import { z } from "zod";
import { illustrativeDateSchema } from "./prototype-contract.ts";
import { canonicalProposalJson } from "./operator-proposal-capture.ts";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { scopeReferenceKey, type ScopeDraftContext } from "./issue-scope-draft.ts";
import { collectedPreparationControls } from "./preparation-control-values.ts";

// Private, unauthenticated source-described delivery preparation only.
// A budget, policy adoption, date or stage never infers another stage. Reuse precision
// representation without importing any illustrative content or public authority.
export const DELIVERY_DRAFT_BYTES = 16_384;
export const DELIVERY_DRAFT_ENTRIES = 8;
export const deliveryStages = { not_started: "Not started", pilot: "Pilot", partial: "Partial delivery", operating: "Operating",
  paused: "Paused", completed: "Completed", cancelled: "Cancelled" } as const;
export const deliveryFieldLabels = { stage: "Source-described delivery stage", description: "Delivery description", coverage: "Documented delivery coverage or scope",
  eventDate: "When the event occurs or occurred", reportedDate: "When the cited source reported it" } as const;
export type DeliveryField = keyof typeof deliveryFieldLabels;
const reference = z.strictObject({ claimId: z.uuid(), referenceNumber: z.number().int().min(1).max(12) });
const references = z.array(reference).min(1).max(12);
const knownDate = illustrativeDateSchema.refine(date => date.precision !== "not_supplied", "Unknown dates use a null field");
const dateField = z.strictObject({ date: knownDate, references }).nullable();
const binding = z.strictObject({ runId: z.uuid(), decisionId: z.uuid(), captureId: z.uuid(), issueId: z.uuid(),
  comparisonSha256: z.string().regex(/^[0-9a-f]{64}$/), proposalSha256: z.string().regex(/^[0-9a-f]{64}$/) });
const schema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("delivery_preparation"), binding,
  entries: z.array(z.strictObject({ claimId: z.uuid(), fields: z.strictObject({
    stage: z.strictObject({ value: z.enum(["not_started", "pilot", "partial", "operating", "paused", "completed", "cancelled"]), references }).nullable(),
    description: z.strictObject({ wording: z.string().trim().min(1).max(1200), references }).nullable(),
    coverage: z.strictObject({ wording: z.string().trim().min(1).max(1200), references }).nullable(),
    eventDate: dateField, reportedDate: dateField,
  }) })).max(DELIVERY_DRAFT_ENTRIES) });
export type DeliveryDraft = z.infer<typeof schema>;

export function checkDeliveryDraft(input: unknown, contextInput: unknown): DeliveryDraft | null {
  try {
    const checked = checkedResponsibilityContext(contextInput); if (!checked) return null;
    const value = schema.parse(input);
    if (canonicalProposalJson(value.binding) !== canonicalProposalJson(checked.context.binding)) return null;
    const claims = new Map(checked.context.claims.map(claim => [claim.id, claim])), entries = new Set<string>();
    for (const entry of value.entries) {
      if (claims.get(entry.claimId)?.type !== "delivery") return null;
      const key = canonicalProposalJson(entry); if (entries.has(key)) return null; entries.add(key);
      for (const field of Object.values(entry.fields)) {
        if (field === null) continue;
        const seen = new Set<string>();
        for (const ref of field.references) {
          const identity = scopeReferenceKey(ref.claimId, ref.referenceNumber);
          if (seen.has(identity) || !claims.get(ref.claimId)?.evidence[ref.referenceNumber - 1]) return null;
          seen.add(identity);
        }
      }
    }
    return value;
  } catch { return null; }
}
export function deliveryDraftJson(input: unknown, context: unknown): string | null {
  const value = checkDeliveryDraft(input, context); if (!value) return null;
  const json = JSON.stringify(value, null, 2);
  return new TextEncoder().encode(json).byteLength <= DELIVERY_DRAFT_BYTES ? json : null;
}
export function reopenDeliveryDraftJson(input: unknown, context: unknown): DeliveryDraft | null {
  try {
    if (typeof input !== "string" || input.length > DELIVERY_DRAFT_BYTES ||
        new TextEncoder().encode(input).byteLength > DELIVERY_DRAFT_BYTES) return null;
    const value = checkDeliveryDraft(JSON.parse(input), context);
    return value && deliveryDraftJson(value, context) === input ? value : null;
  } catch { return null; }
}
// Bounded form inspection, not a submission. No field can replace the captured
// binding; references are resolved against the same captured context.
export function deliveryDraftFromEntries(input: Iterable<unknown>, rowIds: number[], context: ScopeDraftContext): DeliveryDraft | null {
  try {
    const checked = checkedResponsibilityContext(context);
    if (!checked || rowIds.length > DELIVERY_DRAFT_ENTRIES || new Set(rowIds).size !== rowIds.length ||
        rowIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return null;
    const singles = ["claim", "stage", "description", "coverage", "eventPrecision", "eventValue", "reportedPrecision", "reportedValue"];
    const known = new Set(rowIds.flatMap(id => [...singles, ...Object.keys(deliveryFieldLabels).map(key => key + "References")].map(key => `${id}.${key}`)));
    const values = new Map<string, string[]>(); let count = 0, size = 0;
    for (const pair of input) {
      if (++count > DELIVERY_DRAFT_ENTRIES * (8 + 5 * 12) || !Array.isArray(pair) || pair.length !== 2 ||
          typeof pair[0] !== "string" || typeof pair[1] !== "string" || pair[1].length > DELIVERY_DRAFT_BYTES || !known.has(pair[0])) return null;
      size += new TextEncoder().encode(pair[0] + pair[1]).byteLength; if (size > DELIVERY_DRAFT_BYTES) return null;
      const list = values.get(pair[0]) ?? []; list.push(pair[1]); values.set(pair[0], list);
    }
    const refs = new Map(checked.context.claims.flatMap(claim => claim.evidence.map((_source, index) =>
      [scopeReferenceKey(claim.id, index + 1), { claimId: claim.id, referenceNumber: index + 1 }] as const)));
    const entries = rowIds.map(id => {
      const one = (key: string) => { const list = values.get(`${id}.${key}`); if (list?.length !== 1) throw new Error("Incomplete delivery control"); return list[0]; };
      const selected = (field: DeliveryField) => (values.get(`${id}.${field}References`) ?? []).map(key => {
        const reference = refs.get(key); if (!reference) throw new Error("Unknown delivery reference"); return reference;
      });
      const date = (prefix: "event" | "reported", field: "eventDate" | "reportedDate") => {
        const precision = one(prefix + "Precision"), value = one(prefix + "Value");
        const references = selected(field);
        if (precision === "") { if (value !== "" || references.length) throw new Error("Unknown delivery date has supplied values"); return null; }
        return { date: precision === "period" ? { precision, label: value } : { precision, value }, references };
      };
      const stage = one("stage"), description = one("description"), coverage = one("coverage");
      const stageRefs = selected("stage"), descriptionRefs = selected("description"), coverageRefs = selected("coverage");
      if ((stage === "" && stageRefs.length) || (description === "" && descriptionRefs.length) || (coverage === "" && coverageRefs.length)) throw new Error("Unknown delivery field has references");
      return { claimId: one("claim"), fields: { stage: stage === "" ? null : { value: stage, references: stageRefs },
        description: description === "" ? null : { wording: description, references: descriptionRefs },
        coverage: coverage === "" ? null : { wording: coverage, references: coverageRefs },
        eventDate: date("event", "eventDate"), reportedDate: date("reported", "reportedDate") } };
    });
    return checkDeliveryDraft({ schemaVersion: 1, kind: "delivery_preparation", binding: checked.context.binding, entries }, checked.context);
  } catch { return null; }
}

export const deliveryCorrectionFields = ["stage", "description", "coverage"] as const;
export type DeliveryCorrectionField = typeof deliveryCorrectionFields[number];
export type DeliveryFieldFeedback = Record<string, {
  statement: boolean; fields: Record<DeliveryCorrectionField, { value: boolean; references: boolean }>;
}>;

// Fixed hints only. Original schemas and draft codecs remain the authority;
// valid wording and an exact reference never establish the source's meaning.
export function deliveryDraftFeedbackFromEntries(input: unknown, rowIds: number[], contextInput: unknown): DeliveryFieldFeedback | null {
  try {
    const collected = collectedPreparationControls(input, rowIds, contextInput, "delivery"); if (!collected) return null;
    const { rows, values, context } = collected;
    const claims = new Map(context.claims.map(claim => [claim.id, claim]));
    const known = new Set(context.claims.flatMap(claim => claim.evidence.map((_ref, index) => scopeReferenceKey(claim.id, index + 1))));
    const result: DeliveryFieldFeedback = {};
    for (const id of rows) {
      const statements = values.get(`${id}.claim`); if (statements?.length !== 1) return null;
      const fields = {} as DeliveryFieldFeedback[string]["fields"];
      for (const field of deliveryCorrectionFields) {
        const supplied = values.get(`${id}.${field}`); if (supplied?.length !== 1) return null;
        const value = supplied[0], references = values.get(`${id}.${field}References`) ?? [];
        const valid = field === "stage" ? schema.shape.entries.element.shape.fields.shape.stage.unwrap().shape.value.safeParse(value).success
          : schema.shape.entries.element.shape.fields.shape[field].unwrap().shape.wording.safeParse(value).success;
        fields[field] = {
          value: value === "" ? references.length > 0 : !valid,
          references: (value !== "" && references.length === 0) || references.length > 12 ||
            new Set(references).size !== references.length || references.some(key => !known.has(key)),
        };
      }
      result[String(id)] = { statement: claims.get(statements[0])?.type !== "delivery", fields };
    }
    return result;
  } catch { return null; }
}
