import { z } from "zod";
export const SOURCE_LANGUAGE_SIDECAR_BYTES=65_536;
export const SOURCE_LANGUAGE_SIDECAR_SOURCES=120;
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const instant=z.iso.datetime({offset:true}).refine(value=>!value.startsWith('0000-')&&(value.match(/\.(\d+)/)?.[1].length??0)<=9);
const identity={publicationId:z.uuid(),revision:z.number().int().positive(),baseSnapshotSha256:sha};
const source=z.strictObject({sourceVersionId:z.uuid(),contentSha256:sha,
 originalLanguage:z.string().min(1).max(160).refine(value=>value===value.trim(),"Noncanonical source-language wording").nullable()});
// Separate local candidate only. A source-described label is not an ISO tag,
// detection result, translated title or a new default public snapshot field.
export const sourceLanguageSidecarSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('source_language_sidecar_candidate'),...identity,
 sources:z.array(source).min(1).max(SOURCE_LANGUAGE_SIDECAR_SOURCES).refine(values=>new Set(values.map(value=>value.sourceVersionId.toLowerCase())).size===values.length,"Repeated source identity")});
export const sourceLanguageReviewSchema=z.strictObject({...identity,sidecarSha256:sha,sourceVersionId:z.uuid(),contentSha256:sha,decision:z.literal('accepted'),reviewedAt:instant});
export const sourceLanguageFinalReviewSchema=z.strictObject({...identity,sidecarSha256:sha,decision:z.literal('accepted'),reviewedAt:instant});
export type SourceLanguageSidecar=z.infer<typeof sourceLanguageSidecarSchema>;
export type SourceLanguageReview=z.infer<typeof sourceLanguageReviewSchema>;
export type SourceLanguageFinalReview=z.infer<typeof sourceLanguageFinalReviewSchema>;
export function sourceLanguageSidecarJson(input:unknown):string|null {
 try{const value=sourceLanguageSidecarSchema.parse(input),raw=JSON.stringify(value,null,2);return new TextEncoder().encode(raw).byteLength<=SOURCE_LANGUAGE_SIDECAR_BYTES?raw:null;}catch{return null;}
}
