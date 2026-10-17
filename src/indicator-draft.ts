import { z } from "zod";
import { canonicalProposalJson } from "./operator-proposal-capture.ts";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { scopeReferenceKey, type ScopeDraftContext } from "./issue-scope-draft.ts";

// Private source-described metadata and observations. Neither matching labels
// nor this structural check establishes a series identity or comparability.
export const INDICATOR_DRAFT_BYTES = 16_384;
export const INDICATOR_DRAFT_ENTRIES = 4;
export const indicatorFieldLabels = {
  sourceSeries: "Source series identifier or label", definition: "Indicator definition", definitionVersion: "Definition version",
  unit: "Unit and scale", geography: "Geographic coverage", population: "Measured population", denominator: "Denominator or base",
  adjustment: "Statistical adjustment", frequency: "Observation frequency", observationPeriod: "Observation period",
  value: "Exact signed decimal observation", missingReason: "Source-stated missing reason", vintage: "Observation revision or vintage",
} as const;
export type IndicatorField = keyof typeof indicatorFieldLabels;
export const indicatorBasisFields = ["sourceSeries", "definition", "definitionVersion", "unit", "geography", "population", "denominator", "adjustment", "frequency"] as const;
export const indicatorMissingReasons = {
  not_available: "Not available", not_applicable: "Not applicable", withheld: "Withheld",
  not_yet_released: "Not yet released", extraction_failed: "Extraction failed",
} as const;
const reference = z.strictObject({ claimId: z.uuid(), referenceNumber: z.number().int().min(1).max(12) });
const field = <T extends z.ZodType<string>>(value: T) => z.strictObject({ value, references: z.array(reference).min(1).max(12) }).nullable();
const text = z.string().trim().min(1).max(240);
const binding = z.strictObject({ runId: z.uuid(), decisionId: z.uuid(), captureId: z.uuid(), issueId: z.uuid(),
  comparisonSha256: z.string().regex(/^[0-9a-f]{64}$/), proposalSha256: z.string().regex(/^[0-9a-f]{64}$/) });
const schema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("indicator_preparation"), binding,
  entries: z.array(z.strictObject({ claimId: z.uuid(), fields: z.strictObject({
    sourceSeries: field(text), definition: field(z.string().trim().min(1).max(1200)), definitionVersion: field(text),
    unit: field(text), geography: field(text), population: field(text), denominator: field(text), adjustment: field(text), frequency: field(text),
    observationPeriod: field(text), value: field(z.string().regex(/^-?(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,9})?$/)),
    missingReason: field(z.enum(["not_available", "not_applicable", "withheld", "not_yet_released", "extraction_failed"])), vintage: field(text),
  }) })).max(INDICATOR_DRAFT_ENTRIES) });
export type IndicatorDraft = z.infer<typeof schema>;

export function checkIndicatorDraft(input: unknown, contextInput: unknown): IndicatorDraft | null {
  try {
    const checked = checkedResponsibilityContext(contextInput); if (!checked) return null;
    const value = schema.parse(input);
    if (canonicalProposalJson(value.binding) !== canonicalProposalJson(checked.context.binding)) return null;
    const claims = new Map(checked.context.claims.map(claim => [claim.id, claim])), seenEntries = new Set<string>();
    for (const entry of value.entries) {
      const type = claims.get(entry.claimId)?.type;
      if (type !== "condition" && type !== "attributed_finding") return null;
      if (entry.fields.value !== null && entry.fields.missingReason !== null) return null;
      const key = canonicalProposalJson(entry); if (seenEntries.has(key)) return null; seenEntries.add(key);
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

export function indicatorDraftJson(input: unknown, context: unknown): string | null {
  const value = checkIndicatorDraft(input, context); if (!value) return null;
  const json = JSON.stringify(value, null, 2);
  return new TextEncoder().encode(json).byteLength <= INDICATOR_DRAFT_BYTES ? json : null;
}

export function reopenIndicatorDraftJson(input: unknown, context: unknown): IndicatorDraft | null {
  try {
    if (typeof input !== "string" || input.length > INDICATOR_DRAFT_BYTES || new TextEncoder().encode(input).byteLength > INDICATOR_DRAFT_BYTES) return null;
    const value = checkIndicatorDraft(JSON.parse(input), context);
    return value && indicatorDraftJson(value, context) === input ? value : null;
  } catch { return null; }
}

type IndicatorInput = { kind: "collected"; candidate: unknown; context: ScopeDraftContext } | { kind: "too_many" } | { kind: "input_size" };
function indicatorInputFromEntries(input: Iterable<unknown>, rowIds: number[], context: ScopeDraftContext): IndicatorInput | null {
  try {
    const checked = checkedResponsibilityContext(context), fields = Object.keys(indicatorFieldLabels) as IndicatorField[];
    if (!checked) return null;
    if (rowIds.length > INDICATOR_DRAFT_ENTRIES) return { kind: "too_many" };
    if (new Set(rowIds).size !== rowIds.length || rowIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return null;
    const names = new Set(rowIds.flatMap(id => ["claim", ...fields.flatMap(field => [field, field + "References"])].map(key => `${id}.${key}`)));
    const values = new Map<string, string[]>(); let count = 0, size = 0;
    for (const pair of input) {
      if (++count > INDICATOR_DRAFT_ENTRIES * (1 + fields.length * 13) || !Array.isArray(pair) || pair.length !== 2 ||
          typeof pair[0] !== "string" || typeof pair[1] !== "string" || !names.has(pair[0])) return null;
      if (pair[1].length > INDICATOR_DRAFT_BYTES) return { kind: "input_size" };
      size += new TextEncoder().encode(pair[0] + pair[1]).byteLength; if (size > INDICATOR_DRAFT_BYTES) return { kind: "input_size" };
      const list = values.get(pair[0]) ?? []; list.push(pair[1]); values.set(pair[0], list);
    }
    const references = new Map(checked.context.claims.flatMap(claim => claim.evidence.map((_source, index) =>
      [scopeReferenceKey(claim.id, index + 1), { claimId: claim.id, referenceNumber: index + 1 }] as const)));
    const entries = rowIds.map(id => {
      const one = (key: string) => { const list = values.get(`${id}.${key}`); if (list?.length !== 1) throw new Error("Incomplete indicator control"); return list[0]; };
      return { claimId: one("claim"), fields: Object.fromEntries(fields.map(name => {
        const value = one(name), selected = (values.get(`${id}.${name}References`) ?? []).map(key => {
          const ref = references.get(key); if (!ref) throw new Error("Unknown indicator reference"); return ref;
        });
        // Keep this malformed editing combination only for fixed feedback.
        // The unchanged authoritative schema still rejects an empty value.
        return [name, value === "" && selected.length === 0 ? null : { value, references: selected }];
      })) };
    });
    return { kind: "collected", candidate: { schemaVersion: 1, kind: "indicator_preparation", binding: checked.context.binding, entries }, context: checked.context };
  } catch { return null; }
}

export function indicatorDraftFromEntries(input: Iterable<unknown>, rowIds: number[], context: ScopeDraftContext): IndicatorDraft | null {
  const collected = indicatorInputFromEntries(input, rowIds, context);
  return collected?.kind === "collected" ? checkIndicatorDraft(collected.candidate, collected.context) : null;
}

export type IndicatorEntryFeedback = {
  statement: boolean; duplicate: boolean; valueAndMissingReason: boolean;
  fields: Record<IndicatorField, { value: boolean; references: boolean }>;
};
export type IndicatorDraftFeedback = { entries: IndicatorEntryFeedback[]; tooMany: boolean; size: "input" | "copy" | null };

// Fixed editing hints from the same authoritative field schemas. This never
// changes a supplied value/reference, accepts content or proves source meaning.
export function indicatorDraftFieldFeedback(input: unknown, contextInput: unknown): IndicatorDraftFeedback | null {
  try {
    const checked = checkedResponsibilityContext(contextInput);
    if (!checked || input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const raw = input as Record<string, unknown>;
    if (Object.keys(raw).length !== 4 || Object.keys(raw).some(key => !["schemaVersion", "kind", "binding", "entries"].includes(key))) return null;
    const header = schema.omit({ entries: true }).safeParse({ schemaVersion: raw.schemaVersion, kind: raw.kind, binding: raw.binding });
    if (!header.success || canonicalProposalJson(header.data.binding) !== canonicalProposalJson(checked.context.binding) || !Array.isArray(raw.entries)) return null;
    if (raw.entries.length > INDICATOR_DRAFT_ENTRIES) return { entries: [], tooMany: true, size: null };
    const names = Object.keys(indicatorFieldLabels) as IndicatorField[], claims = new Map(checked.context.claims.map(claim => [claim.id, claim]));
    const entries: IndicatorEntryFeedback[] = [], seenEntries = new Set<string>(), entrySchema = schema.shape.entries.element;
    for (const value of raw.entries) {
      const hint: IndicatorEntryFeedback = { statement: false, duplicate: false, valueAndMissingReason: false,
        fields: Object.fromEntries(names.map(name => [name, { value: false, references: false }])) as IndicatorEntryFeedback["fields"] };
      const parsed = entrySchema.safeParse(value);
      if (!parsed.success) for (const issue of parsed.error.issues) {
        if (issue.path[0] === "claimId") hint.statement = true;
        else if (issue.path[0] === "fields" && names.includes(issue.path[1] as IndicatorField) && ["value", "references"].includes(issue.path[2] as string))
          hint.fields[issue.path[1] as IndicatorField][issue.path[2] as "value" | "references"] = true;
        else return null;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
      const entry = value as Record<string, unknown>, type = typeof entry.claimId === "string" ? claims.get(entry.claimId)?.type : null;
      if (type !== "condition" && type !== "attributed_finding") hint.statement = true;
      if (entry.fields === null || typeof entry.fields !== "object" || Array.isArray(entry.fields)) return null;
      const fields = entry.fields as Record<string, unknown>;
      if (fields.value !== null && fields.missingReason !== null) {
        hint.valueAndMissingReason = true; hint.fields.value.value = true; hint.fields.missingReason.value = true;
      }
      for (const name of names) {
        const field = fields[name]; if (field === null) continue;
        if (field === null || typeof field !== "object" || Array.isArray(field)) return null;
        const references = entrySchema.shape.fields.shape[name].unwrap().shape.references.safeParse((field as Record<string, unknown>).references);
        if (references.success) {
          const seen = new Set<string>();
          for (const ref of references.data) {
            const key = scopeReferenceKey(ref.claimId, ref.referenceNumber);
            if (seen.has(key) || !claims.get(ref.claimId)?.evidence[ref.referenceNumber - 1]) hint.fields[name].references = true;
            seen.add(key);
          }
        }
      }
      if (parsed.success) { const key = canonicalProposalJson(parsed.data); hint.duplicate = seenEntries.has(key); seenEntries.add(key); }
      entries.push(hint);
    }
    const candidate = checkIndicatorDraft(input, checked.context);
    return { entries, tooMany: false, size: candidate !== null && indicatorDraftJson(candidate, checked.context) === null ? "copy" : null };
  } catch { return null; }
}

export function indicatorDraftFeedbackFromEntries(input: Iterable<unknown>, rowIds: number[], context: ScopeDraftContext): IndicatorDraftFeedback | null {
  const collected = indicatorInputFromEntries(input, rowIds, context); if (!collected) return null;
  if (collected.kind === "too_many") return { entries: [], tooMany: true, size: null };
  if (collected.kind === "input_size") return { entries: [], tooMany: false, size: "input" };
  return indicatorDraftFieldFeedback(collected.candidate, collected.context);
}

export type IndicatorBasisRow = {
  field: typeof indicatorBasisFields[number]; values: Array<string | null>;
  coverage: "none" | "some" | "all";
  spelling: "no_text" | "one_text" | "different_text" | "same_spelling";
};
// Only compare supplied text in worksheet order. No series join, number
// comparison, chronology, calculation policy or evidence decision is returned.
export function indicatorBasisDifferences(input: unknown, context: unknown): IndicatorBasisRow[] | null {
  const draft = checkIndicatorDraft(input, context); if (!draft) return null;
  return indicatorBasisFields.map(field => {
    const values = draft.entries.map(entry => entry.fields[field]?.value ?? null), supplied = values.filter(value => value !== null);
    const coverage = supplied.length === 0 ? "none" : supplied.length < values.length ? "some" : "all";
    const spelling = supplied.length === 0 ? "no_text" : supplied.length === 1 ? "one_text"
      : new Set(supplied).size > 1 ? "different_text" : "same_spelling";
    return { field, values, coverage, spelling };
  });
}
