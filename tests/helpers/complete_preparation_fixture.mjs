import {packetContext,packetParts,packetReport} from './preparation_packet_fixture.mjs';
import {preparationPacketFromParts,preparationPacketJson} from '../../src/preparation-packet.ts';
import {evaluationDraftJson,evaluationFieldLabels} from '../../src/evaluation-draft.ts';
import {evaluationPreparationBundleFromParts,evaluationPreparationBundleJson} from '../../src/evaluation-preparation-bundle.ts';
import {plannedMilestoneDraftJson} from '../../src/planned-milestone-draft.ts';
export {packetReport};
export function completeSample(){
 const context=packetContext(),ev=context.claims.find(c=>c.type==='evaluation'),policy=context.claims.find(c=>c.type==='policy_action');
 const evaluation={schemaVersion:1,kind:'evaluation_preparation',binding:context.binding,entries:[{claimId:ev.id,fields:Object.fromEntries(Object.keys(evaluationFieldLabels).map(key=>[key,key==='finding'?{wording:'Invented uncertain evaluated finding',references:[{claimId:ev.id,referenceNumber:2}]}:null]))}]};
 const milestones={schemaVersion:1,kind:'planned_milestone_preparation',binding:context.binding,entries:[{claimId:policy.id,fields:{
  description:{wording:'Invented documented future target',references:[{claimId:policy.id,referenceNumber:2},{claimId:context.claims[0].id,referenceNumber:1}]},
  targetDate:{date:{precision:'year',value:'2028'},references:[{claimId:policy.id,referenceNumber:1}]},institution:null,
  reportedDate:{date:{precision:'month',value:'2026-09'},references:[{claimId:policy.id,referenceNumber:2}]},
 }}]};
 const packetJson=preparationPacketJson(preparationPacketFromParts(packetParts(context),context),context);
 const evaluationJson=evaluationDraftJson(evaluation,context);
 const bundle=evaluationPreparationBundleFromParts({preparationPacket:packetJson,evaluation:evaluationJson},context);
 return {context,milestones,evaluation,packetJson,evaluationJson,bundle,bundleJson:evaluationPreparationBundleJson(bundle,context),milestoneJson:plannedMilestoneDraftJson(milestones,context)};
}
