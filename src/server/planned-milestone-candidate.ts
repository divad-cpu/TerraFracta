import { createHash } from "node:crypto";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import type { CandidatePublicReadRows } from "../public-read-materializer.ts";
import { compareRecordedInstants } from "../recorded-instant-order.ts";
import { scopeReferenceKey } from "../issue-scope-draft.ts";
import { detachPublicationCandidateData,publicationCandidateSnapshotSha256,qualifiedPublicationCandidateFrame } from "./qualified-publication-candidate-frame.ts";
import { plannedMilestoneCandidateSchema,plannedMilestoneCandidateJson,plannedMilestoneReviewSchema,plannedMilestoneFinalReviewSchema,suppliedPlannedMilestoneFields } from "../planned-milestone-candidate.ts";
const CODE='Planned milestone candidate unavailable';
const detach=(value:unknown)=>detachPublicationCandidateData(value,CODE);
export function plannedMilestoneSnapshotSha256(value:unknown){return publicationCandidateSnapshotSha256(value,CODE);}
export function plannedMilestoneCandidateSha256(input:unknown){const value=plannedMilestoneCandidateSchema.parse(detach(input));if(plannedMilestoneCandidateJson(value)===null)throw Error(CODE);return createHash('sha256').update(canonicalProposalJson(value),'utf8').digest('hex');}

// Pure candidate qualification. Trusted consistent authorized acquisition and
// actual source/editorial decisions remain the caller's independent obligations.
export function materializePlannedMilestoneCandidateFromRows(rows:CandidatePublicReadRows,candidateInput:unknown,reviewsInput:unknown,finalInput:unknown){
 const {issue,baseSnapshotSha256,baseFinalReviewedAt,sources}=qualifiedPublicationCandidateFrame(rows,CODE);
 const candidate=plannedMilestoneCandidateSchema.parse(detach(candidateInput));if(plannedMilestoneCandidateJson(candidate)===null)throw Error(CODE);
 const candidateSha256=plannedMilestoneCandidateSha256(candidate),rawReviews=detach(reviewsInput);
 if(!Array.isArray(rawReviews)||rawReviews.length>32)throw Error(CODE);
 const reviews=rawReviews.map(value=>plannedMilestoneReviewSchema.parse(value)),final=plannedMilestoneFinalReviewSchema.parse(detach(finalInput));
 const same=(value:{publicationId:string;revision:number;baseSnapshotSha256:string;candidateSha256:string})=>value.publicationId===issue.publicationId&&value.revision===issue.revision&&value.baseSnapshotSha256===baseSnapshotSha256&&value.candidateSha256===candidateSha256;
 if(candidate.publicationId!==issue.publicationId||candidate.revision!==issue.revision||candidate.baseSnapshotSha256!==baseSnapshotSha256||candidate.sources.length!==sources.size||candidate.sources.some(source=>sources.get(source.sourceVersionId)?.contentSha256!==source.contentSha256)||!same(final)||compareRecordedInstants(final.reviewedAt,baseFinalReviewedAt)<0)throw Error(CODE);
 const claims=new Map(issue.claims.map(claim=>[claim.id,claim])),seenEntries=new Set<string>();
 for(const entry of candidate.entries){const claim=claims.get(entry.claimId);if(!claim||(claim.type!=='policy_action'&&claim.type!=='delivery'))throw Error(CODE);const key=canonicalProposalJson(entry);if(seenEntries.has(key))throw Error(CODE);seenEntries.add(key);}
 const fields=suppliedPlannedMilestoneFields(candidate),byPath=new Map(reviews.map(review=>[review.fieldPath,review]));
 if(byPath.size!==reviews.length||reviews.length!==fields.length||reviews.some(review=>!fields.some(field=>field.path===review.fieldPath)))throw Error(CODE);
 for(const {path,field}of fields){
  const review=byPath.get(path);if(!review||!same(review)||compareRecordedInstants(review.reviewedAt,final.reviewedAt)>0)throw Error(CODE);
  const seen=new Set<string>();
  for(const ref of field.references){const source=claims.get(ref.claimId)?.evidence[ref.referenceNumber-1],key=scopeReferenceKey(ref.claimId,ref.referenceNumber);if(!source||seen.has(key))throw Error(CODE);seen.add(key);const bound=sources.get(source.sourceVersionId);if(!bound||compareRecordedInstants(review.reviewedAt,bound.retrievedAt)<0)throw Error(CODE);}
 }
 return{issue,candidate,candidateSha256,finalReviewedAt:final.reviewedAt};
}
export type QualifiedPlannedMilestoneCandidate=ReturnType<typeof materializePlannedMilestoneCandidateFromRows>;
