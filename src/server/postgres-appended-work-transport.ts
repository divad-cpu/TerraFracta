import { Buffer } from "node:buffer";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { APPENDED_WORK_CAPTURE_SQL, prepareAppendedIssueCaptureForWork, recoverAppendedIssueCaptureForWork } from "./appended-capture-work.ts";
import { parseStoredAppendedIssueCapture } from "./appended-issue-capture.ts";
import type { PostgresReadOwner, PostgresReadClient } from "./postgres-read-owner.ts";
import { observeDevelopmentError, recordDevelopmentError, type DevelopmentErrorRecorder } from "./error-diagnostics.ts";

// One fixed autocommit invocation of the already existing invented owner-only
// operation. This adapter creates no target, account, grant, SQL object or route.
// The existing generic SCRAM worker transport and shared owner stay unchanged.
const call=APPENDED_WORK_CAPTURE_SQL.slice("SELECT ".length,-"::text AS capture".length);
export const POSTGRES_APPENDED_WORK_SQL=`WITH principal AS MATERIALIZED (
 SELECT current_user=session_user AND session_user='postgres'
 AND pg_catalog.current_setting('transaction_read_only')='off'
 AND pg_catalog.current_setting('transaction_isolation')='read committed' AS admitted
)
SELECT admitted,CASE WHEN admitted THEN ${call}::text ELSE NULL END AS capture FROM principal`;
const settings=["SET default_transaction_read_only = off","SET default_transaction_isolation = 'read committed'"] as const;
type Prepared=ReturnType<typeof prepareAppendedIssueCaptureForWork>;
export type AppendedWorkCaptureOutcome=Readonly<
 {kind:"confirmed";stored:ReturnType<typeof parseStoredAppendedIssueCapture>;work:Prepared["work"]} |
 {kind:"not_dispatched"}|{kind:"outcome_unknown"}
>;
// Independent post-query UTC observation is required, never a default clock or
// the stored native timestamp relabelled as a later trusted observation.
export type AppendedWorkPostwriteObserver=()=>unknown|PromiseLike<unknown>;
const notDispatched=Object.freeze({kind:"not_dispatched" as const});
const unknown=Object.freeze({kind:"outcome_unknown" as const});
const unavailable=()=>Error("appended_capture_work_unavailable");
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
export function createPostgresAppendedWorkTransport(inputOwner:PostgresReadOwner,observePostwrite:AppendedWorkPostwriteObserver,record:DevelopmentErrorRecorder=recordDevelopmentError){
 const run=ownerRun(inputOwner);
 if(typeof observePostwrite!=="function")throw unavailable();
 async function execute(prepare:()=>Prepared,signal:AbortSignal):Promise<AppendedWorkCaptureOutcome>{
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
    try{result=await client.query({text:POSTGRES_APPENDED_WORK_SQL,values:[...command.values],rowMode:"array"});}
    catch(error){
     const code=error!==null&&typeof error==="object"?(error as {code?:unknown}).code:null;
     expectedRefusal=code==="23514"||code==="23505"||code==="40001";throw error;
    }
    active();idle(client);active();const bytes=captureBytes(result);active();
    // This exact acknowledged false branch did not invoke the writer. Other
    // post-dispatch failures remain unknown, including ordinary fence errors.
    if(bytes===null){dispatched=false;expectedRefusal=true;throw unavailable();}
    active();const observedAt=await observePostwrite();active();
    const stored=parseStoredAppendedIssueCapture(bytes,command.capture.intentJson,observedAt);active();
    return Object.freeze({kind:"confirmed" as const,stored,work:command.work});
   };
   // Retain the original supplied owner/method association through cleanup.
   const result=await Reflect.apply(run,inputOwner,[signal,executeOwned]) as Extract<AppendedWorkCaptureOutcome,{kind:"confirmed"}>;
   if(signal.aborted)throw unavailable();
   return result;
  }catch{
   if(!signal.aborted&&!expectedRefusal)observeDevelopmentError("proposal_capture_write",record);
   return dispatched?unknown:notDispatched;
  }
 }
 // No implicit retry/recovery, shutdown of the shared owner or default backend.
 // Recovery receives an independently supplied current work identity and the
 // complete retained original receipt/intent/historical observation.
 return Object.freeze({
  capture:(work:unknown,bundle:unknown,expected:unknown,signal:AbortSignal)=>execute(()=>prepareAppendedIssueCaptureForWork(work,bundle,expected),signal),
  recover:(work:unknown,raw:unknown,retainedIntentJson:unknown,historicalObservedAt:unknown,signal:AbortSignal)=>execute(()=>recoverAppendedIssueCaptureForWork(work,raw,retainedIntentJson,historicalObservedAt),signal),
 });
}
