import { createHash } from "node:crypto";
import { z } from "zod";
import { captureOwnEnumerableSelectors } from "../own-enumerable-selectors.ts";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { proposalCaptureSelectionSchema } from "./proposal-capture-command.ts";
import { detachedPreparationIntentSchema } from "./detached-preparation-report.ts";
import { prepareDetachedExtractionProposalCapture } from "./private-extraction-held-proposal.ts";
import { decodeProposalCapture } from "./proposal-capture.ts";
import { recordedIssuePreparationContext } from "./recorded-issue-preparation-context.ts";
import { schemaCheckedUtcMicroseconds as micros } from "../exact-utc-observation.ts";

const keys=["schemaVersion","kind","scope","id","intentJson","parts","expected","observedContext"] as const;
const scalarText=(maximum:number)=>z.string().refine(s=>s.length>0&&!/[\ud800-\udfff]/u.test(s)&&Buffer.byteLength(s,"utf8")<=maximum);
const partsSchema=z.strictObject({payloadJson:scalarText(16384),selectionJson:scalarText(2048),provenanceJson:scalarText(65536),contextJson:scalarText(32768)});
const expectedSchema=z.strictObject({intentSha256:z.string().regex(/^[a-f0-9]{64}$/),selection:proposalCaptureSelectionSchema});
const sha=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
function check(input:unknown,fields:readonly string[]){
 if(input===null||typeof input!=="object"||Array.isArray(input))throw Error();
 const names=Object.keys(input);if(names.length!==fields.length||names.some(k=>!fields.includes(k))||Object.getOwnPropertySymbols(input).some(k=>Object.getOwnPropertyDescriptor(input,k)?.enumerable))throw Error();return input;
}
function own(input:unknown,fields:readonly string[]){const source=check(input,fields),v=captureOwnEnumerableSelectors(source,fields);if(v===null)throw Error();check(source,fields);return v;}
function canonical(raw:string){const value:unknown=JSON.parse(raw);if(canonicalProposalJson(value)!==raw)throw Error();return value;}
function object(input:unknown):Record<string,unknown>{if(input===null||typeof input!=="object"||Array.isArray(input))throw Error();return input as Record<string,unknown>;}
// A recorded pure result has no preparation-store receipt or capture. Reuse the
// original admission; never invent either record to fit the stored-report view.
// Bound intent identity is a consistency expectation, not issuer authentication.
export function recordedUnstoredPreparation(input:unknown){
 try{
  const v=own(input,keys);
  if(v.schemaVersion!==1||v.kind!=="fictional_unstored_preparation"||v.scope!=="invented_recorded_pure_preparation_only"||v.id!=="empty-head")throw Error();
  const intentJson=scalarText(4096).parse(v.intentJson),parts=partsSchema.parse(own(v.parts,["payloadJson","selectionJson","provenanceJson","contextJson"]));
  const expectedInput=own(v.expected,["intentSha256","selection"]),selectionKeys=["captureId","runId","decisionId","issueId","basePublicationId"];
  const expected=expectedSchema.parse({...expectedInput,selection:own(expectedInput.selection,selectionKeys)});
  check(v.expected,["intentSha256","selection"]);
  if(sha(intentJson)!==expected.intentSha256)throw Error();
  const metadata=detachedPreparationIntentSchema.parse(canonical(intentJson));
  if(canonicalProposalJson(metadata)!==intentJson)throw Error();
  for(const [part,key]of [["payloadJson","payload_sha256"],["selectionJson","selection_sha256"],["provenanceJson","provenance_sha256"],["contextJson","context_raw_sha256"]]as const)if(sha(parts[part])!==metadata[key])throw Error();
  const proof=object(canonical(parts.provenanceJson)),context=object(canonical(parts.contextJson)),content=object(context.content);
  if(canonicalProposalJson(context)!==canonicalProposalJson(proof.independent_context)||proof.supplied_context_sha256!==metadata.context_raw_sha256||proof.prepared_at!==metadata.prepared_at)throw Error();
  const observed=recordedIssuePreparationContext(v.observedContext);
  if(observed?.kind!=="empty_current_head"||observed.result.kind!=="ok")throw Error();
  const actual=observed.result.context;
  if(canonicalProposalJson(context.held)!==canonicalProposalJson(actual.held)||canonicalProposalJson(context.issue)!==canonicalProposalJson(actual.issue)||
    micros(metadata.prepared_at)<micros(actual.trustedObservedAt)||expected.selection.basePublicationId!==null)throw Error();
  const prepared=prepareDetachedExtractionProposalCapture({payloadJson:parts.payloadJson,selectionJson:parts.selectionJson,provenanceJson:parts.provenanceJson},
   {selection:expected.selection,provenanceSha256:metadata.provenance_sha256,artifactOperationId:metadata.extraction_operation_id,artifactId:metadata.extraction_artifact_id,
    requestSha256:metadata.extraction_request_sha256,outputSha256:metadata.extraction_output_sha256,claimId:content.claim_id});
  const snapshot=decodeProposalCapture(parts.payloadJson,prepared.capturePreparation.proposalSha256).snapshot;
  check(v.parts,["payloadJson","selectionJson","provenanceJson","contextJson"]);check(expectedInput.selection,selectionKeys);check(v.expected,["intentSha256","selection"]);check(input,keys);
  return Object.freeze({metadata,selection:expected.selection,snapshot,context:actual,intentSha256:expected.intentSha256,
   evidenceState:"invented_recorded_pure_preparation_not_stored_or_captured" as const,snapshotIntent:prepared.snapshotIntent});
 }catch{return null;}
}
