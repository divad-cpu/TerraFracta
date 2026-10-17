// Pure fixed initial-HTML transfer contracts, never a connection or writer.
import {readSync,writeSync} from 'node:fs';
import {prepareHtmlInitialCandidateCaptureForWork as prepare,prepareHtmlInitialCandidateCaptureRead as read,parseStoredHtmlInitialCandidateCapture as parse} from '../src/server/html-initial-candidate-capture.ts';
import {compareStoredHtmlInitialCandidateCapture as compare} from '../src/server/html-initial-candidate-comparison.ts';
try{
 if(process.argv.length!==2)throw Error();
 const input=Buffer.alloc(294913);let size=0;for(;;){if(size===input.length)break;const n=readSync(0,input,size,input.length-size,null);if(!n)break;size+=n;}
 if(size<2||size>294912)throw Error();const bytes=input.subarray(0,size),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes);if(!Buffer.from(text).equals(bytes))throw Error();
 const v=JSON.parse(text),keys={prepare:['mode','work','rawReport','expected'],read:['mode','intentJson'],parse:['mode','rawBase64','intentJson','expected','observedAt'],compare:['mode','rawBase64','intentJson','expected','observedAt','actualReport']};
 if(v===null||typeof v!=='object'||Array.isArray(v)||!Object.hasOwn(keys,v.mode)||Object.keys(v).sort().join('|')!==keys[v.mode].sort().join('|'))throw Error();
 let result;
 if(v.mode==='prepare'){const c=prepare(v.work,v.rawReport,v.expected);result={state:'PASS_INVENTED_HTML_INITIAL_COMMAND',sql:c.sql,values:c.values,work:c.work,intentJson:c.intentJson,intentSha256:c.intentSha256,receiptEstimate:c.receiptEstimate};}
 else if(v.mode==='read')result=read(v.intentJson);
 else{
  if(typeof v.rawBase64!=='string'||v.rawBase64.length>174764||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.rawBase64))throw Error();
  const raw=Buffer.from(v.rawBase64,'base64');if(raw.length<2||raw.length>131072||raw.toString('base64')!==v.rawBase64)throw Error();
  const joined=v.mode==='compare'?compare(raw,v.intentJson,v.expected,v.observedAt,v.actualReport):null,stored=joined?.stored??parse(raw,v.intentJson,v.expected,v.observedAt);
  result={state:v.mode==='compare'?'PASS_INVENTED_HTML_INITIAL_COMPARISON':'PASS_INVENTED_HTML_INITIAL_PARSE',captureId:stored.capture.captureId,receiptSha256:stored.receiptSha256,preparationReceiptSha256:stored.preparation.preparation.receipt_sha256,preparationIntentJson:JSON.parse(stored.reportJson).intent_json,storedAt:stored.storedAt,captureObservedAt:stored.observedAt,candidateClaims:stored.preparation.snapshot.claims.length};
  if(joined){result.actualStatus=joined.report.status;result.baseIsNull=joined.report.base===null;result.reviewerObservedAt=joined.report.observedAt;}
 }
 const encoded=Buffer.from(JSON.stringify(result),'utf8');if(encoded.length>131072)throw Error();writeSync(1,encoded);
}catch{writeSync(2,'html_initial_contract_unavailable\n');process.exitCode=1;}
