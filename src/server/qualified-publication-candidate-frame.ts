import { createHash } from "node:crypto";
import { canonicalProposalJson } from "../operator-proposal-capture.ts";
import { materializePublicIssueFromRows,type CandidatePublicReadRows } from "../public-read-materializer.ts";
import { publicationReadEnvelopeSchema } from "../public-issue-projection.ts";
import { z } from "zod";
const contentHash=z.string().regex(/^[a-f0-9]{64}$/);
const instant=z.iso.datetime({offset:true}).refine(value=>!value.startsWith("0000-")&&(value.match(/\.(\d+)/)?.[1].length??0)<=9);
const sha=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
// Own data only, including array elements/length. No inherited or accessor
// review authority, symbol slots, unusual prototypes or hidden extra fields.
export function detachPublicationCandidateData(input:unknown,code="Publication candidate unavailable"):unknown {
 let nodes=0;
 function copy(value:unknown,depth:number):unknown {
  if(++nodes>100_000||depth>32)throw Error(code);
  if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error(code);return value;}
  if(typeof value!=='object')throw Error(code);
  const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
  if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw Error(code);
  const keys=Reflect.ownKeys(value);if(keys.some(key=>typeof key!=='string'))throw Error(code);
  if(array){
   const descriptor=Object.getOwnPropertyDescriptor(value,'length');
   if(!descriptor||!('value'in descriptor)||!Number.isSafeInteger(descriptor.value)||descriptor.value<0||descriptor.value>4096||keys.length!==descriptor.value+1)throw Error(code);
   const result:unknown[]=[];
   for(let index=0;index<descriptor.value;index++){const d=Object.getOwnPropertyDescriptor(value,String(index));if(!d?.enumerable||!('value'in d))throw Error(code);result.push(copy(d.value,depth+1));}
   return result;
  }
  const result=Object.create(null)as Record<string,unknown>;
  for(const key of keys as string[]){const d=Object.getOwnPropertyDescriptor(value,key);if(!d?.enumerable||!('value'in d))throw Error(code);result[key]=copy(d.value,depth+1);}
  return result;
 }
 return copy(input,0);
}
export function publicationCandidateSnapshotSha256(input:unknown,code="Publication candidate unavailable"):string {
 const raw=detachPublicationCandidateData(input,code),parsed=publicationReadEnvelopeSchema.shape.publication.shape.snapshot.parse(raw);
 if(canonicalProposalJson(raw)!==canonicalProposalJson(parsed))throw Error(code);
 return sha(canonicalProposalJson(parsed));
}

// Full v1 gates and raw snapshot/source identities captured before candidate callbacks.
export function qualifiedPublicationCandidateFrame(rows:CandidatePublicReadRows,code="Publication candidate unavailable"){
 const baseRows=detachPublicationCandidateData(rows,code)as CandidatePublicReadRows;
 const issue=materializePublicIssueFromRows(baseRows);
 const baseSnapshotSha256=publicationCandidateSnapshotSha256(baseRows.publication.snapshot,code);
 const baseFinal=instant.parse(baseRows.publication_display_review?.reviewed_at);
 const cited=[...new Set(issue.claims.flatMap(claim=>claim.evidence.map(source=>source.sourceVersionId)))];
 if(cited.length>120||new Set(cited.map(id=>id.toLowerCase())).size!==cited.length)throw Error(code);
 const sources=new Map<string,{contentSha256:string;retrievedAt:string}>();
 for(const id of cited){
  const matching=baseRows.sources.filter(source=>source.version.id===id);if(matching.length!==1)throw Error(code);
  const version=matching[0].version;
  const contentSha256=contentHash.parse(version.content_sha256),retrievedAt=instant.parse(version.retrieved_at);
  sources.set(id,{contentSha256,retrievedAt});
 }
 return{issue,baseSnapshotSha256,baseFinalReviewedAt:baseFinal,sources};
}
