import { z } from "zod";
import { publicationReadEnvelopeSchema } from "./public-issue-projection.ts";
import { canonicalProposalJson } from "./operator-proposal-capture.ts";

// Private preparation only. Neither these fields nor their references extend
// the accepted publication shape or constitute a factual/editorial decision.
export const SCOPE_DRAFT_BYTES = 16_384;
export const scopeFieldLabels = { population: "Affected population", period: "Dossier period", selectionRationale: "Reason for selecting this issue" } as const;
export type ScopeField = keyof typeof scopeFieldLabels;
const bindingSchema = z.strictObject({ runId: z.uuid(), decisionId: z.uuid(), captureId: z.uuid(),
  issueId: z.uuid(), comparisonSha256: z.string().regex(/^[0-9a-f]{64}$/), proposalSha256: z.string().regex(/^[0-9a-f]{64}$/) });
const publicationClaim = publicationReadEnvelopeSchema.shape.publication.shape.snapshot.shape.claims.element;
// Only reference-choice display fields cross the client boundary. Full evidence
// metadata remains covered by the server's comparison fingerprint and gate.
const claimsSchema = z.array(publicationClaim.pick({ id: true, type: true, periodLabel: true }).extend({
  evidence: z.array(publicationClaim.shape.evidence.element.pick({ title: true, locator: true, relation: true })).min(1).max(12),
})).min(1).max(30);
const contextSchema = z.strictObject({ binding: bindingSchema, claims: claimsSchema });
const referenceSchema = z.strictObject({ claimId: z.uuid(), referenceNumber: z.number().int().min(1).max(12) });
const fieldSchema = z.strictObject({ wording: z.string().trim().min(1).max(1200),
  references: z.array(referenceSchema).min(1).max(12) }).nullable();
const candidateSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("issue_scope_preparation"),
  binding: bindingSchema, fields: z.strictObject({ population: fieldSchema, period: fieldSchema, selectionRationale: fieldSchema }) });
export type ScopeDraftContext = z.infer<typeof contextSchema>;
export type ScopeDraftCandidate = z.infer<typeof candidateSchema>;
export const scopeReferenceKey = (claimId: string, number: number) => `${claimId}:${number}`;
export type ScopeDraftFieldFeedback = Record<ScopeField, { wording: boolean; references: boolean }>;

// Fixed control hints for an unsent review. The canonical candidate, binding
// and total UTF-8 export gates below remain authoritative.
export function scopeDraftFieldFeedback(input: unknown, contextInput: unknown): ScopeDraftFieldFeedback | null {
  try {
    const checked = checkedScopeDraftContext(contextInput);
    if (!checked || input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const names = Object.keys(scopeFieldLabels) as ScopeField[];
    const keys = Object.keys(input);
    if (keys.length !== names.length || keys.some(key => !names.includes(key as ScopeField))) return null;
    const claims = new Map(checked.context.claims.map(claim => [claim.id, claim]));
    const feedback = {} as ScopeDraftFieldFeedback;
    for (const name of names) {
      const hint = { wording: false, references: false };
      const value = (input as Record<string, unknown>)[name];
      const parsed = candidateSchema.shape.fields.shape[name].safeParse(value);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          if (issue.path[0] === "wording") hint.wording = true;
          else if (issue.path[0] === "references") hint.references = true;
          else return null;
        }
      }
      // A wording error must not hide a separately invalid occurrence choice.
      const references = value !== null && typeof value === "object"
        ? fieldSchema.unwrap().shape.references.safeParse((value as Record<string, unknown>).references) : null;
      if (references?.success) {
        const seen = new Set<string>();
        for (const reference of references.data) {
          const key = scopeReferenceKey(reference.claimId, reference.referenceNumber);
          if (seen.has(key) || !claims.get(reference.claimId)?.evidence[reference.referenceNumber - 1]) hint.references = true;
          seen.add(key);
        }
      }
      feedback[name] = hint;
    }
    return feedback;
  } catch { return null; }
}

export function checkedScopeDraftContext(input: unknown): { context: ScopeDraftContext; key: string } | null {
  try {
    const context = contextSchema.parse(input);
    if (new Set(context.claims.map(claim => claim.id)).size !== context.claims.length) return null;
    return { context, key: canonicalProposalJson(context) };
  } catch { return null; }
}

export function checkScopeDraft(input: unknown, contextInput: unknown): ScopeDraftCandidate | null {
  try {
    const checked = checkedScopeDraftContext(contextInput);
    if (checked === null) return null;
    const candidate = candidateSchema.parse(input);
    if (canonicalProposalJson(candidate.binding) !== canonicalProposalJson(checked.context.binding)) return null;
    const claims = new Map(checked.context.claims.map(claim => [claim.id, claim]));
    for (const field of Object.values(candidate.fields)) {
      if (field === null) continue;
      const keys = new Set<string>();
      for (const reference of field.references) {
        const key = scopeReferenceKey(reference.claimId, reference.referenceNumber);
        if (keys.has(key) || !claims.get(reference.claimId)?.evidence[reference.referenceNumber - 1]) return null;
        keys.add(key);
      }
    }
    return candidate;
  } catch { return null; }
}

// The exact pretty-printed checked export is the reopening format. Comparing
// its bytes also rejects duplicate keys, escaped aliases and normalized values.
// Reopening is consistency checking, never proof of authorship or acceptance.
export function scopeDraftJson(input: unknown, context: unknown): string | null {
  const candidate = checkScopeDraft(input, context);
  if (candidate === null) return null;
  const json = JSON.stringify(candidate, null, 2);
  return new TextEncoder().encode(json).byteLength <= SCOPE_DRAFT_BYTES ? json : null;
}

export function reopenScopeDraftJson(input: unknown, context: unknown): ScopeDraftCandidate | null {
  try {
    if (typeof input !== "string" || input.length < 2 || input.length > SCOPE_DRAFT_BYTES ||
        new TextEncoder().encode(input).byteLength > SCOPE_DRAFT_BYTES) return null;
    const candidate = checkScopeDraft(JSON.parse(input), context);
    return candidate !== null && scopeDraftJson(candidate, context) === input ? candidate : null;
  } catch { return null; }
}
