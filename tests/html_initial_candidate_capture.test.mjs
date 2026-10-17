import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {prepareHtmlInitialCandidateCaptureForWork as prepare,prepareHtmlInitialCandidateCaptureRead as read,parseStoredHtmlInitialCandidateCapture as parse,HTML_INITIAL_CANDIDATE_CAPTURE_SQL as WRITE,HTML_INITIAL_CANDIDATE_CAPTURE_READ_SQL as READ} from '../src/server/html-initial-candidate-capture.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {htmlInitialFixture as fixture,sha,b64,CAPTURED,STORED,OBSERVED} from './helpers/html_initial_candidate_fixture.mjs';
import {htmlPreparationReviewReport} from '../src/server/html-preparation-review-report.ts';
const other='90000000-0000-4000-8000-000000000999';
const refuse=fn=>assert.throws(fn,/^Error: html_initial_candidate_capture_unavailable$/);
const receive=(f,at=OBSERVED)=>parse(Buffer.from(JSON.stringify(f.value)),f.command.intentJson,f.expected,at);

test('properly rederived full HTML preparation and its originals retain actual empty-head and independent intent correspondence',()=>{
 const f=fixture(),r=f.report,p=JSON.parse(Buffer.from(f.fixture.fullReceipts.receipt,'base64')),m=JSON.parse(r.intent_json);
 assert.equal(r.kind,'private_html_preparation_review_report');assert.equal(f.selection.basePublicationId,null);
 assert.equal(sha(Buffer.from(f.fixture.fullReceipts.receipt,'base64')),r.preparation.receipt_sha256);
 assert.equal(Buffer.from(p.metadata_base64,'base64').toString(),f.expected.preparationIntentJson);
 assert.equal(Buffer.from(p.payload_base64,'base64').toString(),r.payload_json);
 assert.equal(Buffer.from(p.selection_base64,'base64').toString(),r.selection_json);
 assert.equal(Buffer.from(p.provenance_base64,'base64').toString(),r.provenance_json);
 assert.equal(sha(Buffer.from(p.context_base64,'base64')),m.context_raw_sha256);
 const e=JSON.parse(Buffer.from(f.fixture.fullReceipts.extraction_receipt,'base64'));
 assert.equal(sha(Buffer.from(f.fixture.fullReceipts.extraction_receipt,'base64')),r.extraction.artifact.receipt_sha256);
 for(const k of ['current','previous'])assert.equal(sha(Buffer.from(f.fixture.fullReceipts[k+'_receipt'],'base64')),r.extraction.originals[k].receipt_sha256);
 assert.equal(e.kind,'invented_html_extraction_stored');assert.equal(JSON.parse(r.payload_json).kind,'review_only');
});
test('pure HTML initial command retains exactly five fixed operands and does not install or execute a target',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No source requests'));
 const f=fixture(),c=f.command,i=f.intent,m=JSON.parse(f.report.intent_json);
 assert.equal(c.sql,WRITE);assert.match(WRITE,/tf_html_initial_candidate\.capture_for_work/);assert.deepEqual(c.sql.match(/\$\d+/g),['$1','$2','$3','$4','$5']);
 assert.deepEqual(c.values,[f.work.runId,f.work.requestFingerprint,f.work.workClaimId,b64(c.intentJson),b64(f.rawReport)]);
 assert.equal(i.kind,'invented_html_initial_candidate_capture');assert.equal(i.base_publication_id,null);assert.equal(i.preparation_full_receipt_sha256,f.report.preparation.receipt_sha256);
 assert.equal(i.report_sha256,f.expected.reportSha256);assert.equal(i.preparation_intent_sha256,sha(f.expected.preparationIntentJson));assert.deepEqual(i.part_sha256,[m.payload_sha256,m.selection_sha256,m.provenance_sha256,m.context_raw_sha256]);
 assert.equal(c.capture.values[5],f.report.payload_json);assert.equal(c.intentSha256,sha(c.intentJson));assert.equal(c.reportJson,f.rawReport);assert.ok(c.receiptEstimate<=131072);
 assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.values)&&Object.isFrozen(c.expected)&&Object.isFrozen(c.work));assert.match(c.evidenceState,/unexecuted_not_whole_issue_or_publication/);
 assert.deepEqual(read(c.intentJson),{sql:READ,values:[i.capture_id]});
});
test('plain report and known-base HTML stay outside the initial grammar instead of relabelling a baseline',()=>{
 const f=fixture(),plain=readFileSync(new URL('../fixtures/fictional-detached-preparation.json',import.meta.url),'utf8');
 refuse(()=>prepare(f.work,plain,{reportSha256:sha(plain),preparationIntentJson:JSON.parse(plain).intent_json}));
 const v=JSON.parse(readFileSync(new URL('../fixtures/fictional-html-preparation-history.json',import.meta.url),'utf8')).reports.find(row=>JSON.parse(JSON.parse(row.reportJson).selection_json).basePublicationId!==null);
 assert.ok(v);refuse(()=>prepare({...f.work,runId:JSON.parse(JSON.parse(v.reportJson).selection_json).runId},v.reportJson,v.expected));
});
test('independent full report hash original preparation intent and complete object grammar are mandatory',()=>{
 const f=fixture();for(const e of [null,undefined,{}, {...f.expected,reportSha256:'f'.repeat(64)}, {...f.expected,preparationIntentJson:'{}'}, {...f.expected,extra:'PRIVATE_CANARY'}])refuse(()=>prepare(f.work,f.rawReport,e));
 for(const r of [null,Buffer.from(f.rawReport),f.rawReport+' ','PRIVATE_CANARY','\ud800','x'.repeat(524289)])refuse(()=>prepare(f.work,r,f.expected));
});
test('work identity remains explicit and cannot admit a foreign run configuration principal or renewed lease',()=>{
 const f=fixture();for(const w of [null,undefined,{...f.work,runId:other},{...f.work,workClaimId:'90000000-0000-5000-8000-000000000998'},{...f.work,requestFingerprint:'A'.repeat(64)},{...f.work,sql:'PRIVATE_CANARY'},{...f.work,target:'postgres://PRIVATE_CANARY'},{...f.work,leaseExpiresAt:OBSERVED},Object.create(f.work)])refuse(()=>prepare(w,f.rawReport,f.expected));
});
test('Reflect own-key grammar refuses symbols nonenumerable extras and getter-created keys before or after observation',()=>{
 const f=fixture();for(const which of ['work','expected'])for(const kind of ['symbol','hidden','lateSymbol','lateHidden']){
  const input={...f[which]},key=Object.keys(input)[0],value=input[key];
  if(kind==='symbol')input[Symbol('private')]=true;
  if(kind==='hidden')Object.defineProperty(input,'private',{value:true});
  if(kind.startsWith('late'))Object.defineProperty(input,key,{enumerable:true,get(){Object.defineProperty(input,kind==='lateSymbol'?Symbol('private'):'private',{value:true});return value;}});
  refuse(()=>prepare(which==='work'?input:f.work,f.rawReport,which==='expected'?input:f.expected));
 }
});
test('own allowed selectors are observed once and cannot fall through removed hidden or inherited descriptors',()=>{
 const f=fixture();for(const which of ['work','expected']){
  const values=f[which],counts={},input={};for(const key of Object.keys(values))Object.defineProperty(input,key,{enumerable:true,get(){counts[key]=(counts[key]??0)+1;return values[key];}});
  prepare(which==='work'?input:f.work,f.rawReport,which==='expected'?input:f.expected);assert.deepEqual(Object.values(counts),Object.keys(values).map(()=>1));
 }
 const bad={...f.work};Object.defineProperty(bad,'runId',{enumerable:true,get(){delete bad.workClaimId;Object.setPrototypeOf(bad,{workClaimId:f.work.workClaimId});return f.work.runId;}});refuse(()=>prepare(bad,f.rawReport,f.expected));
});
test('full invented native receipt keeps exact HTML report historical provenance and entirely null base',()=>{
 const f=fixture(),r=parse(f.raw,f.command.intentJson,f.expected,OBSERVED);
 assert.equal(r.reportJson,f.rawReport);assert.equal(r.preparation.preparation.receipt_sha256,f.report.preparation.receipt_sha256);assert.equal(r.preparation.metadata.provenance_sha256,JSON.parse(f.report.intent_json).provenance_sha256);
 assert.deepEqual(r.capture.basePublicationId,null);assert.equal(r.capture.baseHeadChangedAt,null);assert.equal(r.capture.baseContentSha256,null);assert.equal(r.capture.sourceReceipts.length,1);
 assert.equal(r.preparation.observedAt,f.report.observed_at);assert.equal(r.observedAt,OBSERVED);assert.equal(r.receiptSha256,sha(f.raw));assert.match(r.evidenceState,/html_initial.*not_whole_issue_or_publication/);
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.capture)&&Object.isFrozen(r.capture.sourceReceipts[0])&&Object.isFrozen(r.preparation.history));
});
test('all retained capture preparation work and null-base native identities must match exactly',()=>{
 for(const field of ['capture_id','preparation_operation_id']){const f=fixture();f.value[field]=other;refuse(()=>receive(f));}
 for(const field of ['captureId','runId','decisionId','issueId','basePublicationId','baseHeadChangedAt','baseContentSha256','proposalSha256']){
  const f=fixture();f.value.capture[field]=field.endsWith('Sha256')?'f'.repeat(64):field==='baseHeadChangedAt'?CAPTURED:other;refuse(()=>receive(f));
 }
 for(const field of ['capture_id','run_id','decision_id','issue_id','preparation_operation_id','preparation_artifact_id','preparation_intent_sha256','preparation_full_receipt_sha256','report_sha256','part_sha256','preparation_observed_at']){
  const f=fixture(),i=JSON.parse(f.command.intentJson);i[field]=field==='part_sha256'?Array(4).fill('f'.repeat(64)):field.endsWith('sha256')?'f'.repeat(64):field.endsWith('_at')?CAPTURED:other;
  const changed=canonical(i);f.value.intent_base64=b64(changed);refuse(()=>parse(Buffer.from(JSON.stringify(f.value)),changed,f.expected,OBSERVED));
 }
});
test('native source receipt is exactly the prepared HTML source digest language and retrieval instant',()=>{
 for(const mutate of [s=>s.sourceVersionId=other,s=>s.contentSha256='f'.repeat(64),s=>s.languageCode='fr',s=>s.languageCode=null,s=>s.retrievedAt='2026-10-16T01:00:00.000001Z',s=>s.extra=true]){
  const f=fixture();mutate(f.value.capture.sourceReceipts[0]);refuse(()=>receive(f));
 }
 for(const count of [0,2]){const f=fixture();f.value.capture.sourceReceipts=Array(count).fill(f.value.capture.sourceReceipts[0]);refuse(()=>receive(f));}
});
test('raw independent report intent and canonical base64 cannot be substituted or normalized',()=>{
 for(const field of ['intent_base64','report_base64'])for(const change of [s=>s+'\n',s=>'!!!!',s=>b64('PRIVATE_CANARY'),s=>b64(Buffer.from(s,'base64').toString()+' '),s=>Buffer.concat([Buffer.from([239,187,191]),Buffer.from(s,'base64')]).toString('base64')]){
  const f=fixture();f.value[field]=change(f.value[field]);refuse(()=>receive(f));
 }
 const f=fixture();refuse(()=>parse(f.raw,f.command.intentJson,{...f.expected,reportSha256:'f'.repeat(64)},OBSERVED));
 for(const input of [null,undefined,'{}',f.command.intentJson+' ',Buffer.from(f.command.intentJson),f.command.intentJson.replace('invented_html_initial','invented_initial')])refuse(()=>read(input));
});
test('native key accounting refuses duplicates escaped aliases and complete or nested extra keys',()=>{
 const f=fixture();for(const change of [s=>s.replace('"schema_version":1','"schema_version":true,"schema_version":1'),s=>s.replace('"sourceVersionId":','"sourceVersionId":"PRIVATE_CANARY","sourceVersionId":'),s=>s.replace('"kind":','"k\\u0069nd":'),s=>s.replace('"sourceVersionId":','"sourceVersionI\\u0064":')]){
  const original=JSON.stringify(f.value),changed=change(original);assert.notEqual(changed,original);refuse(()=>parse(Buffer.from(changed),f.command.intentJson,f.expected,OBSERVED));
 }
 for(const node of ['root','capture']){const v=fixture();(node==='root'?v.value:v.value.capture).extra=true;refuse(()=>receive(v));}
});
test('microsecond order permits equal observations and refuses premature future malformed and impossible dates',()=>{
 const f=fixture(),at=f.report.observed_at;f.value.capture.capturedAt=at;f.value.stored_at=at;assert.equal(receive(f,at).storedAt,at);
 for(const [node,key,value]of [['capture','capturedAt','2026-10-18T02:00:12.000006Z'],['root','stored_at','2026-10-18T02:00:13.999999Z'],['root','stored_at','2026-10-18T02:00:16.000001Z'],['capture','capturedAt','0000-01-01T00:00:00.000000Z'],['root','stored_at','2026-02-30T02:00:15.000000Z']]){
  const v=fixture();(node==='root'?v.value:v.value.capture)[key]=value;refuse(()=>receive(v));
 }
 for(const at of [null,undefined,'0000-01-01T00:00:00.000000Z','2026-02-30T00:00:00.000000Z','2026-10-18T02:00:16Z','2026-10-18T02:00:16.0000001Z','2026-10-18T02:00:16.000000+00:00'])refuse(()=>parse(f.raw,f.command.intentJson,f.expected,at));
});
test('intrinsic raw-byte envelope refuses text wrappers invalid UTF8 BOM and unchanged 131072-byte overflow',()=>{
 const f=fixture();for(const raw of [f.raw.toString(),{toString(){throw Error('PRIVATE_CANARY');}},new DataView(f.raw.buffer,f.raw.byteOffset,f.raw.byteLength),Buffer.alloc(131073),Buffer.from([255]),Buffer.concat([Buffer.from([239,187,191]),f.raw])])refuse(()=>parse(raw,f.command.intentJson,f.expected,OBSERVED));
 const guarded=Buffer.from(f.raw);Object.defineProperty(guarded,'byteLength',{get(){throw Error('PRIVATE_CANARY');}});Object.defineProperty(guarded,'length',{get(){throw Error('PRIVATE_CANARY');}});assert.equal(parse(guarded,f.command.intentJson,f.expected,OBSERVED).capture.captureId,f.intent.capture_id);
});
test('raw report mutation never repairs itself from newly supplied storage bytes',()=>{
 const f=fixture(),r=JSON.parse(f.rawReport);r.extraction.proposal.proposed_assertion='PRIVATE_CANARY changed source';const changed=canonical(r);
 refuse(()=>prepare(f.work,changed,{...f.expected,reportSha256:sha(changed)}));
 f.value.report_base64=b64(changed);refuse(()=>receive(f));
});


test('whole valid native envelope admits exactly131072 intrinsic bytes and holds one more without changing report capacity',()=>{
 const f=fixture();assert.ok(f.raw.byteLength<131072);
 const atLimit=Buffer.concat([f.raw,Buffer.alloc(131072-f.raw.byteLength,32)]);
 const received=parse(atLimit,f.command.intentJson,f.expected,OBSERVED);
 assert.equal(received.receiptSha256,sha(atLimit));assert.equal(received.reportJson,f.rawReport);
 refuse(()=>parse(Buffer.concat([atLimit,Buffer.from(' ')]),f.command.intentJson,f.expected,OBSERVED));
 assert.equal(received.preparation.selection.basePublicationId,null);
});
