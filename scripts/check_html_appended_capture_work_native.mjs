// Fixed pure local bridge. No connection, SQL dispatch or target selection.
import {readSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareHtmlAppendedIssueCapture,parseStoredHtmlAppendedIssueCapture} from '../src/server/html-appended-issue-capture.ts';
import {prepareHtmlAppendedIssueCaptureForWork,recoverHtmlAppendedIssueCaptureForWork} from '../src/server/html-appended-capture-work.ts';
import {compareStoredHtmlAppendedIssueCapture} from '../src/server/html-appended-capture-comparison.ts';
import {parseCapturedProposalEnvelope} from '../src/server/proposal-capture.ts';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
function raw(value){if(typeof value!=='string'||value.length>174764)throw Error();const b=Buffer.from(value,'base64');if(b.length<2||b.length>131072||b.toString('base64')!==value)throw Error();return b;}
function command(c){const m=c.capture??c;return {sql:c.sql,values:c.values,intentJson:m.intentJson,intentSha256:m.intentSha256,receiptEstimate:m.receiptEstimate,evidenceState:c.evidenceState};}
function summary(value){const b=value.bundle,r=JSON.parse(b.candidateReportJson);return {receiptSha256:value.receiptSha256,capture:value.capture,storedAt:value.storedAt,observedAt:value.observedAt,candidatePreparationIntentJson:r.intent_json,candidateFourPartSha256:['payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256'].map(k=>JSON.parse(r.intent_json)[k]),candidateFullReceiptSha256:r.preparation.receipt_sha256,compositionSha256:sha(b.compositionJson),baselineSha256:sha(b.baselineJson),proposalSha256:sha(b.proposalJson),evidenceState:value.evidenceState};}
try{
 if(process.argv.length!==2)throw Error();
 const buffer=Buffer.alloc(294913);let count=0;while(count<buffer.length){const n=readSync(0,buffer,count,buffer.length-count,null);if(n===0)break;count+=n;}
 if(count<2||count>294912)throw Error();const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,count));if(!Buffer.from(text,'utf8').equals(buffer.subarray(0,count)))throw Error();
 const input=JSON.parse(text);let output;
 const fields={prepare:['bundle','expected','mode','work'],recover:['intentJson','mode','observedAt','rawBase64','work'],parse:['intentJson','mode','observedAt','rawBase64'],compare:['actualReport','intentJson','mode','observedAt','rawBase64']};
 if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(fields,input.mode)||JSON.stringify(Object.keys(input).sort())!==JSON.stringify(fields[input.mode]))throw Error();
 if(input.mode==='prepare')output=command(prepareHtmlAppendedIssueCaptureForWork(input.work,input.bundle,input.expected));
 else if(input.mode==='recover')output=command(recoverHtmlAppendedIssueCaptureForWork(input.work,raw(input.rawBase64),input.intentJson,input.observedAt));
 else if(input.mode==='parse')output=summary(parseStoredHtmlAppendedIssueCapture(raw(input.rawBase64),input.intentJson,input.observedAt));
 else if(input.mode==='compare'){const actual=parseCapturedProposalEnvelope(input.actualReport),value=compareStoredHtmlAppendedIssueCapture(raw(input.rawBase64),input.intentJson,input.observedAt,actual);output={...summary(value.stored),actualStatus:value.report.status,baselineClaims:JSON.parse(value.stored.bundle.baselineJson).snapshot.claims.length,proposedClaims:JSON.parse(value.stored.bundle.proposalJson).snapshot.claims.length,evidenceState:value.evidenceState};}
 else throw Error();
 const encoded=Buffer.from(JSON.stringify(output),'utf8');if(encoded.length>131072)throw Error();writeSync(1,encoded);
}catch{writeSync(2,'html_appended_work_native_boundary_unavailable\n');process.exitCode=1;}
