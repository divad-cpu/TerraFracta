import { z } from "zod";
import { canonicalProposalJson } from "./operator-proposal-capture.ts";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { scopeReferenceKey, type ScopeDraftContext } from "./issue-scope-draft.ts";

// Private preparation, not expenditure evidence or a public funding taxonomy.
// Amounts stay strings: no floating-point conversion, summation or exchange rate.
export const FUNDING_DRAFT_BYTES = 16_384;
export const FUNDING_DRAFT_ENTRIES = 4;
export const fundingFieldLabels = { stage: "Funding stage", amount: "Exact signed decimal amount", currency: "Source currency code",
  scale: "Amount scale", financialPeriod: "Financial period", priceBasis: "Price basis", priceBasePeriod: "Constant-price base period",
  coverage: "Period or cumulative coverage", revisionRelation: "Source-described relation to earlier amounts" } as const;
export type FundingField = keyof typeof fundingFieldLabels;
export const fundingChoices: Partial<Record<FundingField, Record<string, string>>> = {
  stage: { announced: "Announced or promised", allocated: "Allocated or appropriated", disbursed: "Disbursed", spent: "Spent" },
  scale: { units: "Units", thousands: "Thousands", millions: "Millions", billions: "Billions" },
  priceBasis: { nominal: "Nominal prices", constant_prices: "Constant prices" },
  coverage: { single_period: "One stated period", cumulative: "Cumulative total" },
  revisionRelation: { additional: "Additional to an earlier amount", replaces_earlier: "Replaces an earlier amount", not_comparable: "Not comparable with the earlier amount" },
};
const ref = z.strictObject({ claimId: z.uuid(), referenceNumber: z.number().int().min(1).max(12) });
const field = <T extends z.ZodType<string>>(value: T) => z.strictObject({ value, references: z.array(ref).min(1).max(12) }).nullable();
const period = z.string().trim().min(1).max(240);
const binding = z.strictObject({ runId: z.uuid(), decisionId: z.uuid(), captureId: z.uuid(), issueId: z.uuid(),
  comparisonSha256: z.string().regex(/^[0-9a-f]{64}$/), proposalSha256: z.string().regex(/^[0-9a-f]{64}$/) });
const schema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("funding_preparation"), binding,
  entries: z.array(z.strictObject({ claimId: z.uuid(), fields: z.strictObject({
    stage: field(z.enum(["announced", "allocated", "disbursed", "spent"])),
    amount: field(z.string().regex(/^-?(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,9})?$/)),
    currency: field(z.string().regex(/^[A-Z]{3}$/)), scale: field(z.enum(["units", "thousands", "millions", "billions"])),
    financialPeriod: field(period), priceBasis: field(z.enum(["nominal", "constant_prices"])), priceBasePeriod: field(period),
    coverage: field(z.enum(["single_period", "cumulative"])), revisionRelation: field(z.enum(["additional", "replaces_earlier", "not_comparable"])),
  }) })).max(FUNDING_DRAFT_ENTRIES) });
export type FundingDraft = z.infer<typeof schema>;
export function checkFundingDraft(input: unknown, contextInput: unknown): FundingDraft | null {
  try {
    const checked = checkedResponsibilityContext(contextInput); if (!checked) return null;
    const value = schema.parse(input);
    if (canonicalProposalJson(value.binding) !== canonicalProposalJson(checked.context.binding)) return null;
    const claims = new Map(checked.context.claims.map(claim => [claim.id, claim])), entries = new Set<string>();
    for (const entry of value.entries) {
      if (claims.get(entry.claimId)?.type !== "funding") return null;
      const identity = canonicalProposalJson(entry); if (entries.has(identity)) return null; entries.add(identity);
      for (const field of Object.values(entry.fields)) {
        if (field === null) continue;
        const seen = new Set<string>();
        for (const reference of field.references) {
          const key = scopeReferenceKey(reference.claimId, reference.referenceNumber);
          if (seen.has(key) || !claims.get(reference.claimId)?.evidence[reference.referenceNumber - 1]) return null;
          seen.add(key);
        }
      }
    }
    return value;
  } catch { return null; }
}
export function fundingDraftJson(input: unknown, context: unknown): string | null {
  const value = checkFundingDraft(input, context); if (!value) return null;
  const json = JSON.stringify(value, null, 2); return new TextEncoder().encode(json).byteLength <= FUNDING_DRAFT_BYTES ? json : null;
}
export function reopenFundingDraftJson(input: unknown, context: unknown): FundingDraft | null {
  try {
    if (typeof input !== "string" || input.length > FUNDING_DRAFT_BYTES || new TextEncoder().encode(input).byteLength > FUNDING_DRAFT_BYTES) return null;
    const value = checkFundingDraft(JSON.parse(input), context); return value && fundingDraftJson(value, context) === input ? value : null;
  } catch { return null; }
}
type FundingInput = { kind: "collected"; candidate: unknown; context: ScopeDraftContext } | { kind: "too_many" } | { kind: "input_size" };
function fundingInputFromEntries(input: Iterable<unknown>, rowIds: number[], context: ScopeDraftContext): FundingInput | null {
  try {
    const checked = checkedResponsibilityContext(context), fields = Object.keys(fundingFieldLabels) as FundingField[];
    if (!checked) return null;
    if (rowIds.length > FUNDING_DRAFT_ENTRIES) return { kind: "too_many" };
    if (new Set(rowIds).size !== rowIds.length || rowIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return null;
    const names = new Set(rowIds.flatMap(id => ["claim", ...fields.flatMap(field => [field, field + "References"])].map(key => `${id}.${key}`)));
    const values = new Map<string, string[]>(); let count = 0, size = 0;
    for (const pair of input) {
      if (++count > FUNDING_DRAFT_ENTRIES * (1 + fields.length * 13) || !Array.isArray(pair) || pair.length !== 2 ||
          typeof pair[0] !== "string" || typeof pair[1] !== "string" || !names.has(pair[0])) return null;
      if (pair[1].length > FUNDING_DRAFT_BYTES) return { kind: "input_size" };
      size += new TextEncoder().encode(pair[0] + pair[1]).byteLength; if (size > FUNDING_DRAFT_BYTES) return { kind: "input_size" };
      const list = values.get(pair[0]) ?? []; list.push(pair[1]); values.set(pair[0], list);
    }
    const references = new Map(checked.context.claims.flatMap(claim => claim.evidence.map((_source, index) =>
      [scopeReferenceKey(claim.id, index + 1), { claimId: claim.id, referenceNumber: index + 1 }] as const)));
    const entries = rowIds.map(id => {
      const one = (key: string) => { const list = values.get(`${id}.${key}`); if (list?.length !== 1) throw new Error("Incomplete funding control"); return list[0]; };
      return { claimId: one("claim"), fields: Object.fromEntries(fields.map(name => {
        const value = one(name), selected = (values.get(`${id}.${name}References`) ?? []).map(key => {
          const ref = references.get(key); if (!ref) throw new Error("Unknown funding reference"); return ref;
        });
        // Keep this malformed editing combination only for fixed feedback.
        // The unchanged authoritative schema still rejects an empty value.
        return [name, value === "" && selected.length === 0 ? null : { value, references: selected }];
      })) };
    });
    return { kind: "collected", candidate: { schemaVersion: 1, kind: "funding_preparation", binding: checked.context.binding, entries }, context: checked.context };
  } catch { return null; }
}

export function fundingDraftFromEntries(input: Iterable<unknown>, rowIds: number[], context: ScopeDraftContext): FundingDraft | null {
  const collected = fundingInputFromEntries(input, rowIds, context);
  return collected?.kind === "collected" ? checkFundingDraft(collected.candidate, collected.context) : null;
}

export type FundingEntryFeedback = {
  statement: boolean; duplicate: boolean;
  fields: Record<FundingField, { value: boolean; references: boolean }>;
};
export type FundingDraftFeedback = { entries: FundingEntryFeedback[]; tooMany: boolean; size: "input" | "copy" | null };

// Fixed editing hints from the same authoritative field schemas. This never
// changes a supplied value/reference, accepts content or proves source meaning.
export function fundingDraftFieldFeedback(input: unknown, contextInput: unknown): FundingDraftFeedback | null {
  try {
    const checked = checkedResponsibilityContext(contextInput);
    if (!checked || input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const raw = input as Record<string, unknown>;
    if (Object.keys(raw).length !== 4 || Object.keys(raw).some(key => !["schemaVersion", "kind", "binding", "entries"].includes(key))) return null;
    const header = schema.omit({ entries: true }).safeParse({ schemaVersion: raw.schemaVersion, kind: raw.kind, binding: raw.binding });
    if (!header.success || canonicalProposalJson(header.data.binding) !== canonicalProposalJson(checked.context.binding) || !Array.isArray(raw.entries)) return null;
    if (raw.entries.length > FUNDING_DRAFT_ENTRIES) return { entries: [], tooMany: true, size: null };
    const names = Object.keys(fundingFieldLabels) as FundingField[], claims = new Map(checked.context.claims.map(claim => [claim.id, claim]));
    const entries: FundingEntryFeedback[] = [], seenEntries = new Set<string>(), entrySchema = schema.shape.entries.element;
    for (const value of raw.entries) {
      const hint: FundingEntryFeedback = { statement: false, duplicate: false,
        fields: Object.fromEntries(names.map(name => [name, { value: false, references: false }])) as FundingEntryFeedback["fields"] };
      const parsed = entrySchema.safeParse(value);
      if (!parsed.success) for (const issue of parsed.error.issues) {
        if (issue.path[0] === "claimId") hint.statement = true;
        else if (issue.path[0] === "fields" && names.includes(issue.path[1] as FundingField) && ["value", "references"].includes(issue.path[2] as string))
          hint.fields[issue.path[1] as FundingField][issue.path[2] as "value" | "references"] = true;
        else return null;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
      const entry = value as Record<string, unknown>, type = typeof entry.claimId === "string" ? claims.get(entry.claimId)?.type : null;
      if (type !== "funding") hint.statement = true;
      if (entry.fields === null || typeof entry.fields !== "object" || Array.isArray(entry.fields)) return null;
      const fields = entry.fields as Record<string, unknown>;
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
    const candidate = checkFundingDraft(input, checked.context);
    return { entries, tooMany: false, size: candidate !== null && fundingDraftJson(candidate, checked.context) === null ? "copy" : null };
  } catch { return null; }
}

export function fundingDraftFeedbackFromEntries(input: Iterable<unknown>, rowIds: number[], context: ScopeDraftContext): FundingDraftFeedback | null {
  const collected = fundingInputFromEntries(input, rowIds, context); if (!collected) return null;
  if (collected.kind === "too_many") return { entries: [], tooMany: true, size: null };
  if (collected.kind === "input_size") return { entries: [], tooMany: false, size: "input" };
  return fundingDraftFieldFeedback(collected.candidate, collected.context);
}

