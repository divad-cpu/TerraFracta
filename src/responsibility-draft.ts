import { z } from "zod";
import { canonicalProposalJson } from "./operator-proposal-capture.ts";
import { checkedScopeDraftContext, scopeReferenceKey, type ScopeDraftContext } from "./issue-scope-draft.ts";

// A distinct private worksheet, never a public snapshot or a responsibility
// finding. Dates retain the editor's source precision rather than invented days.
export const RESPONSIBILITY_DRAFT_BYTES = 16_384;
export const RESPONSIBILITY_DRAFT_ENTRIES = 8;
export const responsibilityFieldLabels = {
  institution: "Institution or authority", governmentLevel: "Government level",
  role: "Documented role", period: "Role or term period",
} as const;
export type ResponsibilityField = keyof typeof responsibilityFieldLabels;
const bindingSchema = z.strictObject({ runId: z.uuid(), decisionId: z.uuid(), captureId: z.uuid(),
  issueId: z.uuid(), comparisonSha256: z.string().regex(/^[0-9a-f]{64}$/), proposalSha256: z.string().regex(/^[0-9a-f]{64}$/) });
const referenceSchema = z.strictObject({ claimId: z.uuid(), referenceNumber: z.number().int().min(1).max(12) });
const fieldSchema = z.strictObject({ wording: z.string().trim().min(1).max(1200), references: z.array(referenceSchema).min(1).max(12) }).nullable();
const entrySchema = z.strictObject({ claimId: z.uuid(), fields: z.strictObject({
  institution: fieldSchema, governmentLevel: fieldSchema, role: fieldSchema, period: fieldSchema,
}) });
const candidateSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("responsibility_preparation"),
  binding: bindingSchema, entries: z.array(entrySchema).max(RESPONSIBILITY_DRAFT_ENTRIES) });
export type ResponsibilityDraft = z.infer<typeof candidateSchema>;

export function checkedResponsibilityContext(input: unknown): { context: ScopeDraftContext; key: string } | null {
  const checked = checkedScopeDraftContext(input);
  return checked && new Set(checked.context.claims.map(claim => claim.id.toLowerCase())).size === checked.context.claims.length ? checked : null;
}

export function checkResponsibilityDraft(input: unknown, contextInput: unknown): ResponsibilityDraft | null {
  try {
    const checked = checkedResponsibilityContext(contextInput);
    if (!checked) return null;
    const candidate = candidateSchema.parse(input);
    if (canonicalProposalJson(candidate.binding) !== canonicalProposalJson(checked.context.binding)) return null;
    const claims = new Map(checked.context.claims.map(claim => [claim.id, claim]));
    const entries = new Set<string>();
    for (const entry of candidate.entries) {
      if (!claims.has(entry.claimId)) return null;
      const entryKey = canonicalProposalJson(entry);
      if (entries.has(entryKey)) return null;
      entries.add(entryKey);
      for (const field of Object.values(entry.fields)) {
        if (field === null) continue;
        const references = new Set<string>();
        for (const reference of field.references) {
          const key = scopeReferenceKey(reference.claimId, reference.referenceNumber);
          if (references.has(key) || !claims.get(reference.claimId)?.evidence[reference.referenceNumber - 1]) return null;
          references.add(key);
        }
      }
    }
    return candidate;
  } catch { return null; }
}

export function responsibilityDraftJson(input: unknown, context: unknown): string | null {
  const candidate = checkResponsibilityDraft(input, context);
  if (!candidate) return null;
  const json = JSON.stringify(candidate, null, 2);
  return new TextEncoder().encode(json).byteLength <= RESPONSIBILITY_DRAFT_BYTES ? json : null;
}

export function reopenResponsibilityDraftJson(input: unknown, context: unknown): ResponsibilityDraft | null {
  try {
    if (typeof input !== "string" || input.length < 2 || input.length > RESPONSIBILITY_DRAFT_BYTES ||
      new TextEncoder().encode(input).byteLength > RESPONSIBILITY_DRAFT_BYTES) return null;
    const candidate = checkResponsibilityDraft(JSON.parse(input), context);
    return candidate && responsibilityDraftJson(candidate, context) === input ? candidate : null;
  } catch { return null; }
}

export type ResponsibilityEntryFeedback = {
  statement: boolean; duplicate: boolean;
  fields: Record<ResponsibilityField, { wording: boolean; references: boolean }>;
};
export type ResponsibilityDraftFeedback = { entries: ResponsibilityEntryFeedback[]; tooMany: boolean };

// Fixed editing hints only. This neither accepts a candidate nor checks its
// complete encoded byte size, factual responsibility or source eligibility.
export function responsibilityDraftFieldFeedback(input: unknown, contextInput: unknown): ResponsibilityDraftFeedback | null {
  try {
    const checked = checkedResponsibilityContext(contextInput);
    if (!checked || input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const raw = input as Record<string, unknown>;
    if (Object.keys(raw).length !== 4 || Object.keys(raw).some(key => !["schemaVersion", "kind", "binding", "entries"].includes(key))) return null;
    const header = candidateSchema.omit({ entries: true }).safeParse({ schemaVersion: raw.schemaVersion, kind: raw.kind, binding: raw.binding });
    if (!header.success || canonicalProposalJson(header.data.binding) !== canonicalProposalJson(checked.context.binding) || !Array.isArray(raw.entries)) return null;
    if (raw.entries.length > RESPONSIBILITY_DRAFT_ENTRIES) return { entries: [], tooMany: true };
    const names = Object.keys(responsibilityFieldLabels) as ResponsibilityField[];
    const claims = new Map(checked.context.claims.map(claim => [claim.id, claim]));
    const entries: ResponsibilityEntryFeedback[] = [], seenEntries = new Set<string>();
    for (const value of raw.entries) {
      const hint: ResponsibilityEntryFeedback = { statement: false, duplicate: false,
        fields: Object.fromEntries(names.map(name => [name, { wording: false, references: false }])) as ResponsibilityEntryFeedback["fields"] };
      const parsed = entrySchema.safeParse(value);
      if (!parsed.success) for (const issue of parsed.error.issues) {
        if (issue.path[0] === "claimId") hint.statement = true;
        else if (issue.path[0] === "fields" && names.includes(issue.path[1] as ResponsibilityField) && ["wording", "references"].includes(issue.path[2] as string))
          hint.fields[issue.path[1] as ResponsibilityField][issue.path[2] as "wording" | "references"] = true;
        else return null;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
      const entry = value as Record<string, unknown>;
      if (typeof entry.claimId === "string" && !claims.has(entry.claimId)) hint.statement = true;
      if (entry.fields === null || typeof entry.fields !== "object" || Array.isArray(entry.fields)) return null;
      for (const name of names) {
        const field = (entry.fields as Record<string, unknown>)[name];
        if (field === null) continue;
        if (typeof field !== "object" || Array.isArray(field)) return null;
        const references = fieldSchema.unwrap().shape.references.safeParse((field as Record<string, unknown>).references);
        if (references.success) {
          const seen = new Set<string>();
          for (const reference of references.data) {
            const key = scopeReferenceKey(reference.claimId, reference.referenceNumber);
            if (seen.has(key) || !claims.get(reference.claimId)?.evidence[reference.referenceNumber - 1]) hint.fields[name].references = true;
            seen.add(key);
          }
        }
      }
      if (parsed.success) {
        const identity = canonicalProposalJson(parsed.data);
        hint.duplicate = seenEntries.has(identity); seenEntries.add(identity);
      }
      entries.push(hint);
    }
    return { entries, tooMany: false };
  } catch { return null; }
}
