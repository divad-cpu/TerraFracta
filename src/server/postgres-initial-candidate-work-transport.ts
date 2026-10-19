import { captureProposalWorkIdentity } from "./proposal-work-command.ts";
import { Buffer } from "node:buffer";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { INITIAL_CANDIDATE_CAPTURE_SQL, prepareInitialCandidateCaptureForWork, parseStoredInitialCandidateCapture } from "./initial-candidate-capture.ts";
import type { PostgresReadOwner, PostgresReadClient } from "./postgres-read-owner.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// One fixed autocommit invocation of the separately reviewed invented initial
// operation. This adapter creates no target, account, grant, SQL object or route.
// The existing generic SCRAM worker transport and shared owner stay unchanged.
const call=INITIAL_CANDIDATE_CAPTURE_SQL.slice("SELECT ".length,-"::text AS capture".length);
export const POSTGRES_INITIAL_CANDIDATE_WORK_SQL=`WITH principal AS MATERIALIZED (
 SELECT current_user=session_user AND session_user='postgres'
 AND pg_catalog.current_setting('transaction_read_only')='off'
 AND pg_catalog.current_setting('transaction_isolation')='read committed' AS admitted
)
SELECT admitted,CASE WHEN admitted THEN ${call}::text ELSE NULL END AS capture FROM principal`;
const settings=["SET default_transaction_read_only = off","SET default_transaction_isolation = 'read committed'"] as const;
type Prepared=ReturnType<typeof prepareInitialCandidateCaptureForWork>;
export type InitialCandidateWorkOutcome=Readonly<
 {kind:"confirmed";stored:ReturnType<typeof parseStoredInitialCandidateCapture>;work:Prepared["work"]} |
 {kind:"not_dispatched"}|{kind:"outcome_unknown"}
>;
// Independent post-query UTC observation is required, never a default clock or
// the stored native timestamp relabelled as a later trusted observation.
export type InitialCandidatePostwriteObserver=()=>unknown|PromiseLike<unknown>;
const notDispatched=Object.freeze({kind:"not_dispatched" as const});
const unknown=Object.freeze({kind:"outcome_unknown" as const});
const unavailable=()=>Error("initial_candidate_capture_work_unavailable");
function ownerRun(input:PostgresReadOwner){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw unavailable();
 const keys=Object.keys(input);
 if(keys.length!==3||keys.some(k=>!["run","user","shutdown"].includes(k)))throw unavailable();
 const c=captureOwnEnumerableSelectors(input,["run","user","shutdown"]);
 if(c===null||c.user!=="postgres"||typeof c.run!=="function"||typeof c.shutdown!=="function")throw unavailable();
 return c.run as PostgresReadOwner["run"];
}
function idle(client:PostgresReadClient){
 const c=client as PostgresReadClient&{getTransactionStatus?:()=>unknown};
 if(typeof c.getTransactionStatus!=="function"||c.getTransactionStatus()!=="I")throw unavailable();
}
function settingAck(input:unknown){
 if(input===null||typeof input!=="object")throw unavailable();
 const r=input as {command?:unknown;rowCount?:unknown;fields?:unknown;rows?:unknown};
 if(r.command!=="SET"||r.rowCount!==null||!Array.isArray(r.fields)||r.fields.length!==0||!Array.isArray(r.rows)||r.rows.length!==0)throw unavailable();
}
function captureBytes(input:unknown):Uint8Array|null{
 if(input===null||typeof input!=="object")throw unavailable();
 const r=input as {command?:unknown;rowCount?:unknown;fields?:Array<{name?:unknown;dataTypeID?:unknown}>;rows?:unknown[][]};
 if(r.command!=="SELECT"||r.rowCount!==1||!Array.isArray(r.fields)||r.fields.length!==2||r.fields[0]?.name!=="admitted"||r.fields[0]?.dataTypeID!==16||r.fields[1]?.name!=="capture"||r.fields[1]?.dataTypeID!==25||!Array.isArray(r.rows)||r.rows.length!==1||!Array.isArray(r.rows[0])||r.rows[0].length!==2)throw unavailable();
 if(r.rows[0][0]===false&&r.rows[0][1]===null)return null;
 const text=r.rows[0][1];
 if(r.rows[0][0]!==true||typeof text!=="string"||/[\ud800-\udfff]/u.test(text))throw unavailable();
 const size=Buffer.byteLength(text,"utf8");if(size<2||size>131072)throw unavailable();
 // Take native scalar bytes before the independent observer can suspend.
 return new TextEncoder().encode(text);
}
function recoverPrepared(work:unknown,raw:unknown,retainedIntentJson:unknown,independentExpected:unknown,historicalObservedAt:unknown){
 const originalWork=captureProposalWorkIdentity(work),stored=parseStoredInitialCandidateCapture(raw,retainedIntentJson,independentExpected,historicalObservedAt);
 // These expectations are reconstructed only after the entire stored report
 // was admitted against the caller's independent original expectation.
 const report=JSON.parse(stored.reportJson),identity=JSON.parse(stored.intentJson);
 const command=prepareInitialCandidateCaptureForWork(originalWork,stored.reportJson,{reportSha256:identity.report_sha256,preparationIntentJson:report.intent_json});
 if(command.intentJson!==stored.intentJson)throw unavailable();return command;
}
export function createPostgresInitialCandidateWorkTransport(inputOwner:PostgresReadOwner,observePostwrite:InitialCandidatePostwriteObserver,record:DevelopmentErrorRecorder=recordDevelopmentError){
 const run=ownerRun(inputOwner);
 if(typeof observePostwrite!=="function")throw unavailable();
 async function execute(prepare:()=>Prepared,signal:AbortSignal):Promise<InitialCandidateWorkOutcome>{
  let command:Prepared;
  try{if(signal.aborted)return notDispatched;command=prepare();}catch{return notDispatched;}
  let dispatched=false,expectedRefusal=false;
  try{
   const executeOwned=async(client:PostgresReadClient,active:()=>void)=>{
    active();idle(client);active();
    for(const text of settings){
     active();settingAck(await client.query({text,values:[],rowMode:"array"}));active();idle(client);active();
    }
    active();dispatched=true;let result;
    try{result=await client.query({text:POSTGRES_INITIAL_CANDIDATE_WORK_SQL,values:[...command.values],rowMode:"array"});}
    catch(error){
     const code=error!==null&&typeof error==="object"?(error as {code?:unknown}).code:null;
     expectedRefusal=code==="23514"||code==="23505"||code==="40001";throw error;
    }
    active();idle(client);active();const bytes=captureBytes(result);active();
    // This exact acknowledged false branch did not invoke the writer. Other
    // post-dispatch failures remain unknown, including ordinary fence errors.
    if(bytes===null){dispatched=false;expectedRefusal=true;throw unavailable();}
    active();const observedAt=await observePostwrite();active();
    const stored=parseStoredInitialCandidateCapture(bytes,command.intentJson,command.expected,observedAt);active();
    return Object.freeze({kind:"confirmed" as const,stored,work:command.work});
   };
   // Retain the original supplied owner/method association through cleanup.
   const result=await Reflect.apply(run,inputOwner,[signal,executeOwned]) as Extract<InitialCandidateWorkOutcome,{kind:"confirmed"}>;
   if(signal.aborted)throw unavailable();
   return result;
  }catch{
   if(!signal.aborted&&!expectedRefusal)observeDevelopmentError("proposal_capture_write",record);
   return dispatched?unknown:notDispatched;
  }
 }
 // No implicit retry/recovery, shutdown of the shared owner or default backend.
 // Recovery receives an independently supplied current work identity and the
 // complete retained original receipt/intent/independent report expectation and historical observation.
 return Object.freeze({
  capture:(work:unknown,rawReport:unknown,expected:unknown,signal:AbortSignal)=>execute(()=>prepareInitialCandidateCaptureForWork(work,rawReport,expected),signal),
  recover:(work:unknown,raw:unknown,retainedIntentJson:unknown,expected:unknown,historicalObservedAt:unknown,signal:AbortSignal)=>execute(()=>recoverPrepared(work,raw,retainedIntentJson,expected,historicalObservedAt),signal),
 });
}
