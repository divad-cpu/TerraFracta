import { checkEvaluationPreparationBundle,evaluationPreparationBundleJson } from "./evaluation-preparation-bundle.ts";
import { checkedResponsibilityContext } from "./responsibility-draft.ts";
import { reopenPreparationPacketJson } from "./preparation-packet.ts";
import { preparationPacketReading } from "./preparation-reading.ts";
import { reopenEvaluationDraftJson,evaluationFieldLabels,type EvaluationField } from "./evaluation-draft.ts";
import { scopeReferenceKey } from "./issue-scope-draft.ts";
import { recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";
import { statementLabels,evidenceLabels } from "./issue-display-labels.ts";

// A reading model only. Both children must be complete, exact and bound before
// either is exposed. No new copied format, source matching or authority exists.
export function evaluationPreparationReading(input:unknown,contextInput:unknown){
 try{
  const checked=checkedResponsibilityContext(contextInput);if(!checked)return null;
  const context=checked.context,bundle=checkEvaluationPreparationBundle(input,context);
  if(!bundle||evaluationPreparationBundleJson(bundle,context)===null)return null;
  const packet=bundle.preparations.preparationPacket===null?null:reopenPreparationPacketJson(bundle.preparations.preparationPacket,context);
  if(bundle.preparations.preparationPacket!==null&&packet===null)return null;
  // Reuse the established complete six-part reader; never clone its codecs.
  if(packet!==null&&preparationPacketReading(packet,context)===null)return null;
  const draft=bundle.preparations.evaluation===null?null:reopenEvaluationDraftJson(bundle.preparations.evaluation,context);
  if(bundle.preparations.evaluation!==null&&draft===null)return null;
  const claims=new Map(context.claims.map((claim,index)=>[claim.id,{...claim,number:index+1}]));
  const selected=new Map<string,Array<{entryNumber:number;field:EvaluationField;label:string}>>();
  const entries=draft?.entries.map((entry,index)=>{
   const claim=claims.get(entry.claimId);if(!claim||claim.type!=="evaluation")throw Error();
   return{statement:{number:claim.number,label:statementLabels[claim.type],period:claim.periodLabel,href:`#proposal-proposed-claim-${claim.id}`},fields:(Object.keys(evaluationFieldLabels)as EvaluationField[]).map(key=>{
    const value=entry.fields[key];if(value===null)return{key,label:evaluationFieldLabels[key],value:null,references:[]};
    const references=value.references.map(ref=>{const identity=scopeReferenceKey(ref.claimId,ref.referenceNumber),uses=selected.get(identity)??[];uses.push({entryNumber:index+1,field:key,label:evaluationFieldLabels[key]});selected.set(identity,uses);return identity;});
    return{key,label:evaluationFieldLabels[key],value:value.wording,references};
   })};
  })??[];
  const references=context.claims.flatMap((claim,index)=>claim.evidence.flatMap((source,referenceIndex)=>{
   const key=scopeReferenceKey(claim.id,referenceIndex+1),selections=selected.get(key);return selections?[{key,statementNumber:index+1,referenceNumber:referenceIndex+1,title:source.title,locator:source.locator,originalRelation:evidenceLabels[source.relation],originalHref:`#${recordedProposalReferenceAnchor("proposed",claim.id,referenceIndex)}`,selections}]:[];
  }));
  if(references.length!==selected.size)return null;
  return{context,packet,evaluation:{status:draft===null?"not_supplied"as const:entries.length===0?"empty"as const:"supplied"as const,entries,references}};
 }catch{return null;}
}
export type EvaluationPreparationReading=NonNullable<ReturnType<typeof evaluationPreparationReading>>;
