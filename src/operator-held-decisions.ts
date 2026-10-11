import { z } from "zod";
import { operatorAuditChoiceIdSchema } from "./operator-audit-choices.ts";
export const heldReasonCodes = ["source_version_not_current", "evidence_locator_unverified", "identity_unresolved", "fields_dates_units_unverified", "semantics_unqualified", "material_conflict", "snapshot_inconsistent", "predecessor_changed", "sensitive_data_present", "decision_identity_missing", "mode_unsupported", "policy_not_active", "source_not_approved", "source_fetch_disabled", "qualification_not_active", "qualification_policy_mismatch", "change_class_not_automatable", "change_class_mismatch", "parser_version_mismatch", "parser_version_invalid", "public_use_not_allowed", "public_citation_invalid", "qualification_expired_or_invalid", "qualification_samples_invalid", "semantic_contract_mismatch", "evidence_receipt_invalid", "decision_time_invalid", "source_endpoint_mismatch", "source_identity_mismatch", "shadow_mode", "qualified_checks_passed"] as const;
export const heldCheckNames = ["source_version_current", "evidence_locator_verified", "identity_resolved", "fields_dates_units_verified", "semantics_qualified", "no_material_conflict", "public_snapshot_consistent", "expected_predecessor_current", "no_sensitive_data"] as const;
const uuid = operatorAuditChoiceIdSchema;
const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const instant = z.iso.datetime().regex(pattern).refine(v => !v.startsWith("0000-"));
export const heldDecisionCursorSchema = z.strictObject({ decidedAt: instant, decisionId: uuid });
export const heldDecisionScopeSchema = z.strictObject({ runId: uuid, cursor: heldDecisionCursorSchema.nullable() });
export type HeldDecisionScope = z.infer<typeof heldDecisionScopeSchema>;
const checkShape = Object.fromEntries(heldCheckNames.map(key => [key, z.boolean().nullable()])) as Record<typeof heldCheckNames[number], z.ZodNullable<z.ZodBoolean>>;
const rowSchema = z.strictObject({
  decisionId: uuid, decidedAt: instant, registrationId: uuid,
  sourceKey: z.string().regex(/^[a-z0-9][a-z0-9:-]{0,119}$/), sourceVersionId: uuid,
  qualificationId: uuid, qualificationRevision: z.number().int().min(1).max(2147483647),
  qualificationDecision: z.enum(["qualified", "suspended"]),
  reasonCodes: z.array(z.enum(heldReasonCodes)).max(24),
  undisclosedReasonCount: z.number().int().min(0).max(24),
  checks: z.strictObject(checkShape), undisclosedCheckCount: z.number().int().min(0).max(4096),
}).refine(r => r.reasonCodes.length + r.undisclosedReasonCount >= 1 && r.reasonCodes.length + r.undisclosedReasonCount <= 24);
function micros(v: string): bigint {
  const n = Date.parse(v.slice(0,19)+"Z");
  return pattern.test(v) && Number.isFinite(n) ? BigInt(n)*BigInt(1000) + BigInt(v.slice(20,-1)) : BigInt(0);
}
function compare(a: {decidedAt:string;decisionId:string},b: {decidedAt:string;decisionId:string}) {
  const x=micros(a.decidedAt),y=micros(b.decidedAt);
  return x<y ? -1 : x>y ? 1 : a.decisionId<b.decisionId ? -1 : a.decisionId>b.decisionId ? 1 : 0;
}
export const heldDecisionsReportSchema = z.strictObject({
  schemaVersion:z.literal(1), status:z.literal("ok"), requested:heldDecisionScopeSchema, observedAt:instant,
  run:z.strictObject({runId:uuid,jurisdictionId:z.string().regex(/^[a-z0-9][a-z0-9:-]{0,79}$/),createdAt:instant}),
  decisions:z.array(rowSchema).max(20), more:z.boolean(), nextCursor:heldDecisionCursorSchema.nullable(),
}).superRefine((r,c) => {
  const fail=()=>c.addIssue({code:"custom",message:"Held decision metadata inconsistent"});
  if(r.run.runId!==r.requested.runId || micros(r.run.createdAt)>micros(r.observedAt))fail();
  const cursor=r.requested.cursor;
  if(cursor && (micros(cursor.decidedAt)<micros(r.run.createdAt) ||
    micros(cursor.decidedAt)>micros(r.observedAt)))fail();
  if(new Set(r.decisions.map(d=>d.decisionId)).size!==r.decisions.length)fail();
  for(let i=0;i<r.decisions.length;i++) {
    const row=r.decisions[i],prior=r.decisions[i-1];
    if(micros(row.decidedAt)<micros(r.run.createdAt)||micros(row.decidedAt)>micros(r.observedAt)||
      cursor && compare(row,cursor)>=0 || prior && compare(prior,row)<=0)fail();
  }
  const last=r.decisions.at(-1);
  if(r.more && r.decisions.length!==20 || r.more !== (r.nextCursor!==null) ||
    r.nextCursor && (!last || r.nextCursor.decidedAt!==last.decidedAt || r.nextCursor.decisionId!==last.decisionId))fail();
});
export const heldDecisionsEnvelopeSchema = z.union([heldDecisionsReportSchema,
  z.strictObject({schemaVersion:z.literal(1),status:z.literal("not_found"),requested:heldDecisionScopeSchema}),
  z.strictObject({schemaVersion:z.literal(1),status:z.literal("changed"),requested:heldDecisionScopeSchema.refine(s=>s.cursor!==null)}),
]);
export type HeldDecisionsReport=z.infer<typeof heldDecisionsReportSchema>;
