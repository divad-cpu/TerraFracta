import { Buffer } from "node:buffer";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { detachedPreparationIntentSchema } from "./detached-preparation-report.ts";
import { prepareHtmlInitialCandidateCaptureLookup } from "./html-initial-candidate-lookup.ts";
import { HTML_INITIAL_CANDIDATE_CAPTURE_READ_SQL } from "./html-initial-candidate-capture.ts";
import type { HtmlInitialCandidateCaptureProvider, HtmlInitialCandidateCaptureReadCommand } from "./html-initial-candidate-capture-selection.ts";
import type { PostgresReadOwner, PostgresReadClient } from "./postgres-read-owner.ts";

// Fixed owner-only read adapter over an already supplied physical session
// owner. No connection/configuration/default account, role change, grant,
// writer, route or authentication claim is created here. The caller retains
// the shared owner's shutdown, slot, clock and close-acknowledgement lifetime.
export const POSTGRES_HTML_INITIAL_CANDIDATE_OWNER_GUARD_SQL=`SELECT current_user=session_user AND session_user='postgres'
 AND pg_catalog.current_setting('transaction_isolation')='repeatable read'
 AND pg_catalog.current_setting('transaction_read_only')='on' AS admitted`;
const BEGIN="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
const unavailable=()=>Error("read_unavailable");
function own(input:unknown,names:readonly string[]){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw unavailable();
 const keys=Reflect.ownKeys(input);if(keys.length!==names.length||keys.some(k=>typeof k!=="string"||!names.includes(k)))throw unavailable();
 const captured=captureOwnEnumerableSelectors(input,names);if(captured===null||Reflect.ownKeys(input).length!==names.length||Reflect.ownKeys(input).some(k=>typeof k!=="string"||!names.includes(k)))throw unavailable();return captured;
}
function captureCommand(input:unknown):HtmlInitialCandidateCaptureReadCommand{
 const c=own(input,["sql","values"]);
 if(c.sql!==HTML_INITIAL_CANDIDATE_CAPTURE_READ_SQL||!Array.isArray(c.values))throw unavailable();
 const closedValues=()=>{const keys=Reflect.ownKeys(c.values as object),length=Object.getOwnPropertyDescriptor(c.values,"length");return length!==undefined&&Object.hasOwn(length,"value")&&length.value===1&&keys.length===2&&keys.includes("0")&&keys.includes("length")&&Object.getOwnPropertyDescriptor(c.values,"0")?.enumerable===true;};
 const length=Object.getOwnPropertyDescriptor(c.values,"length");
 if(!length||!Object.hasOwn(length,"value")||length.value!==1||!closedValues())throw unavailable();
 const value=captureOwnEnumerableSelectors(c.values,["0"],true);
 if(value===null||!closedValues())throw unavailable();
 const id=detachedPreparationIntentSchema.shape.operation_id.parse(value["0"]);
 return Object.freeze({sql:HTML_INITIAL_CANDIDATE_CAPTURE_READ_SQL,values:Object.freeze([id])});
}
function acknowledge(input:unknown,expected:"BEGIN"|"ROLLBACK"){
 if(input===null||typeof input!=="object")throw unavailable();
 const r=input as {command?:unknown;rowCount?:unknown;fields?:unknown;rows?:unknown};
 if(r.command!==expected||r.rowCount!==null||!Array.isArray(r.fields)||r.fields.length!==0||!Array.isArray(r.rows)||r.rows.length!==0)throw unavailable();
}
function oneCell(input:unknown,column:"admitted"|"lookup"|"capture",oid:16|25):unknown{
 if(input===null||typeof input!=="object")throw unavailable();
 const r=input as {command?:unknown;rowCount?:unknown;fields?:Array<{name?:unknown;dataTypeID?:unknown}>;rows?:unknown[][]};
 if(r.command!=="SELECT"||r.rowCount!==1||!Array.isArray(r.fields)||r.fields.length!==1||r.fields[0]?.name!==column||r.fields[0]?.dataTypeID!==oid||
  !Array.isArray(r.rows)||r.rows.length!==1||!Array.isArray(r.rows[0])||r.rows[0].length!==1)throw unavailable();
 return r.rows[0][0];
}
function textBytes(input:unknown,column:"lookup"|"capture",maximum:number){
 const text=oneCell(input,column,25);
 if(typeof text!=="string"||/[\ud800-\udfff]/u.test(text))throw unavailable();
 const size=Buffer.byteLength(text,"utf8");if(size<2||size>maximum)throw unavailable();
 // A primitive scalar string has no producer-owned mutable backing buffer.
 // Make the owned native UTF8 bytes before the later ROLLBACK await.
 return new TextEncoder().encode(text);
}
export function createPostgresHtmlInitialCandidateCaptureTransport(inputOwner:PostgresReadOwner){
 let run:PostgresReadOwner["run"];
 try{
  const c=own(inputOwner,["run","user","shutdown"]);
  if(c.user!=="postgres"||typeof c.run!=="function"||typeof c.shutdown!=="function")throw unavailable();
  run=c.run as PostgresReadOwner["run"];
 }catch{throw unavailable();}
 async function transaction(command:Readonly<{sql:string;values:readonly string[]}>,column:"lookup"|"capture",maximum:number,signal:AbortSignal):Promise<Uint8Array>{
  try{
   if(signal.aborted)throw unavailable();
   const execute=async(client:PostgresReadClient,assertActive:()=>void)=>{
    const control=async(text:string,expected:"BEGIN"|"ROLLBACK")=>{
     assertActive();const result=await client.query({text,values:[],rowMode:"array"});assertActive();acknowledge(result,expected);assertActive();
    };
    await control(BEGIN,"BEGIN");
    assertActive();const guard=await client.query({text:POSTGRES_HTML_INITIAL_CANDIDATE_OWNER_GUARD_SQL,values:[],rowMode:"array"});assertActive();
    if(oneCell(guard,"admitted",16)!==true)throw unavailable();
    assertActive();const result=await client.query({text:command.sql,values:[...command.values],rowMode:"array"});assertActive();
    const bytes=textBytes(result,column,maximum);assertActive();
    await control("ROLLBACK","ROLLBACK");return bytes;
   };
   // Keep the original owner association even when a method uses its receiver.
   return await Reflect.apply(run,inputOwner,[signal,execute]) as Uint8Array;
  }catch{throw unavailable();}
 }
 const readCapture:HtmlInitialCandidateCaptureProvider=async(input,signal)=>{
  try{return await transaction(captureCommand(input),"capture",131_072,signal);}catch{throw unavailable();}
 };
 const readLookup=async(rawPreparationReport:unknown,independentExpectedReport:unknown,trustedObservedAt:unknown,signal:AbortSignal)=>{
  try{
   const command=prepareHtmlInitialCandidateCaptureLookup(rawPreparationReport,independentExpectedReport,trustedObservedAt);
   return await transaction(command,"lookup",4096,signal);
  }catch{throw unavailable();}
 };
 return Object.freeze({readLookup,readCapture});
}
