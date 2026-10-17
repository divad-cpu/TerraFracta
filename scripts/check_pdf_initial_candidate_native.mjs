// Fixed pure PDF command/read/parse bridge. No connection or SQL execution.
import {readSync,writeSync} from 'node:fs';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {preparePdfInitialCandidateCaptureForWork as prepare,preparePdfInitialCandidateCaptureRead as read,parseStoredPdfInitialCandidateCapture as parse} from '../src/server/pdf-initial-candidate-capture.ts';
function write(fd,raw){let sent=0;while(sent<raw.length){const count=writeSync(fd,raw,sent,raw.length-sent);if(!Number.isInteger(count)||count<1)throw Error();sent+=count;}}
try{
 if(process.argv.length!==2)throw Error();
 const input=Buffer.alloc(294913);let size=0;while(size<input.length){const n=readSync(0,input,size,input.length-size,null);if(!n)break;size+=n;}
 if(size<2||size>294912)throw Error();const bytes=input.subarray(0,size),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes);
 if(!Buffer.from(text,'utf8').equals(bytes))throw Error();const v=JSON.parse(text);
 const fields={prepare:['mode','work','rawReport','expected'],read:['mode','intentJson'],parse:['mode','rawBase64','intentJson','expected','observedAt']};
 if(v===null||typeof v!=='object'||Array.isArray(v)||!Object.hasOwn(fields,v.mode)||Object.keys(v).sort().join('|')!==fields[v.mode].sort().join('|')||canonical(v)!==text)throw Error();
 let result;
 if(v.mode==='prepare'){const c=prepare(v.work,v.rawReport,v.expected);result={state:'PASS_INVENTED_PDF_INITIAL_COMMAND',sql:c.sql,values:c.values,work:c.work,intentJson:c.intentJson,intentSha256:c.intentSha256,receiptEstimate:c.receiptEstimate};}
 else if(v.mode==='read')result=read(v.intentJson);
 else{
  if(typeof v.rawBase64!=='string'||v.rawBase64.length>174764||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.rawBase64))throw Error();
  const raw=Buffer.from(v.rawBase64,'base64');if(raw.length<2||raw.length>131072||raw.toString('base64')!==v.rawBase64)throw Error();
  const r=parse(raw,v.intentJson,v.expected,v.observedAt);result={state:'PASS_INVENTED_PDF_INITIAL_PARSE',captureId:r.capture.captureId,receiptSha256:r.receiptSha256,preparationReceiptSha256:r.preparation.report.preparation.receipt_sha256,preparationIntentJson:r.preparation.report.intent_json,storedAt:r.storedAt,captureObservedAt:r.observedAt,candidateClaims:r.preparation.candidate.payload.snapshot.claims.length,nullBase:r.capture.basePublicationId===null};
 }
 const output=Buffer.from(JSON.stringify(result),'utf8');if(output.length>131072)throw Error();write(1,output);
}catch{try{write(2,Buffer.from('pdf_initial_contract_unavailable\n'));}catch{}process.exitCode=1;}
