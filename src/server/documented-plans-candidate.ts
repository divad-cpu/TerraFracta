import type { CandidatePublicReadRows } from "../public-read-materializer.ts";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { detachPublicationCandidateData,qualifiedPublicationCandidateFrame } from "./qualified-publication-candidate-frame.ts";
import { materializeSourceLanguageSidecarFromRows } from "./source-language-sidecar.ts";
import { materializePlannedMilestoneCandidateFromRows } from "./planned-milestone-candidate.ts";
const CODE='Documented plans candidate unavailable';
function envelope(input:unknown,body:'sidecar'|'candidate'){
 const value=detachPublicationCandidateData(input,CODE);
 if(value===null||typeof value!=='object'||Array.isArray(value))throw Error(CODE);
 const keys=Object.keys(value);if(keys.length!==3||keys.some(key=>![body,'reviews','finalReview'].includes(key)))throw Error(CODE);
 return value as Record<string,unknown>;
}
// A pure conjunction of the existing candidates on one detached private frame.
// Caller still owns actual consistent authorized acquisition and factual review.
// No independently qualified result, fallback provider or public format is used.
export function materializeDocumentedPlansCandidateFromRows(rows:CandidatePublicReadRows,languageInput:unknown,milestonesInput:unknown){
 const baseRows=detachPublicationCandidateData(rows,CODE)as CandidatePublicReadRows;
 const frame=qualifiedPublicationCandidateFrame(baseRows,CODE);
 // Capture both exact input boxes before either child qualifies its metadata.
 // Descriptor callbacks may change original inputs, never this detached base.
 const language=envelope(languageInput,'sidecar'),milestones=envelope(milestonesInput,'candidate');
 const sourceLanguage=materializeSourceLanguageSidecarFromRows(baseRows,language.sidecar,language.reviews,language.finalReview);
 const plannedMilestones=materializePlannedMilestoneCandidateFromRows(baseRows,milestones.candidate,milestones.reviews,milestones.finalReview);
 const coherent=(value:{publicationId:string;revision:number;baseSnapshotSha256:string;sources:Array<{sourceVersionId:string;contentSha256:string}>})=>value.publicationId===frame.issue.publicationId&&value.revision===frame.issue.revision&&value.baseSnapshotSha256===frame.baseSnapshotSha256&&value.sources.length===frame.sources.size&&value.sources.every(source=>frame.sources.get(source.sourceVersionId)?.contentSha256===source.contentSha256);
 if(!coherent(sourceLanguage.sidecar)||!coherent(plannedMilestones.candidate)||canonicalProposalJson(sourceLanguage.issue)!==canonicalProposalJson(frame.issue)||canonicalProposalJson(plannedMilestones.issue)!==canonicalProposalJson(frame.issue))throw Error(CODE);
 return{issue:frame.issue,sourceLanguage,plannedMilestones};
}
export type QualifiedDocumentedPlansCandidate=ReturnType<typeof materializeDocumentedPlansCandidateFromRows>;
