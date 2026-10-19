import { createHash } from "node:crypto";
import { z } from "zod";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { canonicalProposalJson as canonical } from "../operator-proposal-capture.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";
import { pdfPreparationReviewReport } from "./pdf-preparation-review-report.ts";
import { proposalCaptureSelectionSchema } from "./proposal-capture-command.ts";

// Owner-only initial metadata continuation adapted from the established PDF lookup.
// Reuse the immutable PDF intent/portable-packet/native-receipt identities;
// there are no separate SQL part columns in PDF preparation custody. A lookup
// never supplies the independent capture intent or the five reopening selectors.
const hash=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const instant=z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(s=>!s.startsWith("0000-"));
const scopeSchema=z.strictObject({preparation_operation_id:uuid,preparation_artifact_id:uuid,preparation_stored_at:instant,preparation_intent_sha256:hash,preparation_packet_sha256:hash,preparation_receipt_sha256:hash});
const nativeSchema=z.strictObject({schema_version:z.literal(1),kind:z.literal("invented_pdf_initial_candidate_capture_lookup"),scope:scopeSchema,
 principal:z.literal("postgres"),session_principal:z.literal("postgres"),transaction_isolation:z.literal("repeatable read"),transaction_read_only:z.literal(true),preparation_matched:z.literal(true),observed_at:instant,
 matches:z.array(z.strictObject({capture_id:proposalCaptureSelectionSchema.shape.captureId,preparation_operation_id:uuid,stored_at:instant,intent_sha256:hash})).max(1)});
const sha=(raw:string)=>createHash("sha256").update(raw,"utf8").digest("hex");
export const PDF_INITIAL_CANDIDATE_CAPTURE_LOOKUP_SQL=`with admission as materialized (
 select current_user=session_user and session_user='postgres'
 and pg_catalog.current_setting('transaction_isolation')='repeatable read'
 and pg_catalog.current_setting('transaction_read_only')='on' as admitted
), preparation as materialized (
 select p.operation_id from tf_pdf_result_rehearsal.preparations p cross join admission a
 where a.admitted and p.operation_id=$1::uuid and p.artifact_id=$2::uuid and p.stored_at=$3::timestamptz
 and p.intent=pg_catalog.convert_to($4::text,'UTF8')
 and pg_catalog.encode(pg_catalog.sha256(p.packet),'hex')=$5::text
 and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(tf_pdf_result_rehearsal.preparation_receipt(p.operation_id)::text,'UTF8')),'hex')=$6::text
), matches as materialized (
 select c.capture_id,c.preparation_operation_id,c.stored_at,pg_catalog.encode(pg_catalog.sha256(c.intent_raw),'hex') as intent_sha256
 from tf_pdf_initial_candidate.captures c join preparation p on p.operation_id=c.preparation_operation_id
 order by c.stored_at,c.capture_id limit 2
)
select pg_catalog.jsonb_build_object('schema_version',1,'kind','invented_pdf_initial_candidate_capture_lookup',
 'scope',pg_catalog.jsonb_build_object('preparation_operation_id',$1::uuid,'preparation_artifact_id',$2::uuid,
 'preparation_stored_at',pg_catalog.to_char($3::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'preparation_intent_sha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to($4::text,'UTF8')),'hex'),
 'preparation_packet_sha256',$5::text,'preparation_receipt_sha256',$6::text),
 'principal',current_user,'session_principal',session_user,
 'transaction_isolation',pg_catalog.current_setting('transaction_isolation'),
 'transaction_read_only',pg_catalog.current_setting('transaction_read_only')='on',
 'preparation_matched',(select count(*)=1 from preparation),
 'observed_at',pg_catalog.to_char(pg_catalog.statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'matches',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('capture_id',capture_id,
 'preparation_operation_id',preparation_operation_id,'stored_at',pg_catalog.to_char(stored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'intent_sha256',intent_sha256) order by stored_at,capture_id) from matches),'[]'::jsonb))::text as lookup`;
const fail=()=>Error("pdf_initial_candidate_capture_lookup_unavailable");
function checkedLookup(rawReport:unknown,independentExpectedReport:unknown,trustedObservedAt:unknown){
 try{
  const report=pdfPreparationReviewReport(rawReport,independentExpectedReport),at=instant.parse(trustedObservedAt);
  if(report===null||micros(report.report.observed_at)>micros(at)||report.candidate.selection.basePublicationId!==null||report.candidate.payload.snapshot.claims.length!==1)throw fail();
  const p=report.report.preparation;
  const scope=Object.freeze(scopeSchema.parse({preparation_operation_id:p.operation_id,preparation_artifact_id:p.artifact_id,preparation_stored_at:p.stored_at,
   preparation_intent_sha256:sha(report.report.intent_json),preparation_packet_sha256:p.packet_sha256,preparation_receipt_sha256:p.receipt_sha256}));
  const values=Object.freeze([p.operation_id,p.artifact_id,p.stored_at,report.report.intent_json,p.packet_sha256,p.receipt_sha256]);
  return Object.freeze({command:Object.freeze({sql:PDF_INITIAL_CANDIDATE_CAPTURE_LOOKUP_SQL,values,scope}),reportObservedAt:report.report.observed_at,observedAt:at});
 }catch{throw fail();}
}
export function preparePdfInitialCandidateCaptureLookup(rawReport:unknown,independentExpectedReport:unknown,trustedObservedAt:unknown){
 return checkedLookup(rawReport,independentExpectedReport,trustedObservedAt).command;
}
export function parsePdfInitialCandidateCaptureLookup(rawNativeBytes:unknown,rawReport:unknown,independentExpectedReport:unknown,trustedObservedAt:unknown){
 try{
  const checked=checkedLookup(rawReport,independentExpectedReport,trustedObservedAt),request=checked.command,bytes=new Uint8Array(4096),size=copyNativeByteChunk(bytes,0,rawNativeBytes);
  const text=new TextDecoder("utf8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,size)),native=nativeSchema.parse(JSON.parse(text));
  // All native values are fixed tokens/UUID/hash/UTC/booleans. No free source
  // or JSON text can mimic keys; reject aliases, duplicates and numeric 1e0.
  const keys=text.match(/"(?:[^"\\]|\\.)*"\s*:/g)??[];
  if(keys.length!==16+4*native.matches.length||keys.some(key=>{const spelling=key.slice(0,key.lastIndexOf(":")).trim();return JSON.stringify(JSON.parse(spelling))!==spelling;})||! /"schema_version"\s*:\s*1\s*[,}]/.test(text)||canonical(native.scope)!==canonical(request.scope)||micros(native.observed_at)<micros(checked.reportObservedAt)||micros(native.observed_at)>micros(checked.observedAt))throw fail();
  const matches=native.matches.map(row=>{
   if(row.preparation_operation_id!==request.scope.preparation_operation_id||micros(row.stored_at)<micros(request.scope.preparation_stored_at)||micros(row.stored_at)>micros(native.observed_at))throw fail();
   return Object.freeze({captureId:row.capture_id,preparationOperationId:row.preparation_operation_id,storedAt:row.stored_at,intentSha256:row.intent_sha256});
  });
  return Object.freeze({preparation:Object.freeze({operationId:request.scope.preparation_operation_id,artifactId:request.scope.preparation_artifact_id,storedAt:request.scope.preparation_stored_at,intentSha256:request.scope.preparation_intent_sha256,packetSha256:request.scope.preparation_packet_sha256,receiptSha256:request.scope.preparation_receipt_sha256}),matches:Object.freeze(matches),observedAt:native.observed_at,
   evidenceState:"invented_historical_association_metadata_only_independent_pdf_capture_intent_and_five_selectors_required" as const});
 }catch{throw fail();}
}
