import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { decodeProposalCapture } from "./proposal-capture.ts";
import { proposalCaptureSelectionSchema } from "./proposal-capture-command.ts";
import { htmlExtractionReviewReport } from "./html-extraction-review-report.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

// Passive consistency only. The separately supplied report/intent identify
// intended bytes; this consumer authenticates neither storage nor context.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s => !s.startsWith("0000-"));
const text = (maximum: number) => z.string().refine(s => !/[\ud800-\udfff]/u.test(s) && Buffer.byteLength(s,"utf8") > 0 && Buffer.byteLength(s,"utf8") <= maximum);
// Python str.strip whitespace and _text control/code-point limits. Do not
// normalize independently supplied text or count astral characters twice.
const contextText = (maximum: number) => z.string().refine(s =>
  [...s].length >= 1 && [...s].length <= maximum && !/[\ud800-\udfff]/u.test(s) &&
  !/[\u0000-\u0008\u000b-\u001f]/u.test(s) &&
  !/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u.test(s));
const calendarDate = z.iso.date().refine(s => !s.startsWith("0000-"));
const metadata = z.strictObject({ schema_version: z.literal(1), kind: z.literal("invented_detached_html_proposal_preparation"),
  operation_id: uuid, extraction_operation_id: uuid, extraction_artifact_id: uuid, extraction_request_sha256: hash, extraction_output_sha256: hash,
  payload_sha256: hash, selection_sha256: hash, provenance_sha256: hash, context_raw_sha256: hash, prepared_at: instant });
const expectedSchema = z.strictObject({ reportSha256: hash, preparationIntentJson: text(4096) });
const schema = z.strictObject({ schema_version: z.literal(1), kind: z.literal("private_html_preparation_review_report"), scope: z.literal("invented_supplied_full_receipts_only"),
  review_state: z.literal("unverified"), observed_at: instant,
  preparation: z.strictObject({ operation_id: uuid, artifact_id: uuid, prepared_at: instant, stored_at: instant,
    historical_artifact_observed_at: instant, metadata_sha256: hash, receipt_sha256: hash }),
  intent_json: text(4096), payload_json: text(16384), selection_json: text(2048), provenance_json: text(65536), extraction: z.unknown(),
  limits: z.strictObject({ original_html_included: z.literal(false), request_body_included: z.literal(false), output_body_included: z.literal(false),
    raw_context_included: z.literal(false), independent_intent_authenticated: z.literal(false), current_qualification_established: z.literal(false),
    held_capture_observed: z.literal(false), current_publication_observed: z.literal(false), publication_authorized: z.literal(false) }) });
const historySchema = z.object({ held: z.object({ decided_at: instant }), issue: z.object({ created_at: instant, observed_at: instant,
  head: z.strictObject({ publication_id: uuid.nullable(), content_sha256: hash.nullable(), changed_at: instant.nullable() }) }),
  content: z.object({ last_evidence_review_on: calendarDate }) });
const sha = (s: string) => createHash("sha256").update(s,"utf8").digest("hex");
function canonical(raw: string): unknown {
  const value: unknown = JSON.parse(raw); let nodes = 0;
  function scalars(v: unknown, depth: number): void {
    if (++nodes > 25000 || depth > 32) throw Error();
    if (typeof v === "string" && /[\ud800-\udfff]/u.test(v)) throw Error();
    if (Array.isArray(v)) v.forEach(item => scalars(item,depth+1));
    else if (v !== null && typeof v === "object") for (const [key,item] of Object.entries(v)) { scalars(key,depth+1);scalars(item,depth+1); }
  }
  scalars(value,0);
  if (canonicalProposalJson(value) !== raw) throw Error();
  return value;
}
function record(value: unknown, fields: string): Record<string,unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(" ") !== fields.split(" ").sort().join(" ")) throw Error();
  return value as Record<string,unknown>;
}
function independentExpected(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw Error();
  const keys=Reflect.ownKeys(value);
  if (keys.length!==2 || keys.some(key => key!=="reportSha256" && key!=="preparationIntentJson")) throw Error();
  for (const key of keys) { const d=Object.getOwnPropertyDescriptor(value,key);if (!d?.enumerable || !("value" in d)) throw Error(); }
  return expectedSchema.parse(value);
}

export function htmlPreparationReviewReport(raw: unknown, expected: unknown) {
  try {
    const input=text(512*1024).parse(raw), e=independentExpected(expected);
    if (sha(input)!==e.reportSha256) throw Error();
    const r=schema.parse(canonical(input));
    if (r.intent_json!==e.preparationIntentJson) throw Error();
    const m=metadata.parse(canonical(r.intent_json)), p=r.preparation;
    if (m.operation_id!==p.operation_id || m.prepared_at!==p.prepared_at || sha(r.intent_json)!==p.metadata_sha256 ||
      sha(r.payload_json)!==m.payload_sha256 || sha(r.selection_json)!==m.selection_sha256 || sha(r.provenance_json)!==m.provenance_sha256) throw Error();
    const proof=record(canonical(r.provenance_json),"schema_version kind scope evidence_state snapshot_intent artifact current previous full_receipt_sha256 extraction_metadata_sha256 selected_payload_sha256 independent_context context_sha256 supplied_context_sha256 artifact_prepared_at artifact_stored_at artifact_observed_at payload_sha256 selection_sha256 claim_id source_date_text review_date_basis prepared_at");
    const selection=proposalCaptureSelectionSchema.parse(canonical(r.selection_json)), payload=decodeProposalCapture(r.payload_json,m.payload_sha256), extraction=htmlExtractionReviewReport(r.extraction);
    if (!extraction || proof.schema_version!==1 || proof.kind!=="detached_html_extraction_proposal" || proof.scope!==r.scope ||
      proof.evidence_state!=="unverified_not_captured_no_durable_association" || proof.snapshot_intent!=="single_claim_technical_review_not_issue_replacement" ||
      proof.review_date_basis!=="independently_supplied_not_inferred" || proof.payload_sha256!==m.payload_sha256 || proof.selection_sha256!==m.selection_sha256 ||
      proof.supplied_context_sha256!==m.context_raw_sha256 || proof.prepared_at!==p.prepared_at || proof.artifact_observed_at!==p.historical_artifact_observed_at ||
      proof.artifact_prepared_at!==extraction.prepared_at || proof.artifact_stored_at!==extraction.artifact.stored_at ||
      proof.extraction_metadata_sha256!==extraction.artifact.metadata_sha256 || proof.full_receipt_sha256!==extraction.artifact.receipt_sha256 ||
      proof.selected_payload_sha256!==extraction.inspection.request!.selected_payload_sha256 || proof.source_date_text!==extraction.proposal.source_date_text ||
      extraction.observed_at!==r.observed_at) throw Error();
    const a={operation_id:extraction.artifact.operation_id,artifact_id:extraction.artifact.artifact_id,
      request_sha256:extraction.artifact.request_sha256,output_sha256:extraction.artifact.output_sha256};
    if (canonicalProposalJson(proof.artifact)!==canonicalProposalJson(a) || m.extraction_operation_id!==a.operation_id || m.extraction_artifact_id!==a.artifact_id ||
      m.extraction_request_sha256!==a.request_sha256 || m.extraction_output_sha256!==a.output_sha256) throw Error();
    const sourceKeys=["source_key","item_key","source_version_id","source_url","content_sha256","mapping_sha256","language_code","retrieved_at","adapter_identity","parser_identity","derivation_manifest_sha256"] as const;
    for (const key of ["current","previous"] as const) {
      const source=extraction.inspection[key]!;
      const expectedSource={...Object.fromEntries(sourceKeys.map(field=>[field,source[field]])),...extraction.originals[key]};
      if (canonicalProposalJson(proof[key])!==canonicalProposalJson(expectedSource)) throw Error();
    }
    const c=record(proof.independent_context,"schema_version kind snapshot_intent artifact held issue content support translation");
    const held=record(c.held,"run_id decision_id item_key source_version_id content_sha256 locator jurisdiction_id decided_at disposition");
    const issue=record(c.issue,"issue_id jurisdiction_id jurisdiction_slug issue_slug created_at observed_at head");
    const content=record(c.content,"capture_id claim_id title summary period_label last_evidence_review_on review_date_basis publisher source_title source_published_on");
    const support=record(c.support,"source_version_id content_sha256 locator assertion claim_type relation assignment_state");
    const translation=record(c.translation,"display_language status");
    const current=extraction.inspection.current, claim=payload.snapshot.claims[0], evidence=claim?.evidence[0];
    if (c.schema_version!==1 || c.kind!=="invented_detached_extraction_context" || c.snapshot_intent!==proof.snapshot_intent ||
      canonicalProposalJson(c.artifact)!==canonicalProposalJson(a) || sha(canonicalProposalJson(c))!==proof.context_sha256 ||
      payload.snapshot.claims.length!==1 || !claim || claim.evidence.length!==1 || !evidence || payload.conflictCoverage!=="not_recorded" ||
      payload.dependencyManifest.sourceVersionIds.length!==1 || payload.dependencyManifest.sourceVersionIds[0]!==current.source_version_id ||
      claim.id!==proof.claim_id || claim.id!==content.claim_id || claim.assertion!==extraction.proposal.proposed_assertion || claim.type!==extraction.proposal.proposed_claim_type ||
      claim.periodLabel!==content.period_label || payload.snapshot.title!==content.title || payload.snapshot.summary!==content.summary || payload.snapshot.lastEvidenceReviewOn!==content.last_evidence_review_on ||
      payload.snapshot.jurisdictionSlug!==issue.jurisdiction_slug || payload.snapshot.issueSlug!==issue.issue_slug || issue.jurisdiction_id!==held.jurisdiction_id ||
      !contextText(80).safeParse(held.jurisdiction_id).success ||
      selection.captureId!==content.capture_id || selection.runId!==held.run_id || selection.decisionId!==held.decision_id || selection.issueId!==issue.issue_id ||
      held.disposition!=="held" || held.item_key!==current.item_key || held.source_version_id!==current.source_version_id || held.content_sha256!==current.content_sha256 || held.locator!==extraction.proposal.locator ||
      content.review_date_basis!==proof.review_date_basis || support.assignment_state!=="proposed_only" || support.relation!=="supports" ||
      support.source_version_id!==current.source_version_id || support.content_sha256!==current.content_sha256 || support.locator!==extraction.proposal.locator ||
      support.assertion!==claim.assertion || support.claim_type!==claim.type || evidence.relation!=="supports" || evidence.sourceVersionId!==current.source_version_id || evidence.locator!==extraction.proposal.locator ||
      evidence.url!==current.source_url || evidence.retrievedAt!==current.retrieved_at || evidence.publisher!==content.publisher || evidence.title!==content.source_title || evidence.sourcePublishedOn!==content.source_published_on ||
      payload.translation.displayLanguage!==translation.display_language || payload.translation.displayLanguage!==current.language_code || payload.translation.status!==translation.status ||
      !["not_recorded","unreviewed"].includes(payload.translation.status)) throw Error();
    for (const [key,maximum] of [["title",240],["summary",1600],["period_label",160],["publisher",160],["source_title",240]] as const)
      contextText(maximum).parse(content[key]);
    if (content.source_published_on !== null) calendarDate.parse(content.source_published_on);
    const history=historySchema.parse(c), head=history.issue.head;
    if (selection.basePublicationId!==head.publication_id || (head.publication_id===null ? head.content_sha256!==null || head.changed_at!==null :
      head.content_sha256===null || head.changed_at===null || micros(head.changed_at)<micros(history.issue.created_at) || micros(head.changed_at)>micros(history.issue.observed_at))) throw Error();
    const times=[extraction.artifact.stored_at,p.historical_artifact_observed_at,p.prepared_at,p.stored_at,extraction.observed_at,r.observed_at];
    if (times.some((at,i)=>i>0 && micros(at)<micros(times[i-1]!)) || micros(history.held.decided_at)<micros(extraction.artifact.stored_at) ||
      micros(history.held.decided_at)>micros(history.issue.observed_at) || micros(history.issue.created_at)>micros(history.issue.observed_at) ||
      micros(history.issue.observed_at)>micros(p.prepared_at) || history.content.last_evidence_review_on>p.prepared_at.slice(0,10) ||
      evidence.sourcePublishedOn!==null && evidence.sourcePublishedOn>current.retrieved_at.slice(0,10)) throw Error();
    return Object.freeze({preparation:p,metadata:m,selection,snapshot:payload.snapshot,history,extraction,observedAt:r.observed_at,reportSha256:e.reportSha256});
  } catch { return null; }
}

const choiceSchema=z.strictObject({operationId:uuid,label:text(160),reportJson:text(512*1024),expected:expectedSchema});
const historyChoicesSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("fictional_html_preparation_history"),reports:z.array(choiceSchema).min(1).max(50)});
export function htmlPreparationHistory(input:unknown) {
  try {
    // Fixed fixture inventory only: no full report is admitted or auto-selected.
    const value=historyChoicesSchema.parse(canonical(text(2*1024*1024).parse(input))),operations=new Set<string>();let scope:string|undefined;
    for (const row of value.reports) {
      const m=metadata.parse(canonical(row.expected.preparationIntentJson));
      if (row.operationId!==m.operation_id || operations.has(row.operationId)) throw Error();operations.add(row.operationId);
      const parent=canonicalProposalJson([m.extraction_operation_id,m.extraction_artifact_id,m.extraction_request_sha256,m.extraction_output_sha256]);
      if (scope!==undefined && scope!==parent) throw Error();scope=parent;
    }
    return value.reports;
  } catch { return null; }
}
