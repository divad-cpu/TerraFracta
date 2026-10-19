import { createHash } from "node:crypto";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import type { CandidatePublicReadRows } from "../public-read-materializer.ts";
import { detachPublicationCandidateData,publicationCandidateSnapshotSha256,qualifiedPublicationCandidateFrame } from "./qualified-publication-candidate-frame.ts";
import { compareRecordedInstants } from "../recorded-instant-order.ts";
import { sourceLanguageSidecarSchema,sourceLanguageSidecarJson,sourceLanguageReviewSchema,sourceLanguageFinalReviewSchema,SOURCE_LANGUAGE_SIDECAR_SOURCES } from "../source-language-sidecar.ts";

const sha=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
const CODE='Source-language candidate unavailable';
const detach=(input:unknown)=>detachPublicationCandidateData(input,CODE);
export function sourceLanguageSnapshotSha256(input:unknown):string {return publicationCandidateSnapshotSha256(input,CODE);}
export function sourceLanguageSidecarSha256(input:unknown):string {
 const sidecar=sourceLanguageSidecarSchema.parse(detach(input));if(sourceLanguageSidecarJson(sidecar)===null)throw Error(CODE);
 return sha(canonicalProposalJson(sidecar));
}

// Pure qualification, not a database read. Caller still owns consistent,
// authorized acquisition. No source/provider/writer/grant is configured here.
export function materializeSourceLanguageSidecarFromRows(rows:CandidatePublicReadRows,sidecarInput:unknown,languageReviewsInput:unknown,finalReviewInput:unknown){
 // Seal every base field before any sidecar/review descriptor can execute code.
 const {issue,baseSnapshotSha256,baseFinalReviewedAt:baseFinal,sources}=qualifiedPublicationCandidateFrame(rows,CODE);
 const cited=[...sources.keys()];
 const sidecar=sourceLanguageSidecarSchema.parse(detach(sidecarInput));if(sourceLanguageSidecarJson(sidecar)===null)throw Error(CODE);
 const sidecarSha256=sourceLanguageSidecarSha256(sidecar);
 const languageReviews=detach(languageReviewsInput);if(!Array.isArray(languageReviews)||languageReviews.length>SOURCE_LANGUAGE_SIDECAR_SOURCES)throw Error(CODE);
 const reviews=languageReviews.map(value=>sourceLanguageReviewSchema.parse(value)),finalReview=sourceLanguageFinalReviewSchema.parse(detach(finalReviewInput));
 const same=(value:{publicationId:string;revision:number;baseSnapshotSha256:string;sidecarSha256:string})=>value.publicationId===issue.publicationId&&value.revision===issue.revision&&value.baseSnapshotSha256===baseSnapshotSha256&&value.sidecarSha256===sidecarSha256;
 if(sidecar.publicationId!==issue.publicationId||sidecar.revision!==issue.revision||sidecar.baseSnapshotSha256!==baseSnapshotSha256||sidecar.sources.length!==cited.length||!same(finalReview)||compareRecordedInstants(finalReview.reviewedAt,baseFinal)<0)throw Error(CODE);
 const supplied=sidecar.sources.filter(source=>source.originalLanguage!==null),reviewBySource=new Map(reviews.map(review=>[review.sourceVersionId,review]));
 if(reviewBySource.size!==reviews.length||new Set(reviews.map(review=>review.sourceVersionId.toLowerCase())).size!==reviews.length||reviews.length!==supplied.length)throw Error(CODE);
 for(const source of sidecar.sources){
  const bound=sources.get(source.sourceVersionId);if(!bound||bound.contentSha256!==source.contentSha256)throw Error(CODE);
  const review=reviewBySource.get(source.sourceVersionId);
  if(source.originalLanguage===null){if(review!==undefined)throw Error(CODE);continue;}
  if(!review||!same(review)||review.contentSha256!==source.contentSha256||compareRecordedInstants(review.reviewedAt,bound.retrievedAt)<0||compareRecordedInstants(review.reviewedAt,finalReview.reviewedAt)>0)throw Error(CODE);
 }
 return{issue,sidecar,sidecarSha256,finalReviewedAt:finalReview.reviewedAt};
}
export type QualifiedSourceLanguageSidecar=ReturnType<typeof materializeSourceLanguageSidecarFromRows>;
