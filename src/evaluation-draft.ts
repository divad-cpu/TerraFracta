import { z } from "zod";
import { canonicalProposalJson } from "./operator-proposal-capture.ts";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { scopeReferenceKey, type ScopeDraftContext } from "./issue-scope-draft.ts";
import { copyNativeArrayBuffer } from "./native-byte-chunk.ts";

// Private source-described evaluation metadata. Structural agreement does not
// establish evaluator independence, design validity, support or a causal effect.
export const EVALUATION_DRAFT_BYTES = 16_384;
export const EVALUATION_DRAFT_ENTRIES = 4;
export const evaluationFieldLabels = {
 evaluator: "Source-described evaluator", design: "Source-described evaluation design",
 finding: "Attributed evaluation finding", intervention: "Assessed intervention or measure",
 population: "Assessed population or coverage", period: "Source-described assessment period",
 comparison: "Source-described comparison", limitations: "Source-described limitations",
} as const;
export type EvaluationField = keyof typeof evaluationFieldLabels;
const reference = z.strictObject({ claimId: z.uuid(), referenceNumber: z.number().int().min(1).max(12) });
// Reuse the pinned Zod wording facility; its bounds count Unicode code points.
const field = z.strictObject({ wording: z.string().trim().min(1).max(1200), references: z.array(reference).min(1).max(12) }).nullable();
const binding = z.strictObject({ runId:z.uuid(),decisionId:z.uuid(),captureId:z.uuid(),issueId:z.uuid(),comparisonSha256:z.string().regex(/^[a-f0-9]{64}$/),proposalSha256:z.string().regex(/^[a-f0-9]{64}$/) });
const schema = z.strictObject({ schemaVersion:z.literal(1),kind:z.literal("evaluation_preparation"),binding,
 entries:z.array(z.strictObject({claimId:z.uuid(),fields:z.strictObject({evaluator:field,design:field,finding:field,intervention:field,population:field,period:field,comparison:field,limitations:field})})).max(EVALUATION_DRAFT_ENTRIES) });
export type EvaluationDraft = z.infer<typeof schema>;
export function checkEvaluationDraft(input:unknown,contextInput:unknown):EvaluationDraft|null {
 try {
  const checked=checkedResponsibilityContext(contextInput);if(!checked)return null;
  const candidate=schema.parse(input);
  if(canonicalProposalJson(candidate.binding)!==canonicalProposalJson(checked.context.binding))return null;
  const claims=new Map(checked.context.claims.map(claim=>[claim.id,claim])),entries=new Set<string>();
  for(const entry of candidate.entries){
   if(claims.get(entry.claimId)?.type!=="evaluation")return null;
   const key=canonicalProposalJson(entry);if(entries.has(key))return null;entries.add(key);
   for(const value of Object.values(entry.fields)){
    if(value===null)continue;const seen=new Set<string>();
    for(const ref of value.references){const identity=scopeReferenceKey(ref.claimId,ref.referenceNumber);if(seen.has(identity)||!claims.get(ref.claimId)?.evidence[ref.referenceNumber-1])return null;seen.add(identity);}
   }
  }
  return candidate;
 }catch{return null;}
}
export function evaluationDraftJson(input:unknown,context:unknown):string|null {
 const candidate=checkEvaluationDraft(input,context);if(!candidate)return null;
 const json=JSON.stringify(candidate,null,2);return new TextEncoder().encode(json).byteLength<=EVALUATION_DRAFT_BYTES?json:null;
}
export function reopenEvaluationDraftJson(input:unknown,context:unknown):EvaluationDraft|null {
 try{
  if(typeof input!=="string"||input.length>EVALUATION_DRAFT_BYTES||new TextEncoder().encode(input).byteLength>EVALUATION_DRAFT_BYTES)return null;
  const candidate=checkEvaluationDraft(JSON.parse(input),context);return candidate&&evaluationDraftJson(candidate,context)===input?candidate:null;
 }catch{return null;}
}
export function readEvaluationDraftFile(bytes:ArrayBuffer,expectedBytes:number,context:unknown):EvaluationDraft|null {
 try{
  if(!Number.isSafeInteger(expectedBytes)||expectedBytes<2||expectedBytes>EVALUATION_DRAFT_BYTES)return null;
  const owned=new Uint8Array(EVALUATION_DRAFT_BYTES),size=copyNativeArrayBuffer(owned,bytes);if(size!==expectedBytes)return null;
  return reopenEvaluationDraftJson(new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(owned.subarray(0,size)),context);
 }catch{return null;}
}
// Native control values are an untrusted bounded iterable. References may point
// to any exact occurrence in this comparison, without changing its original role.
type EvaluationInput={kind:"collected";candidate:unknown;context:ScopeDraftContext}|{kind:"too_many"}|{kind:"input_size"};
function evaluationInputFromEntries(input:Iterable<unknown>,rowIds:number[],contextInput:ScopeDraftContext):EvaluationInput|null {
 try{
  const checked=checkedResponsibilityContext(contextInput),fields=Object.keys(evaluationFieldLabels)as EvaluationField[];
  if(!checked)return null;
  if(rowIds.length>EVALUATION_DRAFT_ENTRIES)return{kind:"too_many"};
  if(new Set(rowIds).size!==rowIds.length||rowIds.some(id=>!Number.isSafeInteger(id)||id<=0))return null;
  const known=new Set(rowIds.flatMap(id=>["claim",...fields.flatMap(field=>[field,field+"References"])].map(key=>`${id}.${key}`)));
  const values=new Map<string,string[]>();let count=0,size=0;
  for(const pair of input){
   if(++count>EVALUATION_DRAFT_ENTRIES*(1+8*13)||!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=="string"||typeof pair[1]!=="string"||!known.has(pair[0]))return null;
   if(pair[1].length>EVALUATION_DRAFT_BYTES)return{kind:"input_size"};
   size+=new TextEncoder().encode(pair[0]+pair[1]).byteLength;if(size>EVALUATION_DRAFT_BYTES)return{kind:"input_size"};
   const list=values.get(pair[0])??[];list.push(pair[1]);values.set(pair[0],list);
  }
  const refs=new Map(checked.context.claims.flatMap(claim=>claim.evidence.map((_source,index)=>[scopeReferenceKey(claim.id,index+1),{claimId:claim.id,referenceNumber:index+1}]as const)));
  const entries=rowIds.map(id=>{
   const one=(key:string)=>{const list=values.get(`${id}.${key}`);if(list?.length!==1)throw Error();return list[0];};
   return {claimId:one("claim"),fields:Object.fromEntries(fields.map(key=>{
    const wording=one(key),selected=values.get(`${id}.${key}References`)??[];
    if(wording===""&&selected.length===0)return[key,null];
    // Empty wording with selected references survives only for fixed hints.
    return[key,{wording,references:selected.map(key=>{const ref=refs.get(key);if(!ref)throw Error();return ref;})}];
   }))};
  });
  return{kind:"collected",candidate:{schemaVersion:1,kind:"evaluation_preparation",binding:checked.context.binding,entries},context:checked.context};
 }catch{return null;}
}

export function evaluationDraftFromEntries(input:Iterable<unknown>,rowIds:number[],context:ScopeDraftContext):EvaluationDraft|null {
 const collected=evaluationInputFromEntries(input,rowIds,context);return collected?.kind==="collected"?checkEvaluationDraft(collected.candidate,collected.context):null;
}
export type EvaluationEntryFeedback={statement:boolean;duplicate:boolean;fields:Record<EvaluationField,{wording:boolean;references:boolean}>};
export type EvaluationDraftFeedback={entries:EvaluationEntryFeedback[];tooMany:boolean;size:"input"|"copy"|null};
// Fixed hints only. Reuse authoritative schemas and exact occurrence membership;
// invalid editing candidates are never accepted by the unchanged JSON codec.
export function evaluationDraftFieldFeedback(input:unknown,contextInput:unknown):EvaluationDraftFeedback|null {
 try{
  const checked=checkedResponsibilityContext(contextInput);if(!checked||input===null||typeof input!=="object"||Array.isArray(input))return null;
  const raw=input as Record<string,unknown>,keys=Object.keys(raw);
  if(keys.length!==4||keys.some(key=>!["schemaVersion","kind","binding","entries"].includes(key)))return null;
  const header=schema.omit({entries:true}).safeParse({schemaVersion:raw.schemaVersion,kind:raw.kind,binding:raw.binding});
  if(!header.success||canonicalProposalJson(header.data.binding)!==canonicalProposalJson(checked.context.binding)||!Array.isArray(raw.entries))return null;
  if(raw.entries.length>EVALUATION_DRAFT_ENTRIES)return{entries:[],tooMany:true,size:null};
  const names=Object.keys(evaluationFieldLabels)as EvaluationField[],claims=new Map(checked.context.claims.map(claim=>[claim.id,claim])),seenEntries=new Set<string>(),entries:EvaluationEntryFeedback[]=[],entrySchema=schema.shape.entries.element;
  for(const value of raw.entries){
   const hint:EvaluationEntryFeedback={statement:false,duplicate:false,fields:Object.fromEntries(names.map(name=>[name,{wording:false,references:false}]))as EvaluationEntryFeedback["fields"]};
   const parsed=entrySchema.safeParse(value);
   if(!parsed.success)for(const issue of parsed.error.issues){
    if(issue.path[0]==="claimId")hint.statement=true;
    else if(issue.path[0]==="fields"&&names.includes(issue.path[1]as EvaluationField)&&["wording","references"].includes(issue.path[2]as string))hint.fields[issue.path[1]as EvaluationField][issue.path[2]as "wording"|"references"]=true;
    else return null;
   }
   if(value===null||typeof value!=="object"||Array.isArray(value))return null;
   const entry=value as Record<string,unknown>;
   if(typeof entry.claimId!=="string"||claims.get(entry.claimId)?.type!=="evaluation")hint.statement=true;
   if(entry.fields===null||typeof entry.fields!=="object"||Array.isArray(entry.fields))return null;
   const supplied=entry.fields as Record<string,unknown>;
   for(const name of names){
    const value=supplied[name];if(value===null)continue;if(typeof value!=="object"||Array.isArray(value))return null;
    const refs=entrySchema.shape.fields.shape[name].unwrap().shape.references.safeParse((value as Record<string,unknown>).references);
    if(refs.success){const seen=new Set<string>();for(const ref of refs.data){const identity=scopeReferenceKey(ref.claimId,ref.referenceNumber);if(seen.has(identity)||!claims.get(ref.claimId)?.evidence[ref.referenceNumber-1])hint.fields[name].references=true;seen.add(identity);}}
   }
   if(parsed.success){const identity=canonicalProposalJson(parsed.data);hint.duplicate=seenEntries.has(identity);seenEntries.add(identity);}
   entries.push(hint);
  }
  const candidate=checkEvaluationDraft(input,checked.context);
  return{entries,tooMany:false,size:candidate!==null&&evaluationDraftJson(candidate,checked.context)===null?"copy":null};
 }catch{return null;}
}
export function evaluationDraftFeedbackFromEntries(input:Iterable<unknown>,rowIds:number[],context:ScopeDraftContext):EvaluationDraftFeedback|null {
 const collected=evaluationInputFromEntries(input,rowIds,context);if(!collected)return null;
 if(collected.kind==="too_many")return{entries:[],tooMany:true,size:null};
 if(collected.kind==="input_size")return{entries:[],tooMany:false,size:"input"};
 return evaluationDraftFieldFeedback(collected.candidate,collected.context);
}
