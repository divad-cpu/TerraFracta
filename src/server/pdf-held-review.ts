import {createHash} from "node:crypto";
import {canonicalProposalJson} from "../operator-proposal-capture.ts";
import {pdfHeldPreparation} from "./pdf-held-preparation.ts";
import {pdfExtractionReviewReport} from "./pdf-extraction-review-report.ts";

// One passive consistency join, never an original reinspection, captured issue,
// source-authenticity check or a fresh verification timestamp. All expected byte
// identities are explicitly supplied; the report cannot supply missing context.
export function pdfHeldReview(bundle:unknown,expected:unknown,reportJson:unknown,reportSha256:unknown) {
  try {
    if(typeof reportJson!=="string" || typeof reportSha256!=="string" || !/^[a-f0-9]{64}$/.test(reportSha256) ||
      /[\ud800-\udfff]/u.test(reportJson) || Buffer.byteLength(reportJson,"utf8")>384*1024 ||
      createHash("sha256").update(reportJson,"utf8").digest("hex")!==reportSha256)return null;
    const parsed:unknown=JSON.parse(reportJson);
    if(canonicalProposalJson(parsed)!==reportJson)return null;
    const candidate=pdfHeldPreparation(bundle,expected),extraction=pdfExtractionReviewReport(parsed);
    if(!candidate || !extraction)return null;
    const p=candidate.proof,c=candidate.payload.snapshot.claims[0]!,r=extraction;
    if(canonicalProposalJson(p.current)!==canonicalProposalJson(r.current) || canonicalProposalJson(p.previous)!==canonicalProposalJson(r.previous) ||
      p.artifact.operation_id!==r.artifact.operation_id || p.artifact.request_sha256!==r.request.request_sha256 ||
      p.artifact.output_sha256!==r.artifact.output_sha256 || p.selected_payload_sha256!==r.request.selected_payload_sha256 ||
      p.recorded_observed_at!==r.recorded_observed_at || p.artifact_prepared_at!==r.prepared_at || p.artifact_observed_at!==r.reopened_at ||
      c.assertion!==r.proposal.proposed_assertion || c.type!==r.proposal.proposed_claim_type || c.evidence[0]!.locator!==r.proposal.locator ||
      p.source_date_text!==r.proposal.source_date_text)return null;
    const freeze=(v:unknown):void=>{if(v!==null && typeof v==="object"){for(const child of Object.values(v))freeze(child);Object.freeze(v);}};
    freeze(extraction);
    return Object.freeze({candidate,extraction,reportJson,reportSha256,qualification:"supplied_consistency_only" as const});
  }catch{return null;}
}
