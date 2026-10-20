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
// One bounded native-control grammar is shared by admission and fixed hints.
function collectedMilestoneControls(input: Iterable<unknown>, rowIds: number[], context: ScopeDraftContext) {
  try {
    const checked = checkedResponsibilityContext(context);
    if (!checked || new Set(rowIds).size !== rowIds.length ||
        rowIds.some(id => !Number.isSafeInteger(id) || id <= 0)) return null;
    if (rowIds.length > PLANNED_MILESTONE_DRAFT_ENTRIES) return { kind: "too_many" as const };
    const fields = Object.keys(plannedMilestoneDraftFieldLabels) as PlannedMilestoneDraftField[];
    const singles = ["claim", "description", "institution", "targetPrecision", "targetValue", "reportedPrecision", "reportedValue"];
    const known = new Set(rowIds.flatMap(id => [...singles, ...fields.map(key => key + "References")].map(key => `${id}.${key}`)));
    const values = new Map<string, string[]>(); let count = 0, size = 0;
    for (const pair of input) {
      if (++count > PLANNED_MILESTONE_DRAFT_ENTRIES * (7 + 4 * 12) || !Array.isArray(pair) || pair.length !== 2 ||
          typeof pair[0] !== "string" || typeof pair[1] !== "string" || !known.has(pair[0])) return null;
      if (pair[1].length > PLANNED_MILESTONE_DRAFT_BYTES) return { kind: "input_size" as const };
      size += new TextEncoder().encode(pair[0] + pair[1]).byteLength; if (size > PLANNED_MILESTONE_DRAFT_BYTES) return { kind: "input_size" as const };
      const list = values.get(pair[0]) ?? []; list.push(pair[1]); values.set(pair[0], list);
    }
    return { kind: "collected" as const, values, rowIds: [...rowIds], context: checked.context };
  } catch { return null; }
}
function milestoneEntries(values: Map<string, string[]>, rowIds: number[], context: ScopeDraftContext) {
    const refs = new Map(context.claims.flatMap(claim => claim.evidence.map((_ref, index) =>
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
    return entries;
}
export function plannedMilestoneDraftFromEntries(input: Iterable<unknown>, rowIds: number[], context: ScopeDraftContext): PlannedMilestoneDraft | null {
  try {
    const collected = collectedMilestoneControls(input, rowIds, context);
    if (collected?.kind !== "collected") return null;
    return checkPlannedMilestoneDraft({ schemaVersion: 1, kind: "planned_milestone_preparation", binding: collected.context.binding,
      entries: milestoneEntries(collected.values, collected.rowIds, collected.context) }, collected.context);
  } catch { return null; }
}
export type PlannedMilestoneDraftFeedback = { entries: Array<{ statement: boolean; duplicate: boolean;
  fields: Record<PlannedMilestoneDraftField, { value: boolean; precision: boolean; references: boolean }> }>;
  tooMany: boolean; size: "input" | "copy" | null };
// Fixed flags only, never source wording, native exception text or acceptance.
export function plannedMilestoneDraftFeedbackFromEntries(input: Iterable<unknown>, rowIds: number[], contextInput: ScopeDraftContext): PlannedMilestoneDraftFeedback | null {
 try {
  const collected=collectedMilestoneControls(input,rowIds,contextInput);if(!collected)return null;
  if(collected.kind!=="collected")return{entries:[],tooMany:collected.kind==="too_many",size:collected.kind==="input_size"?"input":null};
  const {values,context}=collected,claims=new Map(context.claims.map(claim=>[claim.id,claim])),known=new Set(context.claims.flatMap(claim=>claim.evidence.map((_ref,index)=>scopeReferenceKey(claim.id,index+1))));
  const seen=new Set<string>(),entries:PlannedMilestoneDraftFeedback["entries"]=[];
  for(const id of collected.rowIds){
   const one=(name:string)=>{const list=values.get(`${id}.${name}`);if(list?.length!==1)throw Error();return list[0];};
   const claim=one("claim"),hint={statement:!["policy_action","delivery"].includes(claims.get(claim)?.type??""),duplicate:false,
    fields:Object.fromEntries(Object.keys(plannedMilestoneDraftFieldLabels).map(field=>[field,{value:false,precision:false,references:false}]))as PlannedMilestoneDraftFeedback["entries"][number]["fields"]};
   for(const field of Object.keys(plannedMilestoneDraftFieldLabels)as PlannedMilestoneDraftField[]){
    const refs=values.get(`${id}.${field}References`)??[],flag=hint.fields[field];
    flag.references=refs.length>12||new Set(refs).size!==refs.length||refs.some(ref=>!known.has(ref));
    if(field==="targetDate"||field==="reportedDate"){
     const stem=field==="targetDate"?"target":"reported",precision=one(stem+"Precision"),value=one(stem+"Value");
     if(precision===""){flag.precision=value!==""||refs.length>0;flag.value=value===""&&refs.length>0;}
     else if(!["day","month","year","period"].includes(precision))flag.precision=true;
     else flag.value=!knownDate.safeParse(precision==="period"?{precision,label:value}:{precision,value}).success;
     if(precision!==""&&refs.length===0)flag.references=true;
    }else{
     const wording=one(field),supplied=field==="description"||wording!==""||refs.length>0;
     flag.value=supplied&&!wordField.shape.wording.safeParse(wording).success;
     if(supplied&&refs.length===0)flag.references=true;
    }
   }
   try{const entry=milestoneEntries(values,[id],context)[0],parsed=schema.shape.entries.element.safeParse(entry);if(parsed.success){const key=canonicalProposalJson(parsed.data);hint.duplicate=seen.has(key);seen.add(key);}}catch{/* Invalid fields have fixed flags above. */}
   entries.push(hint);
  }
  let size:PlannedMilestoneDraftFeedback["size"]=null;
  try{const value=checkPlannedMilestoneDraft({schemaVersion:1,kind:"planned_milestone_preparation",binding:context.binding,entries:milestoneEntries(values,collected.rowIds,context)},context);
   if(value!==null&&plannedMilestoneDraftJson(value,context)===null)size="copy";
  }catch{/* Unknown reference choices remain field failures. */}
  return{entries,tooMany:false,size};
 }catch{return null;}
}
