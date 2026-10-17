import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { proposalCaptureSelectionSchema } from "./proposal-capture-command.ts";
import { prepareDetachedExtractionProposalCapture } from "./private-extraction-held-proposal.ts";
import { decodeProposalCapture } from "./proposal-capture.ts";
import { privateExtractionReport } from "./private-extraction-report.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

// Passive consistency admission. Expected report/intent bytes identify what the
// caller meant to inspect; they authenticate neither storage nor source rights.
// Python re-admits full custody. This consumer does not replay omitted originals
// or parse original context spelling for duplicate-key semantics.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s => !s.startsWith("0000-"));
const text = (maximum: number) => z.string().refine(s => !/[\ud800-\udfff]/u.test(s) && Buffer.byteLength(s,"utf8") > 0 && Buffer.byteLength(s,"utf8") <= maximum);
const metadataSchema = z.strictObject({ schema_version: z.literal(1), kind: z.literal("invented_detached_proposal_preparation"),
  operation_id: uuid, extraction_operation_id: uuid, extraction_artifact_id: uuid,
  extraction_request_sha256: hash, extraction_output_sha256: hash,
  payload_sha256: hash, selection_sha256: hash, provenance_sha256: hash, context_raw_sha256: hash, prepared_at: instant });
const expectedSchema = z.strictObject({ reportSha256: hash, preparationIntentJson: text(4096) });
const schema = z.strictObject({ schema_version: z.literal(1), kind: z.literal("invented_detached_preparation_review"),
  scope: z.literal("invented_offline_rehearsal_only"), review_state: z.literal("unverified"),
  evidence_state: z.literal("historical_preparation_not_current_qualification_or_held_capture"), observed_at: instant,
  preparation: z.strictObject({ operation_id: uuid, artifact_id: uuid, prepared_at: instant,
    historical_artifact_observed_at: instant, stored_at: instant, full_receipt_sha256: hash }),
  intent_json: text(4096), parts: z.strictObject({ payload_json: text(16384), selection_json: text(2048), provenance_json: text(65536), context_json: text(32768) }),
  extraction_report: z.unknown() });
const historySchema = z.object({ held: z.object({ decided_at: instant }), issue: z.object({ created_at: instant, observed_at: instant,
  head: z.strictObject({ publication_id: uuid.nullable(), content_sha256: hash.nullable(), changed_at: instant.nullable() }) }),
  content: z.object({ last_evidence_review_on: z.iso.date() }) });
const sha = (s: string) => createHash("sha256").update(s,"utf8").digest("hex");
function canonical(s: string): unknown { const value: unknown = JSON.parse(s); if (canonicalProposalJson(value) !== s) throw Error(); return value; }
function record(value: unknown): Record<string,unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw Error(); return value as Record<string,unknown>; }

export function detachedPreparationReport(raw: unknown, expected: unknown) {
  try {
    const input = text(262144).parse(raw), e = expectedSchema.parse(expected);
    if (sha(input) !== e.reportSha256) throw Error();
    const r = schema.parse(canonical(input));
    if (r.intent_json !== e.preparationIntentJson) throw Error();
    const meta = metadataSchema.parse(canonical(r.intent_json)), p = r.preparation, b = r.parts;
    if (meta.operation_id !== p.operation_id || meta.prepared_at !== p.prepared_at ||
      sha(b.payload_json) !== meta.payload_sha256 || sha(b.selection_json) !== meta.selection_sha256 ||
      sha(b.provenance_json) !== meta.provenance_sha256 || sha(b.context_json) !== meta.context_raw_sha256) throw Error();
    const proof = record(canonical(b.provenance_json)), selection = proposalCaptureSelectionSchema.parse(canonical(b.selection_json));
    prepareDetachedExtractionProposalCapture({payloadJson:b.payload_json,selectionJson:b.selection_json,provenanceJson:b.provenance_json},
      {selection,provenanceSha256:meta.provenance_sha256,artifactOperationId:meta.extraction_operation_id,artifactId:meta.extraction_artifact_id,
        requestSha256:meta.extraction_request_sha256,outputSha256:meta.extraction_output_sha256,claimId:proof.claim_id});
    const payload = decodeProposalCapture(b.payload_json,meta.payload_sha256), extraction = privateExtractionReport(r.extraction_report);
    if (extraction === null) throw Error();
    const history = historySchema.parse(proof.independent_context), claim = payload.snapshot.claims[0]!;
    if (proof.supplied_context_sha256 !== meta.context_raw_sha256 || proof.prepared_at !== p.prepared_at ||
      proof.artifact_observed_at !== p.historical_artifact_observed_at || proof.artifact_prepared_at !== extraction.prepared_at ||
      proof.artifact_stored_at !== extraction.artifact.stored_at ||
      canonicalProposalJson(proof.current) !== canonicalProposalJson(extraction.current) || canonicalProposalJson(proof.previous) !== canonicalProposalJson(extraction.previous) ||
      proof.selected_payload_sha256 !== extraction.request.selected_payload_sha256 || proof.source_date_text !== extraction.proposal.source_date_text ||
      meta.extraction_operation_id !== extraction.artifact.operation_id || meta.extraction_artifact_id !== extraction.artifact.artifact_id ||
      meta.extraction_request_sha256 !== extraction.request.request_sha256 || meta.extraction_output_sha256 !== extraction.artifact.output_sha256 ||
      claim.assertion !== extraction.proposal.proposed_assertion || claim.type !== extraction.proposal.proposed_claim_type || claim.evidence[0]!.locator !== extraction.proposal.locator) throw Error();
    const ordered = [extraction.artifact.stored_at,p.historical_artifact_observed_at,p.prepared_at,p.stored_at,extraction.observed_at,r.observed_at];
    if (ordered.some((at,i) => i > 0 && micros(at) < micros(ordered[i-1]!)) ||
      micros(history.held.decided_at) < micros(extraction.artifact.stored_at) || micros(history.held.decided_at) > micros(history.issue.observed_at) ||
      micros(history.issue.created_at) > micros(history.issue.observed_at) || micros(history.issue.observed_at) > micros(p.prepared_at) ||
      history.content.last_evidence_review_on > p.prepared_at.slice(0,10)) throw Error();
    const head = history.issue.head;
    if (head.publication_id === null ? head.content_sha256 !== null || head.changed_at !== null :
      head.content_sha256 === null || head.changed_at === null || micros(head.changed_at) < micros(history.issue.created_at) || micros(head.changed_at) > micros(history.issue.observed_at)) throw Error();
    return Object.freeze({ preparation:p,metadata:meta,parts:b,selection,snapshot:payload.snapshot,history,extraction,observedAt:r.observed_at,
      reportSha256:e.reportSha256,evidenceState:r.evidence_state });
  } catch { return null; }
}

// Reuse the identical closed intent shape in metadata-only inspection.
export const detachedPreparationIntentSchema = metadataSchema;
