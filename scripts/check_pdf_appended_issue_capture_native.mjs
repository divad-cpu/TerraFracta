// Fixed pure known-base PDF bridge. No connection, writer or input path.
import {readSync,writeSync} from 'node:fs';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {preparePdfAppendedIssueCapture as prepare,preparePdfAppendedIssueCaptureRead as read,parseStoredPdfAppendedIssueCapture as parse} from '../src/server/pdf-appended-issue-capture.ts';
try{
 if(process.argv.length!==2)throw Error();
 const input=Buffer.alloc(294913);let size=0;while(size<input.length){const n=readSync(0,input,size,input.length-size,null);if(!n)break;size+=n;}
 if(size<2||size>294912)throw Error();const raw=input.subarray(0,size),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(raw),v=JSON.parse(text);
 const modes={prepare:['mode','bundle','expected'],read:['mode','intentJson'],parse:['mode','rawBase64','intentJson','expected','observedAt']};
 if(v===null||typeof v!=='object'||Array.isArray(v)||!Object.hasOwn(modes,v.mode)||Object.keys(v).sort().join('|')!==modes[v.mode].sort().join('|')||canonical(v)!==text)throw Error();
 let result;
 if(v.mode==='prepare'){const p=prepare(v.bundle,v.expected);result={sql:p.sql,values:p.values,intentJson:p.intentJson,intentSha256:p.intentSha256,receiptEstimate:p.receiptEstimate};}
 else if(v.mode==='read')result=read(v.intentJson);
 else{
  if(typeof v.rawBase64!=='string'||v.rawBase64.length>174764||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.rawBase64))throw Error();
  const bytes=Buffer.from(v.rawBase64,'base64');if(bytes.length<2||bytes.length>131072||bytes.toString('base64')!==v.rawBase64)throw Error();
  const r=parse(bytes,v.intentJson,v.expected,v.observedAt);result={state:'PASS_INVENTED_PDF_WHOLE_CAPTURE_PARSE',captureId:r.capture.captureId,storedAt:r.storedAt,receiptSha256:r.receiptSha256,basePublicationId:r.capture.basePublicationId,parts:Object.keys(r.bundle).length};
 }
 const output=Buffer.from(JSON.stringify(result));if(output.length>131072)throw Error();let sent=0;while(sent<output.length){const n=writeSync(1,output,sent,output.length-sent);if(n<1)throw Error();sent+=n;}
}catch{writeSync(2,Buffer.from('pdf_appended_contract_unavailable\n'));process.exitCode=1;}
