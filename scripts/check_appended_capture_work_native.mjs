// Fixed pure local bridge. No connection, SQL dispatch or target selection.
import {readSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareAppendedIssueCapture,parseStoredAppendedIssueCapture} from '../src/server/appended-issue-capture.ts';
import {prepareAppendedIssueCaptureForWork,recoverAppendedIssueCaptureForWork} from '../src/server/appended-capture-work.ts';
import {compareStoredAppendedIssueCapture} from '../src/server/appended-capture-comparison.ts';
import {parseCapturedProposalEnvelope} from '../src/server/proposal-capture.ts';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
function raw(value){if(typeof value!=='string'||value.length>174764)throw Error();const b=Buffer.from(value,'base64');if(b.length<2||b.length>131072||b.toString('base64')!==value)throw Error();return b;}
function command(c){const m=c.capture??c;return {sql:c.sql,values:c.values,intentJson:m.intentJson,intentSha256:m.intentSha256,receiptEstimate:m.receiptEstimate,evidenceState:c.evidenceState};}
function summary(value){const b=value.bundle,r=JSON.parse(b.candidateReportJson);return {receiptSha256:value.receiptSha256,capture:value.capture,storedAt:value.storedAt,observedAt:value.observedAt,candidatePreparationIntentJson:r.intent_json,candidateFourPartSha256:['payload_json','selection_json','provenance_json','context_json'].map(k=>sha(r.parts[k])),candidateFullReceiptSha256:r.preparation.full_receipt_sha256,compositionSha256:sha(b.compositionJson),baselineSha256:sha(b.baselineJson),proposalSha256:sha(b.proposalJson),evidenceState:value.evidenceState};}
try{
 const buffer=Buffer.alloc(294913);let count=0;while(count<buffer.length){const n=readSync(0,buffer,count,buffer.length-count,null);if(n===0)break;count+=n;}
 if(count<2||count>294912)throw Error();const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,count));if(!Buffer.from(text,'utf8').equals(buffer.subarray(0,count)))throw Error();
 const input=JSON.parse(text);let output;
 if(input.mode==='manual')output=command(prepareAppendedIssueCapture(input.bundle,input.expected));
 else if(input.mode==='prepare')output=command(prepareAppendedIssueCaptureForWork(input.work,input.bundle,input.expected));
 else if(input.mode==='recover')output=command(recoverAppendedIssueCaptureForWork(input.work,raw(input.rawBase64),input.intentJson,input.observedAt));
 else if(input.mode==='parse')output=summary(parseStoredAppendedIssueCapture(raw(input.rawBase64),input.intentJson,input.observedAt));
 else if(input.mode==='compare'){const actual=parseCapturedProposalEnvelope(input.actualReport),value=compareStoredAppendedIssueCapture(raw(input.rawBase64),input.intentJson,input.observedAt,actual);output={...summary(value.stored),actualStatus:value.report.status,baselineClaims:JSON.parse(value.stored.bundle.baselineJson).snapshot.claims.length,proposedClaims:JSON.parse(value.stored.bundle.proposalJson).snapshot.claims.length,evidenceState:value.evidenceState};}
 else throw Error();
 const encoded=Buffer.from(JSON.stringify(output),'utf8');if(encoded.length>131072)throw Error();writeSync(1,encoded);
}catch{writeSync(2,'appended_work_native_boundary_unavailable\n');process.exitCode=1;}
