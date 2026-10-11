import { z } from "zod";
import { publicIssueProjectionSchema, type PublicIssueProjection } from "./public-issue-projection.ts";
import type { PublicReadOutcome } from "./public-read-outcome.ts";

const slug = (limit: number) => z.string().min(1).max(limit).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const correctionTargetSchema = z.strictObject({
  issueId: z.uuid(), publicationId: z.uuid(), revision: z.number().int().positive().safe(),
  jurisdictionSlug: slug(80), issueSlug: slug(100), claimId: z.uuid().nullable(),
});
export type CorrectionTarget = z.infer<typeof correctionTargetSchema>;
export type CorrectionTargetOutcome =
  | { kind: "available"; target: CorrectionTarget; pageTitle: string; claimAssertion: string | null }
  | { kind: "held"; reason: "unavailable" | "invalid_target" | "changed" };

function checkedIssue(current: PublicReadOutcome): PublicIssueProjection | null {
  if (current?.kind !== "issue") return null;
  const parsed = publicIssueProjectionSchema.safeParse(current.issue);
  if (!parsed.success || !Number.isSafeInteger(parsed.data.revision) ||
      new Set(parsed.data.claims.map(claim => claim.id)).size !== parsed.data.claims.length) return null;
  return parsed.data;
}

// Pure binding to an already checked current projection. This does not fetch,
// approve a publication, prove prior browser visibility or authorize intake.
// A future server must obtain its own current read outcome at the write point.
export function deriveCorrectionTarget(current: PublicReadOutcome, claimId: unknown = null): CorrectionTargetOutcome {
  const issue = checkedIssue(current);
  if (!issue) return { kind: "held", reason: "unavailable" };
  if (claimId !== null && (typeof claimId !== "string" || !issue.claims.some(claim => claim.id === claimId))) {
    return { kind: "held", reason: "invalid_target" };
  }
  const target = correctionTargetSchema.parse({ issueId: issue.issueId, publicationId: issue.publicationId,
    revision: issue.revision, jurisdictionSlug: issue.jurisdictionSlug, issueSlug: issue.issueSlug, claimId });
  return { kind: "available", target, pageTitle: issue.title,
    claimAssertion: claimId === null ? null : issue.claims.find(claim => claim.id === claimId)!.assertion };
}

export function checkCorrectionTarget(current: PublicReadOutcome, input: unknown): CorrectionTargetOutcome {
  const parsed = correctionTargetSchema.safeParse(input);
  if (!parsed.success) return { kind: "held", reason: "invalid_target" };
  const derived = deriveCorrectionTarget(current, parsed.data.claimId);
  if (derived.kind === "held") return derived;
  const keys = ["issueId", "publicationId", "revision", "jurisdictionSlug", "issueSlug", "claimId"] as const;
  if (keys.some(key => derived.target[key] !== parsed.data[key])) return { kind: "held", reason: "changed" };
  return derived;
}

export const correctionKindLabels = {
  incorrect_statement: "Incorrect statement", missing_context: "Missing context",
  broken_source_link: "Broken source link", accessibility_problem: "Accessibility problem",
} as const;
export type CorrectionKind = keyof typeof correctionKindLabels;
const kind = z.enum(["incorrect_statement", "missing_context", "broken_source_link", "accessibility_problem"]);
const sourceUrl = z.string().trim().max(2048).refine(value => {
  if (value === "") return true;
  if (/[\s\u0000-\u001f\u007f]/u.test(value)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
}, "Enter a complete HTTPS URL without a username or password");
export const correctionDraftFieldsSchema = z.strictObject({
  kind, details: z.string().trim().min(10).max(1000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)), sourceUrl,
});
export type CorrectionDraftFields = z.infer<typeof correctionDraftFieldsSchema>;
const draft = z.strictObject({ target: correctionTargetSchema, fields: correctionDraftFieldsSchema });
export type CheckedCorrectionDraft = { target: CorrectionTarget; fields: CorrectionDraftFields; pageTitle: string; claimAssertion: string | null };

// Untrusted fields cannot assign review state, timestamps, resolution, reporter
// identity or private IDs. Source URLs remain text; no fetch or save occurs.
export function checkCorrectionDraft(current: PublicReadOutcome, input: unknown):
  | { kind: "preview"; draft: CheckedCorrectionDraft }
  | { kind: "held"; reason: "unavailable" | "invalid_target" | "changed" | "invalid_fields" } {
  const parsed = draft.safeParse(input);
  if (!parsed.success) return { kind: "held", reason: "invalid_fields" };
  const selected = checkCorrectionTarget(current, parsed.data.target);
  if (selected.kind === "held") return selected;
  return { kind: "preview", draft: { target: selected.target, fields: parsed.data.fields,
    pageTitle: selected.pageTitle, claimAssertion: selected.claimAssertion } };
}
