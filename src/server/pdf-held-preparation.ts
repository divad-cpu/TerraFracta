import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { decodeProposalCapture } from "./proposal-capture.ts";
import { pdfReviewSourceSchema } from "./pdf-extraction-review-report.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

// Passive detached preparation only. Four independently expected digests identify
// the intended bytes; neither hashes nor this reader authenticate their origin.
// Original context spelling is retained, not reparsed as evidence of duplicate-key
// semantics. Omitted originals/output and Python's cold reopening are not replayed.
// No capture-command import: the existing SQL has no PDF companion slot.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.uuid();
const instant = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s => !s.startsWith("0000-"));
const date = z.iso.date().refine(s => !s.startsWith("0000-"));
const text = (max: number) => z.string().refine(s => !/[\ud800-\udfff]/u.test(s) && Buffer.byteLength(s,"utf8") > 0 && Buffer.byteLength(s,"utf8") <= max);
const contextText = (max: number) => z.string().refine(s => [...s].length > 0 && [...s].length <= max && !/[\ud800-\udfff]/u.test(s) &&
  !/[\u0000-\u0008\u000b-\u001f]/u.test(s) && !/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u.test(s));
const intent = "single_claim_technical_review_not_issue_replacement";
const artifact = z.strictObject({operation_id:uuid,artifact_id:uuid,request_sha256:hash,output_sha256:hash});
const head = z.strictObject({publication_id:uuid.nullable(),content_sha256:hash.nullable(),changed_at:instant.nullable()});
const context = z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_detached_extraction_context"),snapshot_intent:z.literal(intent),artifact,
  held:z.strictObject({run_id:uuid,decision_id:uuid,item_key:contextText(120),source_version_id:uuid,content_sha256:hash,locator:contextText(200),jurisdiction_id:contextText(80),decided_at:instant,disposition:z.literal("held")}),
  issue:z.strictObject({issue_id:uuid,jurisdiction_id:contextText(80),jurisdiction_slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),issue_slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),created_at:instant,observed_at:instant,head}),
  content:z.strictObject({capture_id:uuid,claim_id:uuid,title:contextText(240),summary:contextText(1600),period_label:contextText(160),last_evidence_review_on:date,
    review_date_basis:z.literal("independently_supplied_not_inferred"),publisher:contextText(160),source_title:contextText(240),source_published_on:date.nullable()}),
  support:z.strictObject({source_version_id:uuid,content_sha256:hash,locator:contextText(200),assertion:contextText(600).refine(s=>[...s].length>=10),claim_type:z.enum(["condition","policy_action","funding","delivery","attributed_finding","evaluation"]),relation:z.literal("supports"),assignment_state:z.literal("proposed_only")}),
  translation:z.strictObject({display_language:z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/),status:z.enum(["not_recorded","unreviewed"])})});
const proofSchema = z.strictObject({schema_version:z.literal(1),kind:z.literal("detached_pdf_extraction_proposal"),scope:z.literal("invented_supplied_pdf_custody_only"),
  evidence_state:z.literal("unverified_not_captured_no_durable_association"),snapshot_intent:z.literal(intent),artifact,current:pdfReviewSourceSchema,previous:pdfReviewSourceSchema.nullable(),
  full_receipt_sha256:hash,canonical_intent_sha256:hash,selected_payload_sha256:hash,independent_context:context,context_sha256:hash,supplied_context_sha256:hash,
  recorded_observed_at:instant,artifact_prepared_at:instant,artifact_stored_at:instant,artifact_observed_at:instant,prepared_at:instant,payload_sha256:hash,selection_sha256:hash,claim_id:uuid,
  source_date_text:contextText(80).nullable(),review_date_basis:z.literal("independently_supplied_not_inferred"),
  limits:z.strictObject({page_index_kind:z.literal("physical_1_based"),offset_space:z.literal("derived_page_utf8"),whole_page_selection:z.literal(true),original_pdf_included:z.literal(false),
    rendered_visibility_verified:z.literal(false),visual_qualification_established:z.literal(false),ocr_qualification_established:z.literal(false),table_qualification_established:z.literal(false),durable_association_included:z.literal(false),publication_authorized:z.literal(false)})});
const selectionSchema = z.strictObject({captureId:uuid,runId:uuid,decisionId:uuid,issueId:uuid,basePublicationId:uuid.nullable()});
const bundleSchema = z.strictObject({payloadJson:text(16384),selectionJson:text(2048),provenanceJson:text(65536),contextJson:text(32768)});
const expectedSchema = z.strictObject({payloadSha256:hash,selectionSha256:hash,provenanceSha256:hash,contextSha256:hash});
const sha = (s:string) => createHash("sha256").update(s,"utf8").digest("hex");
function canonical(raw:string):unknown { const v:unknown=JSON.parse(raw);if(canonicalProposalJson(v)!==raw)throw Error();return v; }
function ownStrings(value:unknown,fields:readonly string[]):Record<string,string> {
  if(value===null || typeof value!=="object" || Array.isArray(value))throw Error();
  const proto=Object.getPrototypeOf(value), keys=Reflect.ownKeys(value);
  if(proto!==Object.prototype && proto!==null || keys.length!==fields.length || keys.some(k=>typeof k!=="string" || !fields.includes(k)))throw Error();
  const out:Record<string,string>={};
  for(const key of fields){const d=Object.getOwnPropertyDescriptor(value,key);if(!d?.enumerable || !("value" in d) || typeof d.value!=="string")throw Error();out[key]=d.value;}
  return out;
}
function freeze<T>(value:T):T { if(value!==null && typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value; }

export function pdfHeldPreparation(bundle:unknown,expected:unknown) {
  try {
    // Snapshot both independent channels before parsing/canonicalisation.
    const b0=ownStrings(bundle,["payloadJson","selectionJson","provenanceJson","contextJson"]),
      e0=ownStrings(expected,["payloadSha256","selectionSha256","provenanceSha256","contextSha256"]);
    const b=bundleSchema.parse(b0),e=expectedSchema.parse(e0);
    if(sha(b.payloadJson)!==e.payloadSha256 || sha(b.selectionJson)!==e.selectionSha256 || sha(b.provenanceJson)!==e.provenanceSha256 || sha(b.contextJson)!==e.contextSha256)throw Error();
    const p=proofSchema.parse(canonical(b.provenanceJson)),s=selectionSchema.parse(canonical(b.selectionJson)),payload=decodeProposalCapture(b.payloadJson,e.payloadSha256),
      c=p.independent_context,current=p.current,previous=p.previous,claim=payload.snapshot.claims[0],evidence=claim?.evidence[0];
    if(p.payload_sha256!==e.payloadSha256 || p.selection_sha256!==e.selectionSha256 || p.supplied_context_sha256!==e.contextSha256 ||
      sha(canonicalProposalJson(c))!==p.context_sha256 || canonicalProposalJson(c.artifact)!==canonicalProposalJson(p.artifact) ||
      payload.snapshot.claims.length!==1 || !claim || claim.evidence.length!==1 || !evidence || payload.conflictCoverage!=="not_recorded" ||
      payload.dependencyManifest.sourceVersionIds.length!==1 || payload.dependencyManifest.sourceVersionIds[0]!==current.source_version_id ||
      claim.id!==p.claim_id || claim.id!==c.content.claim_id || claim.assertion!==c.support.assertion || claim.type!==c.support.claim_type || claim.periodLabel!==c.content.period_label ||
      payload.snapshot.title!==c.content.title || payload.snapshot.summary!==c.content.summary || payload.snapshot.lastEvidenceReviewOn!==c.content.last_evidence_review_on ||
      payload.snapshot.jurisdictionSlug!==c.issue.jurisdiction_slug || payload.snapshot.issueSlug!==c.issue.issue_slug || c.issue.jurisdiction_id!==c.held.jurisdiction_id ||
      s.captureId!==c.content.capture_id || s.runId!==c.held.run_id || s.decisionId!==c.held.decision_id || s.issueId!==c.issue.issue_id || s.basePublicationId!==c.issue.head.publication_id ||
      c.held.item_key!==current.item_key || c.held.source_version_id!==current.source_version_id || c.held.content_sha256!==current.content_sha256 || c.held.locator!==c.support.locator ||
      c.support.source_version_id!==current.source_version_id || c.support.content_sha256!==current.content_sha256 ||
      evidence.sourceVersionId!==current.source_version_id || evidence.locator!==c.support.locator || evidence.relation!=="supports" || evidence.url!==current.source_url ||
      evidence.retrievedAt!==current.retrieved_at || evidence.publisher!==c.content.publisher || evidence.title!==c.content.source_title || evidence.sourcePublishedOn!==c.content.source_published_on ||
      payload.translation.displayLanguage!==c.translation.display_language || payload.translation.displayLanguage!==current.language_code || payload.translation.status!==c.translation.status)throw Error();
    for(const source of [current,...(previous?[previous]:[])]) {
      let last=0;const locators=new Set<string>();
      for(const page of source.selected_pages){if(page.page_number<=last || locators.has(page.locator))throw Error();last=page.page_number;locators.add(page.locator);}
      if(micros(source.retrieved_at)>micros(p.recorded_observed_at))throw Error();
    }
    if(!current.selected_pages.some(page=>page.locator===c.support.locator))throw Error();
    if(previous && (["source_key","item_key","source_url","mapping_sha256","language_code"].some(k=>current[k as keyof typeof current]!==previous[k as keyof typeof previous]) ||
      micros(previous.retrieved_at)>micros(current.retrieved_at) || previous.source_version_id===current.source_version_id || previous.content_sha256===current.content_sha256 ||
      previous.selected_pages.length!==current.selected_pages.length || previous.selected_pages.some((page,i)=>page.locator!==current.selected_pages[i].locator || page.page_number!==current.selected_pages[i].page_number)))throw Error();
    if(previous && previous.selected_pages.find(page=>page.locator===c.support.locator)?.page_text_sha256===
      current.selected_pages.find(page=>page.locator===c.support.locator)?.page_text_sha256)throw Error();
    const times=[p.recorded_observed_at,p.artifact_prepared_at,p.artifact_stored_at,p.artifact_observed_at,p.prepared_at];
    if(times.some((at,i)=>i>0 && micros(at)<micros(times[i-1]!)) || p.artifact_observed_at!==p.prepared_at ||
      micros(c.held.decided_at)<micros(p.artifact_stored_at) || micros(c.held.decided_at)>micros(c.issue.observed_at) ||
      micros(c.issue.created_at)>micros(c.issue.observed_at) || micros(c.issue.observed_at)>micros(p.prepared_at) ||
      c.content.last_evidence_review_on>p.prepared_at.slice(0,10) || c.content.source_published_on!==null && c.content.source_published_on>current.retrieved_at.slice(0,10))throw Error();
    const h=c.issue.head;
    if(h.publication_id===null ? h.content_sha256!==null || h.changed_at!==null : h.content_sha256===null || h.changed_at===null ||
      micros(h.changed_at)<micros(c.issue.created_at) || micros(h.changed_at)>micros(c.issue.observed_at))throw Error();
    return freeze({parts:b,expected:e,proof:p,selection:s,payload,evidenceState:"invented_pdf_unverified_detached_not_captured" as const});
  } catch { return null; }
}
