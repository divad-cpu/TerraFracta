import { createHash } from "node:crypto";
import { z } from "zod";
import { decodeProposalCapture } from "./proposal-capture.ts";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { proposalCaptureSelectionSchema, prepareProposalCaptureCommand } from "./proposal-capture-command.ts";

// Detached preparation only. The independent full-companion digest is an
// expected identity, not authentication, factual support or omitted-raw proof.
// Keep the returned companion together with the unexecuted capture preparation.
// Its single-claim intent cannot authorize replacement of an issue snapshot;
// the existing SQL has no companion slot and supplies no durable association.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.uuid();
const intent = "single_claim_technical_review_not_issue_replacement";
const text = (maximum: number) => z.string().refine(s => Buffer.byteLength(s,"utf8") <= maximum);
const bundleSchema = z.strictObject({ payloadJson: text(16384), selectionJson: text(2048), provenanceJson: text(65536) });
const expectedSchema = z.strictObject({ selection: proposalCaptureSelectionSchema, provenanceSha256: hash,
  artifactOperationId: uuid, artifactId: uuid, requestSha256: hash, outputSha256: hash, claimId: uuid });
const scopedText = (value: unknown, maximum: number) => typeof value === "string" && value.trim().length > 0 && [...value].length <= maximum;
const sha = (s: string) => createHash("sha256").update(s,"utf8").digest("hex");
function canonical(s: string): unknown {
  const value: unknown = JSON.parse(s);
  if (canonicalProposalJson(value) !== s) throw Error();
  return value;
}
function record(value: unknown, fields?: string): Record<string,unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw Error();
  if (fields && Object.keys(value).sort().join(" ") !== fields.split(" ").sort().join(" ")) throw Error();
  return value as Record<string,unknown>;
}
export function prepareDetachedExtractionProposalCapture(bundle: unknown, expected: unknown) {
  try {
    const b = bundleSchema.parse(bundle), e = expectedSchema.parse(expected);
    if (sha(b.provenanceJson) !== e.provenanceSha256) throw Error();
    const p = record(canonical(b.provenanceJson), "artifact artifact_observed_at artifact_prepared_at artifact_stored_at claim_id context_sha256 current evidence_state full_receipt_sha256 independent_context kind payload_sha256 prepared_at previous review_date_basis schema_version scope selected_payload_sha256 selection_sha256 snapshot_intent source_date_text supplied_context_sha256");
    if (p.schema_version !== 1 || p.kind !== "detached_private_extraction_proposal" || p.scope !== "invented_offline_rehearsal_only" ||
      p.evidence_state !== "unverified_not_captured_no_durable_association" || p.snapshot_intent !== intent ||
      p.review_date_basis !== "independently_supplied_not_inferred" || p.claim_id !== e.claimId ||
      p.payload_sha256 !== sha(b.payloadJson) || p.selection_sha256 !== sha(b.selectionJson)) throw Error();
    const a = record(p.artifact,"operation_id artifact_id request_sha256 output_sha256"), c = record(p.independent_context);
    if (a.operation_id !== e.artifactOperationId || a.artifact_id !== e.artifactId || a.request_sha256 !== e.requestSha256 || a.output_sha256 !== e.outputSha256 ||
      c.snapshot_intent !== intent || p.context_sha256 !== sha(canonicalProposalJson(c)) || canonicalProposalJson(c.artifact) !== canonicalProposalJson(a)) throw Error();
    const s = proposalCaptureSelectionSchema.parse(canonical(b.selectionJson));
    if (canonicalProposalJson(s) !== b.selectionJson || canonicalProposalJson(s) !== canonicalProposalJson(e.selection)) throw Error();
    const held = record(c.held), issue = record(c.issue), head = record(issue.head), content = record(c.content), support = record(c.support);
    if (held.run_id !== s.runId || held.decision_id !== s.decisionId || held.disposition !== "held" || issue.issue_id !== s.issueId ||
      head.publication_id !== s.basePublicationId || content.capture_id !== s.captureId || content.claim_id !== e.claimId || support.assignment_state !== "proposed_only") throw Error();
    const capturePreparation = prepareProposalCaptureCommand(s,canonical(b.payloadJson));
    if (capturePreparation.values[5] !== b.payloadJson || capturePreparation.proposalSha256 !== p.payload_sha256) throw Error();
    const payload = decodeProposalCapture(b.payloadJson,capturePreparation.proposalSha256);
    const snapshot = payload.snapshot, current = record(p.current), translation = record(c.translation);
    if (![held.item_key,current.item_key].every(v => scopedText(v,120)) ||
      ![held.jurisdiction_id,issue.jurisdiction_id].every(v => scopedText(v,80)) || c.schema_version !== 1 || c.kind !== "invented_detached_extraction_context" || payload.conflictCoverage !== "not_recorded" ||
      snapshot.claims.length !== 1 || snapshot.jurisdictionSlug !== issue.jurisdiction_slug || snapshot.issueSlug !== issue.issue_slug ||
      snapshot.title !== content.title || snapshot.summary !== content.summary || snapshot.lastEvidenceReviewOn !== content.last_evidence_review_on ||
      content.review_date_basis !== p.review_date_basis || issue.jurisdiction_id !== held.jurisdiction_id ||
      payload.translation.displayLanguage !== translation.display_language || payload.translation.status !== translation.status ||
      !["not_recorded","unreviewed"].includes(payload.translation.status) || payload.translation.displayLanguage !== current.language_code ||
      payload.dependencyManifest.sourceVersionIds.length !== 1 || payload.dependencyManifest.sourceVersionIds[0] !== current.source_version_id) throw Error();
    const claim = snapshot.claims[0]!;
    if (claim.id !== e.claimId || claim.assertion !== support.assertion || claim.type !== support.claim_type ||
      claim.periodLabel !== content.period_label || claim.evidence.length !== 1) throw Error();
    const evidence = claim.evidence[0]!;
    if (support.relation !== "supports" || evidence.relation !== support.relation || evidence.sourceVersionId !== support.source_version_id ||
      support.source_version_id !== current.source_version_id || support.content_sha256 !== current.content_sha256 ||
      evidence.locator !== support.locator || evidence.url !== current.source_url || evidence.retrievedAt !== current.retrieved_at ||
      evidence.publisher !== content.publisher || evidence.title !== content.source_title || evidence.sourcePublishedOn !== content.source_published_on ||
      held.source_version_id !== current.source_version_id || held.content_sha256 !== current.content_sha256 ||
      held.item_key !== current.item_key || held.locator !== evidence.locator) throw Error();
    // The unchanged strict encoder owns complete payload syntax/normalization.
    // The separately expected opaque companion owns the full witnessed context;
    // this admission does not reconstruct Python's omitted originals/output.
    return Object.freeze({ capturePreparation, provenanceJson: b.provenanceJson, provenanceSha256: e.provenanceSha256,
      evidenceState: "invented_unverified_detached_not_captured" as const, snapshotIntent: intent });
  } catch { throw Error("private_extraction_held_preparation_unavailable"); }
}
