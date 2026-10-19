import {sample}from'./public_read_rows_fixture.mjs';
import {sourceLanguageSnapshotSha256,sourceLanguageSidecarSha256}from'../../src/server/source-language-sidecar.ts';
// Invented metadata/reviews only, not factual/source/actor qualification.
export function sourceLanguageSample(){
 const rows=sample(),hashes=['a'.repeat(64),'b'.repeat(64)];if(rows.sources.length!==hashes.length)throw Error('Invented source fixture shape changed');
 rows.sources.forEach((source,index)=>source.version.content_sha256=hashes[index]);
 const sidecar={schemaVersion:1,kind:'source_language_sidecar_candidate',publicationId:rows.publication.id,revision:rows.publication.revision,baseSnapshotSha256:sourceLanguageSnapshotSha256(rows.publication.snapshot),sources:rows.sources.map((source,index)=>({sourceVersionId:source.version.id,contentSha256:source.version.content_sha256,originalLanguage:index===0?'Norwegian, source-described in this invented exercise':null}))};
 return sourceLanguageReviewed(rows,sidecar);
}
export function sourceLanguageReviewed(rows,sidecar){
 const sidecarSha256=sourceLanguageSidecarSha256(sidecar),header={publicationId:sidecar.publicationId,revision:sidecar.revision,baseSnapshotSha256:sidecar.baseSnapshotSha256,sidecarSha256,decision:'accepted'};
 const reviews=sidecar.sources.filter(s=>s.originalLanguage!==null).map(source=>({...header,sourceVersionId:source.sourceVersionId,contentSha256:source.contentSha256,reviewedAt:'2026-09-25T13:15:00.000000001Z'}));
 const finalReview={...header,reviewedAt:'2026-09-25T14:00:00.000000001Z'};
 return{rows,sidecar,reviews,finalReview};
}
