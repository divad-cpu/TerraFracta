// Pure fixed bridge; actual SQL execution remains in the separately owned lab.
import assert from 'node:assert/strict';
import {readSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareInitialCandidateCaptureForWork,prepareInitialCandidateCaptureRead,parseStoredInitialCandidateCapture} from '../src/server/initial-candidate-capture.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
try{
 const bytes=Buffer.alloc(294913);let size=0;while(size<bytes.length){const n=readSync(0,bytes,size,bytes.length-size,null);if(n===0)break;size+=n;}assert.ok(size>=2&&size<=294912);const input=bytes.subarray(0,size),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(input);assert.ok(Buffer.from(text).equals(input));const v=JSON.parse(text);
 const modes={prepare:['mode','work','report','expected'],read:['mode','intentJson'],parse:['mode','rawBase64','intentJson','expected','observedAt']};assert.ok(Object.hasOwn(modes,v.mode));assert.deepEqual(Object.keys(v).sort(),modes[v.mode].sort());let out;
 if(v.mode==='prepare'){
  const p=prepareInitialCandidateCaptureForWork(v.work,v.report,v.expected);assert.equal(p.values.length,5);assert.equal(p.intentSha256,sha(Buffer.from(p.intentJson)));assert.equal(Buffer.from(p.values[3],'base64').toString('utf8'),p.intentJson);assert.equal(Buffer.from(p.values[4],'base64').toString('utf8'),v.report);out={sql:p.sql,values:p.values,intentJson:p.intentJson,intentSha256:p.intentSha256,evidenceState:p.evidenceState};
 }else if(v.mode==='read'){const p=prepareInitialCandidateCaptureRead(v.intentJson);out={sql:p.sql,values:p.values};}
 else{
  assert.equal(typeof v.rawBase64,'string');assert.match(v.rawBase64,/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);const raw=Buffer.from(v.rawBase64,'base64');assert.equal(raw.toString('base64'),v.rawBase64);assert.ok(raw.length>=2&&raw.length<=131072);const p=parseStoredInitialCandidateCapture(raw,v.intentJson,v.expected,v.observedAt);assert.equal(p.receiptSha256,sha(raw));out={capture:p.capture,preparationOperationId:p.preparation.preparation.operation_id,reportJson:p.reportJson,intentJson:p.intentJson,storedAt:p.storedAt,observedAt:p.observedAt,receiptSha256:p.receiptSha256,evidenceState:p.evidenceState};
 }
 const output=Buffer.from(JSON.stringify(out));assert.ok(output.length<=131072);writeSync(1,output);
}catch{writeSync(2,'initial_candidate_native_bridge_unavailable\n');process.exitCode=1;}
