import { z } from "zod";
import { illustrativeDateSchema,type IllustrativeDate } from "./prototype-contract.ts";
export const PLANNED_MILESTONE_CANDIDATE_BYTES=65_536;
export const PLANNED_MILESTONE_CANDIDATE_ENTRIES=8;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const identity={publicationId:z.uuid(),revision:z.number().int().positive(),baseSnapshotSha256:hash};
const instant=z.iso.datetime({offset:true}).refine(value=>!value.startsWith('0000-')&&(value.match(/\.(\d+)/)?.[1].length??0)<=9);
const reference=z.strictObject({claimId:z.uuid(),referenceNumber:z.number().int().min(1).max(12),relation:z.enum(['supports','contradicts','context'])});
const references=z.array(reference).min(1).max(12).refine(refs=>refs.some(ref=>ref.relation==='supports'),'Explicit field support is required').refine(refs=>new Set(refs.map(ref=>JSON.stringify([ref.claimId.toLowerCase(),ref.referenceNumber]))).size===refs.length,'Repeated exact reference');
const wording=z.string().min(1).max(1200).refine(value=>value===value.trim(),'Noncanonical wording');
const wordField=z.strictObject({wording,references});
const knownDate=illustrativeDateSchema.refine(value=>value.precision!=='not_supplied','Unknown dates use null');
const dateField=z.strictObject({date:knownDate,references});
export const plannedMilestoneFieldLabels={description:'Documented planned milestone',targetDate:'Source-described target date or period',institution:'Source-described responsible institution',reportedDate:'Source-reported date or period'}as const;
export type PlannedMilestoneField=keyof typeof plannedMilestoneFieldLabels;
// Separate candidate metadata only. A target, date or clock position cannot
// establish adoption, delivery, current responsibility, completion or causality.
export const plannedMilestoneCandidateSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('planned_milestone_candidate'),...identity,
 sources:z.array(z.strictObject({sourceVersionId:z.uuid(),contentSha256:hash})).min(1).max(120).refine(rows=>new Set(rows.map(row=>row.sourceVersionId.toLowerCase())).size===rows.length,'Repeated source version'),
 entries:z.array(z.strictObject({claimId:z.uuid(),fields:z.strictObject({description:wordField,targetDate:dateField.nullable(),institution:wordField.nullable(),reportedDate:dateField.nullable()})})).max(PLANNED_MILESTONE_CANDIDATE_ENTRIES)});
export const plannedMilestoneReviewSchema=z.strictObject({...identity,candidateSha256:hash,fieldPath:z.string().regex(/^\/entries\/[0-7]\/fields\/(?:description|targetDate|institution|reportedDate)$/),decision:z.literal('accepted'),reviewedAt:instant});
export const plannedMilestoneFinalReviewSchema=z.strictObject({...identity,candidateSha256:hash,decision:z.literal('accepted'),reviewedAt:instant});
export type PlannedMilestoneCandidate=z.infer<typeof plannedMilestoneCandidateSchema>;
export type PlannedMilestoneReview=z.infer<typeof plannedMilestoneReviewSchema>;
export type PlannedMilestoneFinalReview=z.infer<typeof plannedMilestoneFinalReviewSchema>;
export function plannedMilestoneCandidateJson(input:unknown):string|null {
 try{const value=plannedMilestoneCandidateSchema.parse(input),json=JSON.stringify(value,null,2);return new TextEncoder().encode(json).byteLength<=PLANNED_MILESTONE_CANDIDATE_BYTES?json:null;}catch{return null;}
}
export function suppliedPlannedMilestoneFields(value:PlannedMilestoneCandidate){
 return value.entries.flatMap((entry,index)=>(Object.keys(plannedMilestoneFieldLabels)as PlannedMilestoneField[]).flatMap(key=>entry.fields[key]===null?[]:[{path:`/entries/${index}/fields/${key}`,field:entry.fields[key]!}]));
}
// Explicit comparison date only. Compare prefixes at the source's precision;
// never invent a start/end day or infer an overdue/completed/event status.
export function milestoneDatePosition(input:IllustrativeDate|null,comparisonISOdate:string):'before'|'overlaps'|'after'|'not_comparable' {
 try{if(input===null)return'not_comparable';const date=illustrativeDateSchema.parse(input),compared=z.iso.date().parse(comparisonISOdate);
  if(date.precision==='period'||date.precision==='not_supplied')return'not_comparable';
  const reference=compared.slice(0,date.value.length);return date.value===reference?'overlaps':date.value<reference?'before':'after';
 }catch{return'not_comparable';}
}
