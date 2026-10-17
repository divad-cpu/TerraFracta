import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { detachedPreparationIntentSchema,detachedPreparationReport } from "./detached-preparation-report.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = detachedPreparationIntentSchema.shape.operation_id;
const instant = detachedPreparationIntentSchema.shape.prepared_at;
const bytes = (maximum: number) => z.string().refine(s => !/[\ud800-\udfff]/u.test(s) && Buffer.byteLength(s,"utf8") > 0 && Buffer.byteLength(s,"utf8") <= maximum);
const scopeSchema = z.strictObject({ schema_version:z.literal(1),kind:z.literal("invented_detached_preparation_lookup_scope"),
  extraction_operation_id:uuid,extraction_artifact_id:uuid,extraction_request_sha256:hash,extraction_output_sha256:hash,extraction_full_receipt_sha256:hash });
const expectedSchema = z.strictObject({ reportSha256:hash,lookupScopeJson:bytes(4096) });
const schema = z.strictObject({ schema_version:z.literal(1),kind:z.literal("invented_detached_preparation_choices"),review_state:z.literal("historical_metadata_only"),
  scope:z.literal("invented_offline_rehearsal_only"),inventory_response_sha256:hash,lookup_scope_json:bytes(4096),artifact_stored_at:instant,
  artifact_observed_at:instant,inventory_observed_at:instant,report_observed_at:instant,
  candidates:z.array(z.strictObject({operation_id:uuid,artifact_id:uuid,prepared_at:instant,stored_at:instant,metadata_intent_json:bytes(4096)})).max(50) });
const sha = (s:string) => createHash("sha256").update(s,"utf8").digest("hex");
function canonical(s:string):unknown { const value:unknown=JSON.parse(s);if(canonicalProposalJson(value)!==s)throw Error();return value; }

// Metadata is a record of possible choices, not an independent pre-write
// expectation or permission to redispatch when no candidate is observed.
export function detachedPreparationChoices(raw:unknown,expected:unknown) {
  try {
    const text=bytes(98304).parse(raw),e=expectedSchema.parse(expected);
    if(sha(text)!==e.reportSha256)throw Error();
    const r=schema.parse(canonical(text));if(r.lookup_scope_json!==e.lookupScopeJson)throw Error();
    const scope=scopeSchema.parse(canonical(r.lookup_scope_json));
    const times=[r.artifact_stored_at,r.artifact_observed_at,r.inventory_observed_at,r.report_observed_at];
    if(times.some((at,i)=>i>0&&micros(at)<micros(times[i-1]!)))throw Error();
    const operations=new Set<string>(),artifacts=new Set<string>();let last:typeof r.candidates[number]|undefined;
    const candidates=r.candidates.map(row=>{
      const intent=detachedPreparationIntentSchema.parse(canonical(row.metadata_intent_json));
      if(intent.operation_id!==row.operation_id||intent.prepared_at!==row.prepared_at||
        ["extraction_operation_id","extraction_artifact_id","extraction_request_sha256","extraction_output_sha256"].some(k=>intent[k as keyof typeof intent]!==scope[k as keyof typeof scope])||
        micros(row.prepared_at)<micros(r.artifact_stored_at)||micros(row.prepared_at)>micros(row.stored_at)||micros(row.stored_at)>micros(r.inventory_observed_at)||
        operations.has(row.operation_id)||artifacts.has(row.artifact_id)||last&&(micros(row.stored_at)<micros(last.stored_at)||row.stored_at===last.stored_at&&row.operation_id<=last.operation_id))throw Error();
      operations.add(row.operation_id);artifacts.add(row.artifact_id);last=row;
      return Object.freeze({...row,intentSha256:sha(row.metadata_intent_json)});
    });
    return Object.freeze({scope,candidates:Object.freeze(candidates),artifactStoredAt:r.artifact_stored_at,artifactObservedAt:r.artifact_observed_at,
      inventoryObservedAt:r.inventory_observed_at,reportObservedAt:r.report_observed_at,inventoryResponseSha256:r.inventory_response_sha256,reportSha256:e.reportSha256});
  } catch { return null; }
}

export function selectedDetachedPreparation(rawChoices:unknown,expectedChoices:unknown,operationId:unknown,rawReport:unknown,expectedReport:unknown) {
  try {
    const choices=detachedPreparationChoices(rawChoices,expectedChoices),operation=uuid.parse(operationId);
    if(choices===null)throw Error();
    const candidate=choices.candidates.find(row=>row.operation_id===operation);if(candidate===undefined)throw Error();
    const retained=z.strictObject({reportSha256:hash,preparationIntentJson:bytes(4096)}).parse(expectedReport);
    if(candidate.metadata_intent_json!==retained.preparationIntentJson||micros(candidate.stored_at)>micros(choices.artifactObservedAt))throw Error();
    const report=detachedPreparationReport(rawReport,retained);if(report===null)throw Error();
    const p=report.preparation,m=report.metadata,s=choices.scope,proof=JSON.parse(report.parts.provenance_json);
    if(p.operation_id!==candidate.operation_id||p.artifact_id!==candidate.artifact_id||p.stored_at!==candidate.stored_at||p.prepared_at!==candidate.prepared_at||
      m.extraction_operation_id!==s.extraction_operation_id||m.extraction_artifact_id!==s.extraction_artifact_id||m.extraction_request_sha256!==s.extraction_request_sha256||m.extraction_output_sha256!==s.extraction_output_sha256||
      proof.full_receipt_sha256!==s.extraction_full_receipt_sha256||report.extraction.artifact.stored_at!==choices.artifactStoredAt||report.extraction.observed_at!==choices.artifactObservedAt||
      micros(report.observedAt)<micros(choices.inventoryObservedAt))throw Error();
    return Object.freeze({choices,candidate,report});
  } catch { return null; }
}
