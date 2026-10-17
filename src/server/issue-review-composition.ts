import { createHash } from "node:crypto";
import { canonicalProposalJson, recordedProposalBaseSchema, proposalCapturePayloadSchema, type ProposalCapturePayload } from "../operator-proposal-capture.ts";
import { encodeProposalCapture } from "./proposal-capture.ts";
import { prepareProposalCaptureCommand, type PreparedProposalCapture } from "./proposal-capture-command.ts";

// Internal structural engine. A format wrapper must admit its complete report,
// proof, independent expectations and observation first. This is not a format
// reader or a capture/publication authorization boundary.
export type IssueReviewBundle = Readonly<{candidateReportJson:string;baselineJson:string;canonicalBaselineJson:string;contextJson:string;proposalJson:string;compositionJson:string}>;
type Context = Readonly<{
 baseline:{publication_id:string;issue_id:string;content_sha256:string;head_changed_at:string;head_observed_at:string};
 page:{title:string;summary:string;last_evidence_review_on:string};
 review:{translation:{display_language:string;status:"not_recorded"|"unreviewed"}};
}>;
type Candidate = Readonly<{
 selection:PreparedProposalCapture["selection"];
 snapshot:ProposalCapturePayload["snapshot"];
 head:{content_sha256:string|null;changed_at:string|null};
 headObservedAt:string;
 language:string;
}>;
type Proof = Readonly<{proposal_sha256:string;preserved_claim_sha256:readonly string[];appended_claim_sha256:string;source_manifest_sha256:string}>;
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
function canonical(s:string):unknown{const v:unknown=JSON.parse(s);if(canonicalProposalJson(v)!==s)throw Error();return v;}
function same(a:unknown,b:unknown){return canonicalProposalJson(a)===canonicalProposalJson(b);}
function sourceIds(claims:ProposalCapturePayload["snapshot"]["claims"]){
 const sources=new Map<string,{id:string;signature:string}>(),cited:string[]=[];
 for(const claim of claims)for(const evidence of claim.evidence){
  const {locator:_locator,relation:_relation,...identity}=evidence,key=evidence.sourceVersionId.toLowerCase(),signature=canonicalProposalJson(identity),old=sources.get(key);
  if(old!==undefined&&(old.id!==evidence.sourceVersionId||old.signature!==signature))throw Error();
  if(old===undefined)cited.push(evidence.sourceVersionId);sources.set(key,{id:evidence.sourceVersionId,signature});
 }return cited;
}
export function admitIssueReviewStructure(b:IssueReviewBundle,baselineSha256:string,proof:Proof,context:Context,candidate:Candidate,strictPageBoundary:boolean){
 const witness=context.baseline,head=candidate.head;
 if(witness.publication_id!==candidate.selection.basePublicationId||witness.issue_id!==candidate.selection.issueId||witness.content_sha256!==head.content_sha256||
  witness.head_changed_at!==head.changed_at||witness.head_observed_at!==candidate.headObservedAt||witness.content_sha256!==baselineSha256||
  context.review.translation.display_language!==candidate.language)throw Error();
 const baselineRaw=canonical(b.canonicalBaselineJson),baseline=recordedProposalBaseSchema.parse(baselineRaw);
 if(!same(baselineRaw,baseline)||!same(JSON.parse(b.baselineJson),baseline)||baseline.id!==witness.publication_id||baseline.issueId!==witness.issue_id||
  baseline.snapshot.jurisdictionSlug!==candidate.snapshot.jurisdictionSlug||baseline.snapshot.issueSlug!==candidate.snapshot.issueSlug||baseline.snapshot.claims.length>29)throw Error();
 const translation={displayLanguage:context.review.translation.display_language,status:context.review.translation.status};
 proposalCapturePayloadSchema.parse({schemaVersion:1,kind:"review_only",snapshot:baseline.snapshot,dependencyManifest:baseline.dependencyManifest,conflictCoverage:"not_recorded",translation});
 if(strictPageBoundary)for(const value of [context.page.title,context.page.summary])
  if(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u.test(value)||/[\u0000-\u0008\u000b-\u001f]/u.test(value))throw Error();
 const append=candidate.snapshot.claims[0]!;
 if(baseline.snapshot.claims.some(claim=>claim.id.toLowerCase()===append.id.toLowerCase()))throw Error();
 const claims=[...baseline.snapshot.claims,append],cited=sourceIds(claims),ids=[...baseline.dependencyManifest.sourceVersionIds,...cited.filter(id=>!baseline.dependencyManifest.sourceVersionIds.includes(id))];
 const proposed={schemaVersion:1,kind:"review_only",snapshot:{schemaVersion:1,jurisdictionSlug:baseline.snapshot.jurisdictionSlug,issueSlug:baseline.snapshot.issueSlug,
  title:context.page.title,summary:context.page.summary,lastEvidenceReviewOn:context.page.last_evidence_review_on,claims},dependencyManifest:{sourceVersionIds:ids},conflictCoverage:"not_recorded",translation};
 const encoded=encodeProposalCapture(proposed);
 if(encoded.proposalJson!==b.proposalJson||encoded.proposalSha256!==proof.proposal_sha256||
  !same(proof.preserved_claim_sha256,baseline.snapshot.claims.map(claim=>sha(canonicalProposalJson(claim))))||proof.appended_claim_sha256!==sha(canonicalProposalJson(append))||
  proof.source_manifest_sha256!==sha(canonicalProposalJson(proposed.dependencyManifest)))throw Error();
 const transfer=canonicalProposalJson(Object.fromEntries([['candidate_report',b.candidateReportJson],['baseline',b.baselineJson],['canonical_baseline',b.canonicalBaselineJson],['context',b.contextJson],['proposal',b.proposalJson],['composition',b.compositionJson]].map(([key,value])=>[key+'_base64',Buffer.from(value!,'utf8').toString('base64')])));
 if(Buffer.byteLength(transfer,'utf8')>126976)throw Error();
 const capturePreparation=prepareProposalCaptureCommand(candidate.selection,proposed);
 return Object.freeze({capturePreparation,encoded,baselineClaimCount:baseline.snapshot.claims.length});
}
