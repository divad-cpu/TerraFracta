import {inventedPrivateReadRows}from'../../src/synthetic-private-read-rows.ts';
import {sixStageEvidenceRows}from'../../app/evidence-preview/six-stage-example.ts';
import {plannedMilestoneSnapshotSha256,plannedMilestoneCandidateSha256}from'../../src/server/planned-milestone-candidate.ts';
import {suppliedPlannedMilestoneFields}from'../../src/planned-milestone-candidate.ts';
// Explicit invented content fingerprints and accepted-looking fixture records.
// None is a factual source, actual reviewer assignment or publication decision.
export function plannedMilestoneSample(){
 const rows=inventedPrivateReadRows(sixStageEvidenceRows()),hashes=['a','b','c','d','e','f','1'];if(rows.sources.length!==hashes.length)throw Error('Invented fixture shape changed');rows.sources.forEach((source,index)=>source.version.content_sha256=hashes[index].repeat(64));
 const claim=rows.publication.snapshot.claims.find(claim=>claim.type==='policy_action'),ref={claimId:claim.id,referenceNumber:1,relation:'supports'};
 const candidate={schemaVersion:1,kind:'planned_milestone_candidate',publicationId:rows.publication.id,revision:rows.publication.revision,baseSnapshotSha256:plannedMilestoneSnapshotSha256(rows.publication.snapshot),sources:rows.sources.map(source=>({sourceVersionId:source.version.id,contentSha256:source.version.content_sha256})),entries:[{claimId:claim.id,fields:{description:{wording:'The fictional source describes a planned assessment; delivery unestablished',references:[ref]},targetDate:{date:{precision:'year',value:'2027'},references:[ref]},institution:null,reportedDate:null}}]};
 return plannedMilestoneReviewed(rows,candidate);
}
export function plannedMilestoneReviewed(rows,candidate){
 const header={publicationId:candidate.publicationId,revision:candidate.revision,baseSnapshotSha256:candidate.baseSnapshotSha256,candidateSha256:plannedMilestoneCandidateSha256(candidate),decision:'accepted'};
 return{rows,candidate,reviews:suppliedPlannedMilestoneFields(candidate).map(({path})=>({...header,fieldPath:path,reviewedAt:'2026-09-25T13:15:00.000000001Z'})),finalReview:{...header,reviewedAt:'2026-09-25T14:00:00.000000001Z'}};
}
