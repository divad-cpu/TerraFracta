import { z } from "zod";
import { illustrativeDateSchema, type IllustrativeDate } from "./prototype-contract.ts";
import { canonicalProposalJson } from "./operator-proposal-capture.ts";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { scopeReferenceKey, type ScopeDraftContext } from "./issue-scope-draft.ts";
import { collectedPreparationControls } from "./preparation-control-values.ts";

// Private, unauthenticated preparation only. Reuse the existing precision
// representation without importing any illustrative content or public authority.
export const POLICY_EVENT_DRAFT_BYTES = 16_384;
export const POLICY_EVENT_DRAFT_ENTRIES = 8;
export const policyEventKinds = { announcement: "Announcement", proposal: "Proposal", adoption: "Adoption or decision",
  entry_into_force: "Entry into force", amendment: "Amendment", repeal: "Repeal or withdrawal" } as const;
export const policyEventFieldLabels = { kind: "Type of policy event", description: "Event description",
  eventDate: "When the event occurs or occurred", reportedDate: "When the cited source reported it" } as const;
export type PolicyEventField = keyof typeof policyEventFieldLabels;
const reference = z.strictObject({ claimId: z.uuid(), referenceNumber: z.number().int().min(1).max(12) });
const references = z.array(reference).min(1).max(12);
const knownDate = illustrativeDateSchema.refine(date => date.precision !== "not_supplied", "Unknown dates use a null field");
const dateField = z.strictObject({ date: knownDate, references }).nullable();
const binding = z.strictObject({ runId: z.uuid(), decisionId: z.uuid(), captureId: z.uuid(), issueId: z.uuid(),
  comparisonSha256: z.string().regex(/^[0-9a-f]{64}$/), proposalSha256: z.string().regex(/^[0-9a-f]{64}$/) });
const schema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("policy_event_preparation"), binding,
  entries: z.array(z.strictObject({ claimId: z.uuid(), fields: z.strictObject({
    kind: z.strictObject({ value: z.enum(["announcement", "proposal", "adoption", "entry_into_force", "amendment", "repeal"]), references }).nullable(),
    description: z.strictObject({ wording: z.string().trim().min(1).max(1200), references }).nullable(),
    eventDate: dateField, reportedDate: dateField,
  }) })).max(POLICY_EVENT_DRAFT_ENTRIES) });
export type PolicyEventDraft = z.infer<typeof schema>;

export function checkPolicyEventDraft(input: unknown, contextInput: unknown): PolicyEventDraft | null {
  try {
    const checked = checkedResponsibilityContext(contextInput); if (!checked) return null;
    const value = schema.parse(input);
    if (canonicalProposalJson(value.binding) !== canonicalProposalJson(checked.context.binding)) return null;
    const claims = new Map(checked.context.claims.map(claim => [claim.id, claim])), entries = new Set<string>();
    for (const entry of value.entries) {
      if (claims.get(entry.claimId)?.type !== "policy_action") return null;
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
export function policyEventDraftJson(input: unknown, context: unknown): string | null {
  const value = checkPolicyEventDraft(input, context); if (!value) return null;
  const json = JSON.stringify(value, null, 2);
  return new TextEncoder().encode(json).byteLength <= POLICY_EVENT_DRAFT_BYTES ? json : null;
}
export function reopenPolicyEventDraftJson(input: unknown, context: unknown): PolicyEventDraft | null {
  try {
    if (typeof input !== "string" || input.length > POLICY_EVENT_DRAFT_BYTES ||
        new TextEncoder().encode(input).byteLength > POLICY_EVENT_DRAFT_BYTES) return null;
    const value = checkPolicyEventDraft(JSON.parse(input), context);
    return value && policyEventDraftJson(value, context) === input ? value : null;
  } catch { return null; }
}
export function preparedEventDateLabel(date: IllustrativeDate): string {
  const checked = illustrativeDateSchema.parse(date);
  if (checked.precision === "not_supplied") return "Unknown — no date supplied";
  if (checked.precision === "period") return `${checked.label} (stated period)`;
  return `${checked.value} (${checked.precision === "day" ? "exact day" : checked.precision + " only"})`;
}

// Bounded form inspection, not a submission. No field can replace the captured
// binding; references are resolved against the same captured context.
export function policyEventDraftFromEntries(input: Iterable<unknown>, rowIds: number[], context: ScopeDraftContext): PolicyEventDraft | null {
  try {
    const checked = checkedResponsibilityContext(context);
    if (!checked || rowIds.length > POLICY_EVENT_DRAFT_ENTRIES || new Set(rowIds).size !== rowIds.length ||
        rowIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return null;
    const singles = ["claim", "kind", "description", "eventPrecision", "eventValue", "reportedPrecision", "reportedValue"];
    const known = new Set(rowIds.flatMap(id => [...singles, ...Object.keys(policyEventFieldLabels).map(key => key + "References")].map(key => `${id}.${key}`)));
    const values = new Map<string, string[]>(); let count = 0, size = 0;
    for (const pair of input) {
      if (++count > POLICY_EVENT_DRAFT_ENTRIES * (7 + 4 * 12) || !Array.isArray(pair) || pair.length !== 2 ||
          typeof pair[0] !== "string" || typeof pair[1] !== "string" || pair[1].length > POLICY_EVENT_DRAFT_BYTES || !known.has(pair[0])) return null;
      size += new TextEncoder().encode(pair[0] + pair[1]).byteLength; if (size > POLICY_EVENT_DRAFT_BYTES) return null;
      const list = values.get(pair[0]) ?? []; list.push(pair[1]); values.set(pair[0], list);
    }
    const refs = new Map(checked.context.claims.flatMap(claim => claim.evidence.map((_source, index) =>
      [scopeReferenceKey(claim.id, index + 1), { claimId: claim.id, referenceNumber: index + 1 }] as const)));
    const entries = rowIds.map(id => {
      const one = (key: string) => { const list = values.get(`${id}.${key}`); if (list?.length !== 1) throw new Error("Incomplete event control"); return list[0]; };
      const selected = (field: PolicyEventField) => (values.get(`${id}.${field}References`) ?? []).map(key => {
        const reference = refs.get(key); if (!reference) throw new Error("Unknown event reference"); return reference;
      });
      const date = (prefix: "event" | "reported", field: "eventDate" | "reportedDate") => {
        const precision = one(prefix + "Precision"), value = one(prefix + "Value");
        const references = selected(field);
        if (precision === "") { if (value !== "" || references.length) throw new Error("Unknown event date has supplied values"); return null; }
        return { date: precision === "period" ? { precision, label: value } : { precision, value }, references };
      };
      const kind = one("kind"), description = one("description");
      const kindRefs = selected("kind"), descriptionRefs = selected("description");
      if ((kind === "" && kindRefs.length) || (description === "" && descriptionRefs.length)) throw new Error("Unknown event field has references");
      return { claimId: one("claim"), fields: { kind: kind === "" ? null : { value: kind, references: kindRefs },
        description: description === "" ? null : { wording: description, references: descriptionRefs },
        eventDate: date("event", "eventDate"), reportedDate: date("reported", "reportedDate") } };
    });
    return checkPolicyEventDraft({ schemaVersion: 1, kind: "policy_event_preparation", binding: checked.context.binding, entries }, checked.context);
  } catch { return null; }
}

export const policyEventCorrectionFields = ["kind", "description"] as const;
export type PolicyEventCorrectionField = typeof policyEventCorrectionFields[number];
export type PolicyEventFieldFeedback = Record<string, {
  statement: boolean; fields: Record<PolicyEventCorrectionField, { value: boolean; references: boolean }>;
}>;

// Fixed hints only. Original schemas and draft codecs remain the authority;
// valid wording and an exact reference never establish the source's meaning.
export function policyEventDraftFeedbackFromEntries(input: unknown, rowIds: number[], contextInput: unknown): PolicyEventFieldFeedback | null {
  try {
    const collected = collectedPreparationControls(input, rowIds, contextInput, "policy_event"); if (!collected) return null;
    const { rows, values, context } = collected;
    const claims = new Map(context.claims.map(claim => [claim.id, claim]));
    const known = new Set(context.claims.flatMap(claim => claim.evidence.map((_ref, index) => scopeReferenceKey(claim.id, index + 1))));
    const result: PolicyEventFieldFeedback = {};
    for (const id of rows) {
      const statements = values.get(`${id}.claim`); if (statements?.length !== 1) return null;
      const fields = {} as PolicyEventFieldFeedback[string]["fields"];
      for (const field of policyEventCorrectionFields) {
        const supplied = values.get(`${id}.${field}`); if (supplied?.length !== 1) return null;
        const value = supplied[0], references = values.get(`${id}.${field}References`) ?? [];
        const valid = field === "kind" ? schema.shape.entries.element.shape.fields.shape.kind.unwrap().shape.value.safeParse(value).success
          : schema.shape.entries.element.shape.fields.shape[field].unwrap().shape.wording.safeParse(value).success;
        fields[field] = {
          value: value === "" ? references.length > 0 : !valid,
          references: (value !== "" && references.length === 0) || references.length > 12 ||
            new Set(references).size !== references.length || references.some(key => !known.has(key)),
        };
      }
      result[String(id)] = { statement: claims.get(statements[0])?.type !== "policy_action", fields };
    }
    return result;
  } catch { return null; }
}
