import { Buffer } from "node:buffer";
import { z } from "zod";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { copyNativeByteChunk } from "../native-byte-chunk.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { detachedPreparationIntentSchema } from "./detached-preparation-report.ts";
import { POSTGRES_APPENDED_OWNER_GUARD_SQL as GUARD } from "./postgres-appended-capture-provider.ts";
import type { PostgresReadOwner, PostgresReadClient } from "./postgres-read-owner.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// Observe an explicitly selected existing issue with an existing empty head row.
// Empty current head is not proof that the issue has never had publications.
// This is owner-only correspondence, never an issue assignment, source/support
// approval, current work lease, editorial acceptance or publication permission.
const uuid=detachedPreparationIntentSchema.shape.operation_id;
const instant=detachedPreparationIntentSchema.shape.prepared_at;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
// Match the existing Python producer's Unicode codepoint/control grammar for
// metadata. The whole native envelope retains its existing byte quota.
const scalar=(s:string)=>!/[\ud800-\udfff]/u.test(s);
// Python str.strip includes NEL and excludes BOM; JS trim does the reverse.
const boundarySpace=/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;
const text=(limit:number)=>z.string().refine(s=>s.length>0&&!boundarySpace.test(s)&&scalar(s)&&[...s].length<=limit&&!/[\x00-\x08\x0b-\x1f]/.test(s));
const scopeSchema=z.strictObject({runId:uuid,decisionId:uuid,issueId:uuid});
const sourceSchema=z.strictObject({sourceVersionId:uuid,contentSha256:hash,itemKey:text(120),locator:text(400),jurisdictionId:text(80)});
const expectedSchema=z.strictObject({source:sourceSchema,head:z.literal("absent")});
const heldSchema=z.strictObject({run_id:uuid,decision_id:uuid,item_key:text(120),source_version_id:uuid,content_sha256:hash,locator:text(400),jurisdiction_id:text(80),decided_at:instant,disposition:z.literal("held")});
const issueSchema=z.strictObject({issue_id:uuid,jurisdiction_id:text(80),jurisdiction_slug:text(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),issue_slug:text(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),created_at:instant,observed_at:instant,head:z.strictObject({publication_id:z.null(),content_sha256:z.null(),changed_at:z.null()})});
const rowSchema=z.strictObject({held:heldSchema,issue:issueSchema,runCreatedAt:instant,qualificationDecidedAt:instant,sourceRetrievedAt:instant});
const envelopeSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal("stored_empty_issue_preparation_context"),requested:scopeSchema,observedAt:instant,matches:z.array(rowSchema).max(1)});
const BEGIN="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
const unavailable=()=>Error("empty_issue_preparation_context_unavailable");
const when=(s:string)=>`to_char(${s} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const requested=`jsonb_build_object('runId',($1::uuid)::text,'decisionId',($2::uuid)::text,'issueId',($3::uuid)::text)`;
// Require a physical existing head row and BOTH null fields. A missing row or
// populated head cannot become an empty observation. No historical scan,
// baseline fabrication, capture dependency, locks or writes are introduced.
export const EMPTY_ISSUE_PREPARATION_CONTEXT_SQL=`WITH selected AS (
 SELECT jsonb_build_object(
 'held',jsonb_build_object('run_id',d.run_id,'decision_id',d.id,'item_key',d.candidate_key,'source_version_id',d.source_version_id,'content_sha256',d.content_sha256,'locator',d.evidence_locator,'jurisdiction_id',r.jurisdiction_id,'decided_at',${when("d.decided_at")},'disposition',d.disposition),
 'issue',jsonb_build_object('issue_id',i.id,'jurisdiction_id',i.jurisdiction_id,'jurisdiction_slug',j.public_slug,'issue_slug',i.public_slug,'created_at',${when("i.created_at")},'observed_at',${when("statement_timestamp()")},'head',jsonb_build_object('publication_id',h.current_publication_id,'content_sha256',null,'changed_at',h.changed_at)),
 'runCreatedAt',${when("r.created_at")},'qualificationDecidedAt',${when("q.decided_at")},'sourceRetrievedAt',${when("s.retrieved_at")} ) AS context
 FROM terra_private.machine_candidate_decisions d
 JOIN terra_private.update_runs r ON r.id=d.run_id
 JOIN terra_private.automatic_route_qualifications q ON q.id=d.qualification_id
 JOIN terra_private.source_versions s ON s.id=d.source_version_id AND s.registration_id=q.registration_id AND s.content_sha256=d.content_sha256
 JOIN terra_private.issue_dossiers i ON i.id=$3::uuid AND i.jurisdiction_id=r.jurisdiction_id
 JOIN terra_private.jurisdictions j ON j.id=i.jurisdiction_id
 JOIN terra_private.issue_heads h ON h.issue_id=i.id AND h.current_publication_id IS NULL AND h.changed_at IS NULL
 WHERE d.id=$2::uuid AND d.run_id=$1::uuid AND d.disposition='held'
)
SELECT jsonb_build_object('schemaVersion',1,'kind','stored_empty_issue_preparation_context','requested',${requested},'observedAt',${when("statement_timestamp()")},'matches',coalesce((SELECT jsonb_agg(context) FROM selected),'[]'::jsonb))::text AS context`;

function own(input:unknown,names:readonly string[]){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw unavailable();
 const keys=Object.keys(input);if(keys.length!==names.length||keys.some(k=>!names.includes(k)))throw unavailable();
 const result=captureOwnEnumerableSelectors(input,names);if(result===null)throw unavailable();return result;
}
function scope(input:unknown){return scopeSchema.parse(own(input,["runId","decisionId","issueId"]));}
function expected(input:unknown){
 const e=own(input,["source","head"]);
 return expectedSchema.parse({source:own(e.source,["sourceVersionId","contentSha256","itemKey","locator","jurisdictionId"]),head:e.head});
}
export function prepareEmptyIssuePreparationContextRead(input:unknown){
 try{const s=scope(input);return Object.freeze({sql:EMPTY_ISSUE_PREPARATION_CONTEXT_SQL,values:Object.freeze([s.runId,s.decisionId,s.issueId])});}
 catch{throw unavailable();}
}
function frozen<T>(value:T):Readonly<T>{
 if(value!==null&&typeof value==="object"){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;
}
function parseContext(raw:unknown,s:z.infer<typeof scopeSchema>,e:z.infer<typeof expectedSchema>,trustedObservedAt:unknown){
 const trusted=instant.parse(trustedObservedAt),bytes=new Uint8Array(65536),size=copyNativeByteChunk(bytes,0,raw);
 if(size<2)throw unavailable();
 const native=new TextDecoder("utf8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,size));
 if(/[\ud800-\udfff]/u.test(native))throw unavailable();
 const v=envelopeSchema.parse(JSON.parse(native));
 if(canonicalProposalJson(v.requested)!==canonicalProposalJson(s)||micros(v.observedAt)>micros(trusted))throw unavailable();
 if(v.matches.length===0)return frozen({kind:"no_match" as const,scope:s,observedAt:v.observedAt});
 const r=v.matches[0]!,h=r.held,i=r.issue,source=e.source;
 if(h.run_id!==s.runId||h.decision_id!==s.decisionId||i.issue_id!==s.issueId||h.jurisdiction_id!==i.jurisdiction_id||
  h.source_version_id!==source.sourceVersionId||h.content_sha256!==source.contentSha256||h.item_key!==source.itemKey||h.locator!==source.locator||h.jurisdiction_id!==source.jurisdictionId||i.observed_at!==v.observedAt)throw unavailable();
 if([r.runCreatedAt,r.qualificationDecidedAt,r.sourceRetrievedAt].some(at=>micros(at)>micros(h.decided_at))||
  [h.decided_at,i.created_at].some(at=>micros(at)>micros(v.observedAt)))throw unavailable();
 // The all-null shape was admitted above. No current or historical publication
 // is selected and no source/issue assignment or publication authority follows.
 return frozen({kind:"ok" as const,context:{scope:s,held:h,issue:i,baselineJson:null,canonicalBaselineJson:null,baselineSha256:null,observedAt:v.observedAt,trustedObservedAt:trusted,headComparison:"matched_absent_current_head" as const,evidenceState:"observed_empty_current_head_not_history_assignment_approval_or_publication" as const}});
}
export function parseStoredEmptyIssuePreparationContext(raw:unknown,inputScope:unknown,independentExpected:unknown,trustedObservedAt:unknown){
 try{return parseContext(raw,scope(inputScope),expected(independentExpected),trustedObservedAt);}catch{throw unavailable();}
}
function ack(input:unknown,command:"BEGIN"|"ROLLBACK"){
 if(input===null||typeof input!=="object")throw unavailable();const r=input as {command?:unknown;rowCount?:unknown;fields?:unknown;rows?:unknown};
 if(r.command!==command||r.rowCount!==null||!Array.isArray(r.fields)||r.fields.length||!Array.isArray(r.rows)||r.rows.length)throw unavailable();
}
function cell(input:unknown,name:"admitted"|"context",oid:16|25){
 if(input===null||typeof input!=="object")throw unavailable();const r=input as {command?:unknown;rowCount?:unknown;fields?:Array<{name?:unknown;dataTypeID?:unknown}>;rows?:unknown[][]};
 if(r.command!=="SELECT"||r.rowCount!==1||!Array.isArray(r.fields)||r.fields.length!==1||r.fields[0]?.name!==name||r.fields[0]?.dataTypeID!==oid||!Array.isArray(r.rows)||r.rows.length!==1||!Array.isArray(r.rows[0])||r.rows[0].length!==1)throw unavailable();return r.rows[0][0];
}
export function createPostgresEmptyIssuePreparationContextReader(inputOwner:PostgresReadOwner,observeAfterRead:()=>unknown|PromiseLike<unknown>,record:DevelopmentErrorRecorder=recordDevelopmentError){
 let run:PostgresReadOwner["run"];
 try{const o=own(inputOwner,["run","user","shutdown"]);if(o.user!=="postgres"||typeof o.run!=="function"||typeof o.shutdown!=="function"||typeof observeAfterRead!=="function")throw unavailable();run=o.run as PostgresReadOwner["run"];}catch{throw unavailable();}
 return async(inputScope:unknown,independentExpected:unknown,signal:AbortSignal)=>{
  let s:z.infer<typeof scopeSchema>,e:z.infer<typeof expectedSchema>,command:ReturnType<typeof prepareEmptyIssuePreparationContextRead>;
  try{s=scope(inputScope);e=expected(independentExpected);command=prepareEmptyIssuePreparationContextRead(s);}catch{return Object.freeze({kind:"invalid_scope" as const});}
  try{
   if(signal.aborted)throw unavailable();
   const execute=async(client:PostgresReadClient,active:()=>void)=>{
    const control=async(text:string,kind:"BEGIN"|"ROLLBACK")=>{active();const r=await client.query({text,values:[],rowMode:"array"});active();ack(r,kind);active();};
    await control(BEGIN,"BEGIN");active();const guard=await client.query({text:GUARD,values:[],rowMode:"array"});active();if(cell(guard,"admitted",16)!==true)throw unavailable();
    active();const result=await client.query({text:command.sql,values:[...command.values],rowMode:"array"});active();const text=cell(result,"context",25);
    if(typeof text!=="string"||/[\ud800-\udfff]/u.test(text)||Buffer.byteLength(text,"utf8")>65536)throw unavailable();const bytes=new TextEncoder().encode(text);active();
    const observed=await observeAfterRead();active();const parsed=parseContext(bytes,s,e,observed);active();await control("ROLLBACK","ROLLBACK");return parsed;
   };
   const result=await Reflect.apply(run,inputOwner,[signal,execute]) as ReturnType<typeof parseStoredEmptyIssuePreparationContext>;
   if(signal.aborted)throw unavailable();return result;
  }catch{if(!signal.aborted)observeDevelopmentError("operator_audit_read",record);return Object.freeze({kind:"unavailable" as const});}
 };
}
