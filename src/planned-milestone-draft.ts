import { z } from "zod";
import { illustrativeDateSchema } from "./prototype-contract.ts";
import { canonicalProposalJson } from "./operator-proposal-capture.ts";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { scopeReferenceKey, type ScopeDraftContext } from "./issue-scope-draft.ts";
import { copyNativeArrayBuffer } from "./native-byte-chunk.ts";

// Private source-described targets only. References preserve original captured
// occurrences; this preparation grants no review or publication authority.
export const PLANNED_MILESTONE_DRAFT_BYTES = 16_384;
export const PLANNED_MILESTONE_DRAFT_ENTRIES = 8;
export const plannedMilestoneDraftFieldLabels = {
  description: "Source-described planned milestone", targetDate: "Source-described target date or period",
  institution: "Source-described responsible institution", reportedDate: "When the cited source reported it",
} as const;
export type PlannedMilestoneDraftField = keyof typeof plannedMilestoneDraftFieldLabels;
const reference = z.strictObject({ claimId: z.uuid(), referenceNumber: z.number().int().min(1).max(12) });
const references = z.array(reference).min(1).max(12);
const wordField = z.strictObject({ wording: z.string().trim().min(1).max(1200), references });
const knownDate = illustrativeDateSchema.refine(date => date.precision !== "not_supplied", "Unknown dates use null");
const dateField = z.strictObject({ date: knownDate, references }).nullable();
const binding = z.strictObject({ runId: z.uuid(), decisionId: z.uuid(), captureId: z.uuid(), issueId: z.uuid(),
  comparisonSha256: z.string().regex(/^[a-f0-9]{64}$/), proposalSha256: z.string().regex(/^[a-f0-9]{64}$/) });
const schema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("planned_milestone_preparation"), binding,
  entries: z.array(z.strictObject({ claimId: z.uuid(), fields: z.strictObject({
    description: wordField, targetDate: dateField, institution: wordField.nullable(), reportedDate: dateField,
  }) })).max(PLANNED_MILESTONE_DRAFT_ENTRIES) });
export type PlannedMilestoneDraft = z.infer<typeof schema>;
export function checkPlannedMilestoneDraft(input: unknown, contextInput: unknown): PlannedMilestoneDraft | null {
  try {
    const checked = checkedResponsibilityContext(contextInput); if (!checked) return null;
    const value = schema.parse(input);
    if (canonicalProposalJson(value.binding) !== canonicalProposalJson(checked.context.binding)) return null;
    const claims = new Map(checked.context.claims.map(claim => [claim.id, claim])), entries = new Set<string>();
    for (const entry of value.entries) {
      const type = claims.get(entry.claimId)?.type;
      if (type !== "policy_action" && type !== "delivery") return null;
      const key = canonicalProposalJson(entry); if (entries.has(key)) return null; entries.add(key);
      for (const field of Object.values(entry.fields)) {
        if (field === null) continue;
        const seen = new Set<string>();
        for (const ref of field.references) {
          const key = scopeReferenceKey(ref.claimId, ref.referenceNumber);
          if (seen.has(key) || !claims.get(ref.claimId)?.evidence[ref.referenceNumber - 1]) return null;
          seen.add(key);
        }
      }
    }
    return value;
  } catch { return null; }
}
export function plannedMilestoneDraftJson(input: unknown, context: unknown): string | null {
  const value = checkPlannedMilestoneDraft(input, context); if (!value) return null;
  const json = JSON.stringify(value, null, 2);
  return new TextEncoder().encode(json).byteLength <= PLANNED_MILESTONE_DRAFT_BYTES ? json : null;
}
export function reopenPlannedMilestoneDraftJson(input: unknown, context: unknown): PlannedMilestoneDraft | null {
  try {
    if (typeof input !== "string" || input.length > PLANNED_MILESTONE_DRAFT_BYTES ||
        new TextEncoder().encode(input).byteLength > PLANNED_MILESTONE_DRAFT_BYTES) return null;
    const value = checkPlannedMilestoneDraft(JSON.parse(input), context);
    return value && plannedMilestoneDraftJson(value, context) === input ? value : null;
  } catch { return null; }
}
export function readPlannedMilestoneDraftFile(bytes: ArrayBuffer, expectedBytes: number, context: unknown): PlannedMilestoneDraft | null {
  try {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 2 || expectedBytes > PLANNED_MILESTONE_DRAFT_BYTES) return null;
    const owned = new Uint8Array(PLANNED_MILESTONE_DRAFT_BYTES), size = copyNativeArrayBuffer(owned, bytes);
    if (size !== expectedBytes) return null;
    return reopenPlannedMilestoneDraftJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(owned.subarray(0, size)), context);
  } catch { return null; }
}
// Exact native form names; no control can supply or replace the captured binding.
export function plannedMilestoneDraftFromEntries(input: Iterable<unknown>, rowIds: number[], context: ScopeDraftContext): PlannedMilestoneDraft | null {
  try {
    const checked = checkedResponsibilityContext(context);
    if (!checked || rowIds.length > PLANNED_MILESTONE_DRAFT_ENTRIES || new Set(rowIds).size !== rowIds.length ||
        rowIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return null;
    const fields = Object.keys(plannedMilestoneDraftFieldLabels) as PlannedMilestoneDraftField[];
    const singles = ["claim", "description", "institution", "targetPrecision", "targetValue", "reportedPrecision", "reportedValue"];
    const known = new Set(rowIds.flatMap(id => [...singles, ...fields.map(key => key + "References")].map(key => `${id}.${key}`)));
    const values = new Map<string, string[]>(); let count = 0, size = 0;
    for (const pair of input) {
      if (++count > PLANNED_MILESTONE_DRAFT_ENTRIES * (7 + 4 * 12) || !Array.isArray(pair) || pair.length !== 2 ||
          typeof pair[0] !== "string" || typeof pair[1] !== "string" || pair[1].length > PLANNED_MILESTONE_DRAFT_BYTES || !known.has(pair[0])) return null;
      size += new TextEncoder().encode(pair[0] + pair[1]).byteLength; if (size > PLANNED_MILESTONE_DRAFT_BYTES) return null;
      const list = values.get(pair[0]) ?? []; list.push(pair[1]); values.set(pair[0], list);
    }
    const refs = new Map(checked.context.claims.flatMap(claim => claim.evidence.map((_ref, index) =>
      [scopeReferenceKey(claim.id, index + 1), { claimId: claim.id, referenceNumber: index + 1 }] as const)));
    const entries = rowIds.map(id => {
      const one = (key: string) => { const list = values.get(`${id}.${key}`); if (list?.length !== 1) throw Error(); return list[0]; };
      const selected = (field: PlannedMilestoneDraftField) => (values.get(`${id}.${field}References`) ?? []).map(key => {
        const ref = refs.get(key); if (!ref) throw Error(); return ref;
      });
      const date = (prefix: "target" | "reported", field: "targetDate" | "reportedDate") => {
        const precision = one(prefix + "Precision"), value = one(prefix + "Value"), references = selected(field);
        if (precision === "") { if (value !== "" || references.length) throw Error(); return null; }
        return { date: precision === "period" ? { precision, label: value } : { precision, value }, references };
      };
      const description = one("description"), institution = one("institution"), institutionRefs = selected("institution");
      if (institution === "" && institutionRefs.length) throw Error();
      return { claimId: one("claim"), fields: {
        description: { wording: description, references: selected("description") }, targetDate: date("target", "targetDate"),
        institution: institution === "" ? null : { wording: institution, references: institutionRefs }, reportedDate: date("reported", "reportedDate"),
      } };
    });
    return checkPlannedMilestoneDraft({ schemaVersion: 1, kind: "planned_milestone_preparation", binding: checked.context.binding, entries }, checked.context);
  } catch { return null; }
}
