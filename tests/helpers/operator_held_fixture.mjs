import {heldCheckNames} from '../../src/operator-held-decisions.ts';
export const heldId=n=>`98000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const heldScope=(cursor=null)=>({runId:heldId(1),cursor});
export const bytes=x=>new TextEncoder().encode(JSON.stringify(x));
export const decisionRow=n=>({decisionId:heldId(n),decidedAt:'2026-10-05T09:01:00.000001Z',registrationId:heldId(90),sourceKey:'invented-source',
  sourceVersionId:heldId(91),qualificationId:heldId(92),qualificationRevision:1,qualificationDecision:'suspended',
  reasonCodes:['material_conflict'],undisclosedReasonCount:0,checks:Object.fromEntries(heldCheckNames.map(k=>[k,k==='no_material_conflict'?false:null])),undisclosedCheckCount:0});
export function heldReport(requested=heldScope()) {return {schemaVersion:1,status:'ok',requested,observedAt:'2026-10-05T10:00:00.000000Z',
  run:{runId:requested.runId,jurisdictionId:'invented-country',createdAt:'2026-10-05T09:00:00.000000Z'},decisions:[decisionRow(9),decisionRow(8)],more:false,nextCursor:null};}
