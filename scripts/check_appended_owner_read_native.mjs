// Fixed offline byte bridge; no connection, target, fetch, credentials or writes.
import {readSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareAppendedCaptureLookup,parseAppendedCaptureLookup} from '../src/server/appended-capture-lookup.ts';
import {prepareAppendedIssueCaptureRead} from '../src/server/appended-issue-capture.ts';
import {createSelectedAppendedCaptureReader} from '../src/server/appended-capture-selection.ts';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
function bytes(v,max){if(typeof v!=='string'||v.length>4*Math.ceil(max/3))throw Error();const b=Buffer.from(v,'base64');if(b.length<1||b.length>max||b.toString('base64')!==v)throw Error();return b;}
try{
 const b=Buffer.alloc(294913);let n=0;while(n<b.length){const count=readSync(0,b,n,b.length-n,null);if(!count)break;n+=count;}
 if(n<2||n>294912)throw Error();const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(b.subarray(0,n));if(!Buffer.from(text,'utf8').equals(b.subarray(0,n)))throw Error();
 const v=JSON.parse(text);let result;
 if(v.mode==='lookupPrepare')result=prepareAppendedCaptureLookup(v.report,v.expected,v.observedAt);
 else if(v.mode==='lookupParse'){
  try{result={kind:'ok',metadata:parseAppendedCaptureLookup(bytes(v.rawBase64,4096),v.report,v.expected,v.observedAt)};}catch{result={kind:'unavailable'};}
 }else if(v.mode==='readPrepare')result=prepareAppendedIssueCaptureRead(v.intentJson);
 else if(v.mode==='selection'){
  const s={...v.selection,lookupRaw:bytes(v.selection.lookupRawBase64,4096)};delete s.lookupRawBase64;
  const raw=bytes(v.rawBase64,131072);let providerCalls=0,providerCommand;const diagnosticCodes=[];
  const read=createSelectedAppendedCaptureReader(async(command)=>{providerCalls++;providerCommand=command;return raw;},()=>0,code=>{diagnosticCodes.push(code);});
  const out=await read(s);
  result=out.kind==='ok'?{kind:out.kind,providerCalls,providerCommand,receiptSha256:out.stored.receiptSha256,storedAt:out.stored.storedAt,selected:out.selected,candidateReportSha256:sha(out.stored.bundle.candidateReportJson),evidenceState:out.evidenceState,diagnosticCodes}:{kind:out.kind,providerCalls,diagnosticCodes};
 }else throw Error();
 const encoded=Buffer.from(JSON.stringify(result),'utf8');if(encoded.length>131072)throw Error();writeSync(1,encoded);
}catch{writeSync(2,'appended_owner_read_boundary_unavailable\n');process.exitCode=1;}
