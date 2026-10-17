import { z } from "zod";
import { publicationReadEnvelopeSchema, publicIssueProjectionSchema } from "./public-issue-projection.ts";
import { canonicalProposalJson } from "./operator-proposal-capture.ts";

// Isolated candidate contract. Parsing is not a source, review or publication
// decision. Current/default v1 readers and writers do not accept this version.
export const DOSSIER_CONTEXT_V2_BYTES = 32_768;
export const dossierScopeLabels = {
  population: "Affected population", period: "Dossier period", selectionRationale: "Why this issue was selected",
} as const;
export const dossierResponsibilityLabels = {
  institution: "Institution or authority", governmentLevel: "Government level",
  role: "Documented role", period: "Role or term period",
} as const;
const wording = z.string().min(1).max(1200).refine(value => value === value.trim(), "Noncanonical context wording");
const reference = z.strictObject({ claimId: z.uuid(), referenceNumber: z.number().int().min(1).max(12),
  relation: z.enum(["supports", "contradicts", "context"]) });
// These roles concern this context wording, independently of the role recorded
// against the original statement. A repeated source is not independent support.
const field = z.strictObject({ wording, references: z.array(reference).min(1).max(12).refine(
  refs => refs.some(ref => ref.relation === "supports"), "Supplied context needs an explicit supporting reference",
) }).nullable();
export const dossierContextV2Schema = z.strictObject({
  scope: z.strictObject({ population: field, period: field, selectionRationale: field }),
  responsibilities: z.array(z.strictObject({ claimId: z.uuid(), fields: z.strictObject({
    institution: field, governmentLevel: field, role: field, period: field,
  }) })).max(8),
}).refine(value => new TextEncoder().encode(canonicalProposalJson(value)).byteLength <= DOSSIER_CONTEXT_V2_BYTES,
  "Complete context exceeds its UTF-8 budget");
export type DossierContextV2 = z.infer<typeof dossierContextV2Schema>;
export type DossierContextFieldV2 = NonNullable<DossierContextV2["scope"]["population"]>;
export const dossierSnapshotV2Schema = publicationReadEnvelopeSchema.shape.publication.shape.snapshot.extend({
  schemaVersion: z.literal(2), dossierContext: dossierContextV2Schema,
});
export const dossierProjectionV2Schema = publicIssueProjectionSchema.extend({
  schemaVersion: z.literal(2), dossierContext: dossierContextV2Schema,
});
export type DossierProjectionV2 = z.infer<typeof dossierProjectionV2Schema>;
export type DossierSnapshotV2 = z.infer<typeof dossierSnapshotV2Schema>;
export const dossierContextReviewV2Schema = z.array(z.strictObject({
  publicationId: z.uuid(), revision: z.number().int().positive(),
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
  fieldPath: z.string().regex(/^\/(?:scope\/(?:population|period|selectionRationale)|responsibilities\/[0-7]\/(?:institution|governmentLevel|role|period))$/),
  decision: z.literal("accepted"),
  reviewedAt: z.iso.datetime({ offset: true }).refine(value => (value.match(/\.(\d+)/)?.[1].length ?? 0) <= 9),
})).max(35);

// Fixed JSON-pointer paths identify the supplied fields in this immutable
// snapshot. Unknown fields have no review row; extra rows are refused.
export function suppliedDossierContextFields(context: DossierContextV2): Array<{ path: string; field: DossierContextFieldV2 }> {
  const result: Array<{ path: string; field: DossierContextFieldV2 }> = [];
  for (const name of Object.keys(dossierScopeLabels) as Array<keyof typeof dossierScopeLabels>) {
    const value = context.scope[name]; if (value !== null) result.push({ path: `/scope/${name}`, field: value });
  }
  context.responsibilities.forEach((entry, index) => {
    for (const name of Object.keys(dossierResponsibilityLabels) as Array<keyof typeof dossierResponsibilityLabels>) {
      const value = entry.fields[name]; if (value !== null) result.push({ path: `/responsibilities/${index}/${name}`, field: value });
    }
  });
  return result;
}
