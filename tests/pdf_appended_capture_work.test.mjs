import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePdfAppendedCaptureForWork as prepare,PDF_APPENDED_WORK_CAPTURE_SQL} from '../src/server/pdf-appended-capture-work.ts';
import {preparePdfAppendedIssueCapture as complete} from '../src/server/pdf-appended-issue-capture.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';

// Existing actual24974B invented producer output; no Python/PDF regeneration.
const bytes=readFileSync(new URL('../fixtures/fictional-pdf-appended-issue-review.json',import.meta.url));
const fixture=JSON.parse(bytes),sample=()=>structuredClone(fixture);
const parts=['candidateReportJson','baselineJson','canonicalBaselineJson','contextJson','proposalJson','compositionJson'];
const b64=s=>Buffer.from(s,'utf8').toString('base64'),sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const scope=v=>({runId:JSON.parse(JSON.parse(v.bundle.candidateReportJson).parts.selection_json).runId,requestFingerprint:'c'.repeat(64),workClaimId:'cc000000-0000-4000-8000-000000000999'});
const refuse=fn=>assert.throws(fn,/^Error: pdf_appended_capture_work_unavailable$/);

test('fixed work10 preserves exact six parts and all independent selectors without exposing either internal command',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));
 assert.equal(bytes.length,24974);assert.equal(sha(bytes),'3ae5a88706e5bc8f4de421b418d1b9358f3454e218c11f2fc5b71e68001f9351');
 const v=sample(),w=scope(v),inner=complete(v.bundle,v.expected),prepared=prepare(w,v.bundle,v.expected),intent=JSON.parse(prepared.intentJson);
 assert.equal(prepared.sql,PDF_APPENDED_WORK_CAPTURE_SQL);assert.deepEqual(prepared.sql.match(/\$\d+/g),Array.from({length:10},(_,i)=>'$'+(i+1)));
 assert.deepEqual(prepared.values,[w.runId,w.requestFingerprint,w.workClaimId,...inner.values]);assert.equal(prepared.intentJson,inner.intentJson);assert.equal(prepared.intentSha256,sha(inner.intentJson));
 assert.deepEqual(prepared.bundle,v.bundle);assert.deepEqual(prepared.expected,v.expected);assert.deepEqual(prepared.work,w);
 assert.deepEqual(prepared.values.slice(3),[b64(prepared.intentJson),...parts.map(k=>b64(v.bundle[k]))]);assert.equal(intent.part_sha256.length,6);assert.equal(intent.preparation_artifact_id,v.expected.preparationArtifactId);assert.equal(intent.preparation_stored_at,v.expected.preparationStoredAt);
 assert.ok(prepared.receiptEstimate<=131072);assert.ok(Buffer.byteLength(canonical({sql:prepared.sql,values:prepared.values}))<=294912);
 assert.deepEqual(Object.keys(prepared).sort(),['sql','values','work','bundle','expected','intentJson','intentSha256','receiptEstimate','evidenceState'].sort());
 for(const forbidden of ['capture','capturePreparation','generic','selection','encodedProposal'])assert.equal(Object.hasOwn(prepared,forbidden),false);
 assert.match(prepared.evidenceState,/unexecuted_complete_association_requires_current_outer_work_fence/);
});

test('critical work UUID4 fingerprint and candidate run link retain the existing strict work grammar',()=>{
 const v=sample(),w=scope(v);
 for(const work of [null,[],{}, {...w,runId:'cc000000-0000-4000-8000-000000000998'}, {...w,runId:w.runId.replace('-4000-','-5000-')}, {...w,workClaimId:'cc000000-0000-1000-8000-000000000999'}, {...w,workClaimId:'cc000000-0000-5000-8000-000000000999'}, {...w,workClaimId:w.workClaimId.toUpperCase()}, {...w,requestFingerprint:'C'.repeat(64)}, {...w,requestFingerprint:'c'.repeat(63)}, {...w,requestFingerprint:true}, {...w,extra:'PRIVATE'}])refuse(()=>prepare(work,v.bundle,v.expected));
 assert.deepEqual(prepare(Object.assign(Object.create(null),w),v.bundle,v.expected).work,w);
});

test('work snapshot rejects getters symbols hidden keys and foreign prototypes without evaluating private accessors',()=>{
 const v=sample(),w=scope(v);let calls=0;
 for(const key of Object.keys(w)){
  const input={...w};Object.defineProperty(input,key,{enumerable:true,get(){calls++;throw Error('PRIVATE_WORK_GETTER');}});refuse(()=>prepare(input,v.bundle,v.expected));
 }
 for(const change of [o=>o[Symbol('PRIVATE')]='x',o=>Object.defineProperty(o,'PRIVATE',{value:'x'}),o=>Object.defineProperty(o,'runId',{value:w.runId,enumerable:false}),o=>Object.setPrototypeOf(o,{PRIVATE:'x'})]){const input={...w};change(input);refuse(()=>prepare(input,v.bundle,v.expected));}
 assert.equal(calls,0);
});

test('all eight independent selectors remain mandatory and cannot be inferred from the supplied parts',()=>{
 const v=sample(),w=scope(v);
 for(const key of Object.keys(v.expected)){const e={...v.expected};delete e[key];refuse(()=>prepare(w,v.bundle,e));}
 for(const[key,value]of [['compositionSha256','f'.repeat(64)],['candidateReportSha256','f'.repeat(64)],['preparationIntentJson','{}'],['baselineSha256','f'.repeat(64)],['contextSha256','f'.repeat(64)],['observedAt','2026-02-30T00:00:00.000000Z'],['preparationArtifactId','cc000000-0000-4000-8000-000000000998'],['preparationStoredAt','2026-10-17T23:59:59.000000Z']])refuse(()=>prepare(w,v.bundle,{...v.expected,[key]:value}));
 let calls=0;const e={...v.expected};Object.defineProperty(e,'observedAt',{enumerable:true,get(){calls++;throw Error('PRIVATE_EXPECTED');}});refuse(()=>prepare(w,v.bundle,e));assert.equal(calls,0);
});

test('each complete carrier corruption malformed known head and native byte bound refuse instead of dropping the PDF companion',()=>{
 const v=sample(),w=scope(v);
 for(const key of parts)refuse(()=>prepare(w,{...v.bundle,[key]:v.bundle[key]+' '},v.expected));
 for(const[key,cap]of [['candidateReportJson',262144],['baselineJson',24576],['canonicalBaselineJson',24576],['contextJson',32768],['proposalJson',16384],['compositionJson',65536]])refuse(()=>prepare(w,{...v.bundle,[key]:'x'.repeat(cap+1)},v.expected));
 for(const value of[null,[],{...v.bundle,extra:true},{...v.bundle,proposalJson:Buffer.from('PRIVATE')},{...v.bundle,proposalJson:'\ud800'}])refuse(()=>prepare(w,value,v.expected));
 const empty=sample(),report=JSON.parse(empty.bundle.candidateReportJson),selection=JSON.parse(report.parts.selection_json);selection.basePublicationId=null;report.parts.selection_json=canonical(selection);empty.bundle.candidateReportJson=canonical(report);empty.expected.candidateReportSha256=sha(empty.bundle.candidateReportJson);refuse(()=>prepare(scope(v),empty.bundle,empty.expected));
});

test('output owns immutable complete bytes and original work before later accepted descriptor callbacks',()=>{
 const v=sample(),w=scope(v),before=structuredClone({bundle:v.bundle,expected:v.expected,work:w});let callbacks=0;
 // Proxy traps are not a security sandbox. This bounded callback merely proves
 // delegation cannot retarget the primitive work snapshot already captured.
 const e=new Proxy(v.expected,{getOwnPropertyDescriptor(target,key){callbacks++;w.runId='cc000000-0000-4000-8000-000000000998';w.requestFingerprint='0'.repeat(64);return Reflect.getOwnPropertyDescriptor(target,key);}});
 const prepared=prepare(w,v.bundle,e);assert.ok(callbacks>0);assert.deepEqual(prepared.work,before.work);
 for(const key of Object.keys(v.bundle))v.bundle[key]='PRIVATE_MUTATED';for(const key of Object.keys(v.expected))v.expected[key]='PRIVATE_MUTATED';w.workClaimId='PRIVATE_MUTATED';
 assert.deepEqual(prepared.bundle,before.bundle);assert.deepEqual(prepared.expected,before.expected);assert.deepEqual(prepared.work,before.work);
 assert.ok(Object.isFrozen(prepared)&&Object.isFrozen(prepared.values)&&Object.isFrozen(prepared.work)&&Object.isFrozen(prepared.bundle)&&Object.isFrozen(prepared.expected));
 assert.throws(()=>{prepared.values[3]='PRIVATE';},TypeError);assert.throws(()=>{prepared.work.runId='PRIVATE';},TypeError);assert.throws(()=>{prepared.bundle.proposalJson='PRIVATE';},TypeError);assert.throws(()=>{prepared.expected.preparationIntentJson='PRIVATE';},TypeError);
});

test('new source is a pure complete wrapper with fixed SQL and no dispatch backend or companionless public return',()=>{
 const source=readFileSync(new URL('../src/server/pdf-appended-capture-work.ts',import.meta.url),'utf8');
 assert.match(source,/prepareWorkProposalCapture\(originalWork,/);assert.match(source,/preparePdfAppendedIssueCapture\(bundle,independentExpected\)/);
 assert.doesNotMatch(source,/createPostgres|Client\b|process\.env|fetch\(|capture_held_proposal\(|export function (?:recover|read|capture)\b/);
 assert.equal((source.match(/export function /g)??[]).length,1);assert.doesNotMatch(source,/return Object\.freeze\(\{[^;]*(?:capturePreparation|capture:|generic:)/s);
});
