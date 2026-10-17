import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { parseStoredIssuePreparationContext } from "./issue-preparation-context.ts";
import { parseStoredEmptyIssuePreparationContext } from "./empty-issue-preparation-context.ts";

const keys=["id","mode","rawEnvelopeJson","scope","expected","trustedObservedAt"] as const;
function check(input:unknown,fields:readonly string[]){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw Error();
 const names=Object.keys(input);if(names.length!==fields.length||names.some(k=>!fields.includes(k))||Object.getOwnPropertySymbols(input).some(k=>Object.getOwnPropertyDescriptor(input,k)?.enumerable))throw Error();return input;
}
function own(input:unknown,fields:readonly string[]){const source=check(input,fields),v=captureOwnEnumerableSelectors(source,fields);if(v===null)throw Error();check(source,fields);return v;}
// Two distinct recorded contracts: known-base unpaired head is not empty-head
// observation. This admission performs no read and never renews UTC evidence.
export function recordedIssuePreparationContext(input:unknown){
 try{
  const v=own(input,keys);if(v===null||typeof v.rawEnvelopeJson!=="string"||/[\ud800-\udfff]/u.test(v.rawEnvelopeJson)||Buffer.byteLength(v.rawEnvelopeJson,"utf8")>65536)throw Error();
  const raw=new TextEncoder().encode(v.rawEnvelopeJson),known=v.id==="known-base"&&v.mode==="known_base",empty=v.id==="empty-head"&&v.mode==="empty_current_head";
  if(!known&&!empty)throw Error();
  const scopeKeys=known?["runId","decisionId","issueId","basePublicationId"]:["runId","decisionId","issueId"],expectedKeys=["source","head"],sourceKeys=["sourceVersionId","contentSha256","itemKey","locator","jurisdictionId"],headKeys=["contentSha256","changedAt"];
  const scope=own(v.scope,scopeKeys),expected=own(v.expected,expectedKeys),source=own(expected.source,sourceKeys),head=known&&expected.head!==null?own(expected.head,headKeys):expected.head;
  // Capture nested selectors before parsing, then check every original shape:
  // a later nested getter can mutate a parent or an earlier captured sibling.
  const snapshot={source,head};
  const result=known?Object.freeze({kind:"known_base" as const,result:parseStoredIssuePreparationContext(raw,scope,snapshot,v.trustedObservedAt)}):Object.freeze({kind:"empty_current_head" as const,result:parseStoredEmptyIssuePreparationContext(raw,scope,snapshot,v.trustedObservedAt)});
  if(known&&expected.head!==null)check(expected.head,headKeys);
  check(expected.source,sourceKeys);check(v.expected,expectedKeys);check(v.scope,scopeKeys);check(input,keys);return result;
 }catch{return null;}
}
