import { createHash } from "node:crypto";
import { z } from "zod";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";
import { detachedPreparationReport, detachedPreparationIntentSchema } from "./detached-preparation-report.ts";

// Initial-candidate metadata only, reusing the established fixed appended lookup
// grammar and eight independent preparation operands. Never a provider or grant.
// Independently retained full preparation is readmitted on every public call.
// A historical candidate does not supply an independent capture intent or
// permission to select, reopen full parts, retry, write or publish anything.
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const uuid=detachedPreparationIntentSchema.shape.operation_id,instant=detachedPreparationIntentSchema.shape.prepared_at;
const scopeSchema=z.strictObject({preparation_operation_id:uuid,preparation_artifact_id:uuid,preparation_stored_at:instant,
 preparation_intent_sha256:hash,payload_sha256:hash,selection_sha256:hash,provenance_sha256:hash,context_raw_sha256:hash});
const nativeSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_initial_candidate_lookup"),scope:scopeSchema,
 principal:z.literal("postgres"),session_principal:z.literal("postgres"),transaction_isolation:z.literal("repeatable read"),transaction_read_only:z.literal(true),
 preparation_matched:z.literal(true),observed_at:instant,matches:z.array(z.strictObject({capture_id:uuid,preparation_operation_id:uuid,stored_at:instant,intent_sha256:hash})).max(1)});
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
export const INITIAL_CANDIDATE_LOOKUP_SQL=`with admission as materialized (
 select current_user=session_user and session_user='postgres'
 and pg_catalog.current_setting('transaction_isolation')='repeatable read'
 and pg_catalog.current_setting('transaction_read_only')='on' as admitted
), preparation as materialized (
 select p.operation_id from tf_detached_proposal.preparations p cross join admission a
 where a.admitted and p.operation_id=$1::uuid and p.artifact_id=$2::uuid and p.stored_at=$3::timestamptz and p.input=($4::text)::jsonb
 and pg_catalog.encode(pg_catalog.sha256(p.payload_raw),'hex')=$5::text
 and pg_catalog.encode(pg_catalog.sha256(p.selection_raw),'hex')=$6::text
 and pg_catalog.encode(pg_catalog.sha256(p.provenance_raw),'hex')=$7::text
 and pg_catalog.encode(pg_catalog.sha256(p.context_raw),'hex')=$8::text
), matches as materialized (
 select c.capture_id,c.preparation_operation_id,c.stored_at,pg_catalog.encode(pg_catalog.sha256(c.intent_raw),'hex') as intent_sha256
 from tf_initial_candidate.captures c join preparation p on p.operation_id=c.preparation_operation_id
 order by c.stored_at,c.capture_id limit 2
)
select pg_catalog.jsonb_build_object('schema_version',1,'kind','invented_initial_candidate_lookup',
 'scope',pg_catalog.jsonb_build_object('preparation_operation_id',$1::uuid,'preparation_artifact_id',$2::uuid,
 'preparation_stored_at',pg_catalog.to_char($3::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'preparation_intent_sha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to($4::text,'UTF8')),'hex'),
 'payload_sha256',$5::text,'selection_sha256',$6::text,'provenance_sha256',$7::text,'context_raw_sha256',$8::text),
 'principal',current_user,'session_principal',session_user,
 'transaction_isolation',pg_catalog.current_setting('transaction_isolation'),
 'transaction_read_only',pg_catalog.current_setting('transaction_read_only')='on',
 'preparation_matched',(select count(*)=1 from preparation),
 'observed_at',pg_catalog.to_char(pg_catalog.statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'matches',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('capture_id',capture_id,
 'preparation_operation_id',preparation_operation_id,'stored_at',pg_catalog.to_char(stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'intent_sha256',intent_sha256) order by stored_at,capture_id) from matches),'[]'::jsonb))::text as lookup`;
function checkedLookup(rawPreparationReport:unknown,independentExpectedReport:unknown,trustedObservedAt:unknown){
 try{
  const report=detachedPreparationReport(rawPreparationReport,independentExpectedReport),at=instant.parse(trustedObservedAt);
  if(report===null||micros(report.observedAt)>micros(at))throw Error();
  // A known-base preparation belongs to the separate whole-issue path.
  // Readmit its full report without acquiring or inventing a work claim.
  const h=report.history.issue.head,payload=JSON.parse(report.parts.payload_json);
  if(report.selection.basePublicationId!==null||h.publication_id!==null||h.content_sha256!==null||h.changed_at!==null||
   report.snapshot.claims.length!==1||report.snapshot.claims[0]!.evidence.length!==1||payload.dependencyManifest.sourceVersionIds.length!==1||
   payload.conflictCoverage!=="not_recorded"||!["unreviewed","not_recorded"].includes(payload.translation.status))throw Error();
  const p=report.preparation,m=report.metadata,intentJson=canonicalProposalJson(m);
  const scope=Object.freeze(scopeSchema.parse({preparation_operation_id:p.operation_id,preparation_artifact_id:p.artifact_id,
   preparation_stored_at:p.stored_at,preparation_intent_sha256:sha(intentJson),payload_sha256:m.payload_sha256,
   selection_sha256:m.selection_sha256,provenance_sha256:m.provenance_sha256,context_raw_sha256:m.context_raw_sha256}));
  const values=Object.freeze([p.operation_id,p.artifact_id,p.stored_at,intentJson,m.payload_sha256,m.selection_sha256,m.provenance_sha256,m.context_raw_sha256]);
  return Object.freeze({command:Object.freeze({sql:INITIAL_CANDIDATE_LOOKUP_SQL,values,scope}),reportObservedAt:report.observedAt,observedAt:at});
 }catch{throw Error("initial_candidate_lookup_unavailable");}
}
export function prepareInitialCandidateLookup(rawPreparationReport:unknown,independentExpectedReport:unknown,trustedObservedAt:unknown){
 return checkedLookup(rawPreparationReport,independentExpectedReport,trustedObservedAt).command;
}
export function parseInitialCandidateLookup(rawNativeBytes:unknown,rawPreparationReport:unknown,independentExpectedReport:unknown,trustedObservedAt:unknown){
 try{
  // No cached typed pointer is accepted as proof of the full preparation.
  const checked=checkedLookup(rawPreparationReport,independentExpectedReport,trustedObservedAt),request=checked.command;
  const bytes=new Uint8Array(4096),size=copyNativeByteChunk(bytes,0,rawNativeBytes);
  const text=new TextDecoder("utf8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,size)),native=nativeSchema.parse(JSON.parse(text));
  // Reuse fixed native receipt lexical accounting: all values here are closed
  // tokens, UUID/hash/UTC or booleans. There is no free source/intent text that
  // could mimic a key. Duplicate/escaped-alias keys cannot silently disappear.
  const keys=(text.match(/"(?:[^"\\]|\\.)*"\s*:/g)??[]);
  if(keys.length!==18+4*native.matches.length||keys.some(key=>{const spelling=key.slice(0,key.lastIndexOf(":")).trim();return JSON.stringify(JSON.parse(spelling))!==spelling;})||canonicalProposalJson(native.scope)!==canonicalProposalJson(request.scope)||
   micros(native.observed_at)<micros(checked.reportObservedAt)||micros(native.observed_at)>micros(checked.observedAt))throw Error();
  const matches=native.matches.map(row=>{
   if(row.preparation_operation_id!==request.scope.preparation_operation_id||micros(row.stored_at)<micros(request.scope.preparation_stored_at)||micros(row.stored_at)>micros(native.observed_at))throw Error();
   return Object.freeze({captureId:row.capture_id,preparationOperationId:row.preparation_operation_id,storedAt:row.stored_at,intentSha256:row.intent_sha256});
  });
  return Object.freeze({preparation:Object.freeze({operationId:request.scope.preparation_operation_id,artifactId:request.scope.preparation_artifact_id,
   storedAt:request.scope.preparation_stored_at,intentSha256:request.scope.preparation_intent_sha256}),matches:Object.freeze(matches),observedAt:native.observed_at,
   evidenceState:"invented_historical_association_metadata_only_independent_capture_intent_required" as const});
 }catch{throw Error("initial_candidate_lookup_unavailable");}
}
