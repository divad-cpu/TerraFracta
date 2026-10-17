import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareInitialCandidateCaptureForWork as prepare,prepareInitialCandidateCaptureRead as read,parseStoredInitialCandidateCapture as parse,INITIAL_CANDIDATE_CAPTURE_SQL,INITIAL_CANDIDATE_CAPTURE_READ_SQL} from '../src/server/initial-candidate-capture.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
const rawReport=()=>readFileSync(new URL('../fixtures/fictional-detached-preparation.json',import.meta.url),'utf8');
const expected=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-detached-preparation-expected.json',import.meta.url),'utf8'));
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const b64=s=>Buffer.from(s,'utf8').toString('base64');
const other='00000000-0000-4000-8000-000000000999';
const AT='2026-10-15T00:01:15.000000Z';
const work=()=>({runId:JSON.parse(JSON.parse(rawReport()).parts.selection_json).runId,requestFingerprint:'a'.repeat(64),workClaimId:'00000000-0000-4000-8000-000000000998'});
const refuse=fn=>assert.throws(fn,/^Error: initial_candidate_capture_unavailable$/);
function receipt(){
 const report=rawReport(),e=expected(),command=prepare(work(),report,e),i=JSON.parse(command.intentJson),r=JSON.parse(report),current=r.extraction_report.current;
 const value={schema_version:1,kind:'invented_initial_candidate_capture_stored',capture_id:i.capture_id,preparation_operation_id:i.preparation_operation_id,stored_at:'2026-10-15T00:01:14.000000Z',intent_base64:b64(command.intentJson),report_base64:b64(report),
  capture:{captureId:i.capture_id,runId:i.run_id,decisionId:i.decision_id,issueId:i.issue_id,basePublicationId:null,baseHeadChangedAt:null,baseContentSha256:null,proposalSha256:JSON.parse(r.intent_json).payload_sha256,capturedAt:'2026-10-15T00:01:13.000000Z',
   sourceReceipts:[{sourceVersionId:current.source_version_id,contentSha256:current.content_sha256,retrievedAt:current.retrieved_at,languageCode:current.language_code}]}};
 return {command,value,report,expected:e,raw:Buffer.from(JSON.stringify(value))};
}
const receive=(value,command,e=expected(),at=AT)=>parse(Buffer.from(JSON.stringify(value)),command.intentJson,e,at);

test('empty-current-head candidate prepares exactly five fixed operands and independently retained provenance without a transport',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));
 const e=expected(),r=rawReport(),w=work(),c=prepare(w,r,e),i=JSON.parse(c.intentJson),m=JSON.parse(e.preparationIntentJson),source=JSON.parse(r);
 assert.equal(c.sql,INITIAL_CANDIDATE_CAPTURE_SQL);assert.deepEqual(c.sql.match(/\$\d+/g),['$1','$2','$3','$4','$5']);
 assert.deepEqual(c.values,[w.runId,w.requestFingerprint,w.workClaimId,b64(c.intentJson),b64(r)]);
 assert.equal(i.base_publication_id,null);assert.equal(i.snapshot_intent,'single_claim_technical_review_not_issue_replacement');assert.equal(i.report_sha256,e.reportSha256);assert.equal(i.preparation_intent_sha256,sha(e.preparationIntentJson));
 assert.equal(i.preparation_full_receipt_sha256,source.preparation.full_receipt_sha256);assert.deepEqual(i.part_sha256,[m.payload_sha256,m.selection_sha256,m.provenance_sha256,m.context_raw_sha256]);
 assert.equal(i.preparation_observed_at,source.observed_at);assert.equal(c.capture.values[5],source.parts.payload_json);assert.equal(c.reportJson,r);assert.equal(c.intentSha256,sha(c.intentJson));
 assert.match(c.evidenceState,/unexecuted_not_whole_issue_or_publication/);assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.work)&&Object.isFrozen(c.values)&&Object.isFrozen(c.expected));
 assert.deepEqual(read(c.intentJson),{sql:INITIAL_CANDIDATE_CAPTURE_READ_SQL,values:[i.capture_id]});
});
test('independent report and original preparation intent are mandatory rather than derived from the returned body',()=>{
 const e=expected(),r=rawReport();for(const value of [undefined,null,{}, {...e,reportSha256:'f'.repeat(64)},{...e,preparationIntentJson:'{}'},{...e,extra:'PRIVATE_CANARY'}])refuse(()=>prepare(work(),r,value));
 refuse(()=>prepare(work(),r+' ',e));refuse(()=>prepare(work(),Buffer.from(r),e));refuse(()=>prepare(work(),'x'.repeat(65537),e));refuse(()=>prepare(work(),'\ud800',e));
});
test('known-base whole-issue preparation cannot enter the initial-candidate path',()=>{
 const v=JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-issue-review.json',import.meta.url),'utf8')).cases[0],r=v.bundle.candidateReportJson,e={reportSha256:sha(r),preparationIntentJson:JSON.parse(r).intent_json},s=JSON.parse(JSON.parse(r).parts.selection_json);
 assert.notEqual(s.basePublicationId,null);refuse(()=>prepare({...work(),runId:s.runId},r,e));
});
test('explicit current-work tuple rejects foreign run identities and configuration fields before any execution',()=>{
 const r=rawReport(),e=expected();for(const w of [undefined,{...work(),runId:other},{...work(),workClaimId:'00000000-0000-5000-8000-000000000998'},{...work(),requestFingerprint:'A'.repeat(64)},{...work(),target:'postgres://PRIVATE_CANARY'},{...work(),signal:new AbortController().signal}])refuse(()=>prepare(w,r,e));
 const inherited=Object.create(work());refuse(()=>prepare(inherited,r,e));
});
test('own selectors are captured once and cannot fall through to an inherited or subsequently hidden value',()=>{
 const original=work(),counts={runId:0,requestFingerprint:0,workClaimId:0},w={};for(const k of Object.keys(original))Object.defineProperty(w,k,{enumerable:true,get(){counts[k]++;return original[k];}});
 assert.deepEqual(prepare(w,rawReport(),expected()).work,original);assert.deepEqual(Object.values(counts),[1,1,1]);
 const e=expected(),ec={reportSha256:0,preparationIntentJson:0},input={};for(const k of Object.keys(e))Object.defineProperty(input,k,{enumerable:true,get(){ec[k]++;return e[k];}});prepare(work(),rawReport(),input);assert.deepEqual(Object.values(ec),[1,1]);
 const bad={...work()};Object.defineProperty(bad,'runId',{enumerable:true,get(){Object.defineProperty(bad,'workClaimId',{enumerable:false,value:original.workClaimId});return original.runId;}});refuse(()=>prepare(bad,rawReport(),e));
});
test('full native receipt preserves exact original report and four raw parts with historical observation and null head',()=>{
 const {command,raw,report,expected:e}=receipt(),r=parse(raw,command.intentJson,e,AT),original=JSON.parse(report);
 assert.equal(r.reportJson,report);assert.deepEqual(r.preparation.parts,original.parts);assert.notEqual(r.preparation.parts.context_json,canonical(JSON.parse(r.preparation.parts.context_json)));
 assert.equal(r.capture.basePublicationId,null);assert.equal(r.capture.baseHeadChangedAt,null);assert.equal(r.capture.baseContentSha256,null);assert.equal(r.capture.sourceReceipts.length,1);
 assert.equal(r.observedAt,AT);assert.equal(r.preparation.observedAt,original.observed_at);assert.equal(r.receiptSha256,sha(raw));assert.match(r.evidenceState,/not_whole_issue_or_publication/);
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.capture)&&Object.isFrozen(r.capture.sourceReceipts[0])&&Object.isFrozen(r.preparation.parts));
});
test('all capture and preparation selectors and the entirely-null base are checked against independent original intent',()=>{
 for(const mutate of [v=>v.capture_id=other,v=>v.preparation_operation_id=other,v=>v.capture.captureId=other,v=>v.capture.runId=other,v=>v.capture.decisionId=other,v=>v.capture.issueId=other,
  v=>v.capture.basePublicationId=other,v=>v.capture.baseHeadChangedAt=AT,v=>v.capture.baseContentSha256='f'.repeat(64),v=>v.capture.proposalSha256='f'.repeat(64)]){
  const {command,value}=receipt();mutate(value);refuse(()=>receive(value,command));
 }
 for(const field of ['capture_id','run_id','decision_id','issue_id','preparation_operation_id','preparation_artifact_id','preparation_intent_sha256','preparation_full_receipt_sha256','report_sha256','preparation_observed_at','part_sha256']){
  const {command,value}=receipt(),i=JSON.parse(command.intentJson);i[field]=field==='part_sha256'?Array(4).fill('f'.repeat(64)):field.endsWith('sha256')?'f'.repeat(64):field.endsWith('_at')?'2026-10-15T00:01:10.000000Z':other;
  const changed=canonical(i);value.intent_base64=b64(changed);refuse(()=>parse(Buffer.from(JSON.stringify(value)),changed,expected(),AT));
 }
});
test('source receipt count identity native digest language and actual retrieval remain an exact single-source binding',()=>{
 for(const mutate of [v=>v.capture.sourceReceipts=[],v=>v.capture.sourceReceipts.push(v.capture.sourceReceipts[0]),v=>v.capture.sourceReceipts[0].sourceVersionId=other,v=>v.capture.sourceReceipts[0].contentSha256='f'.repeat(64),
  v=>v.capture.sourceReceipts[0].languageCode=null,v=>v.capture.sourceReceipts[0].languageCode='fr',v=>v.capture.sourceReceipts[0].retrievedAt='2026-10-15T00:00:00.000001Z']){
  const {command,value}=receipt();mutate(value);refuse(()=>receive(value,command));
 }
});
test('exact microsecond chronology preserves report observation and refuses future or out-of-order native receipt',()=>{
 for(const mutate of [v=>v.capture.capturedAt='2026-10-15T00:01:10.999999Z',v=>v.stored_at='2026-10-15T00:01:12.999999Z',v=>v.stored_at='2026-10-15T00:01:15.000001Z',v=>v.capture.capturedAt='0000-01-01T00:00:00.000000Z']){
  const {command,value}=receipt();mutate(value);refuse(()=>receive(value,command));
 }
 const {command,value}=receipt();value.capture.capturedAt='2026-10-15T00:01:11.000000Z';value.stored_at=value.capture.capturedAt;assert.equal(receive(value,command,expected(),value.stored_at).storedAt,value.stored_at);
 for(const at of [undefined,'2026-10-15T00:01:15Z','2026-10-15T00:01:15.0000001Z','2026-10-15T00:01:14.000000+00:00'])refuse(()=>parse(Buffer.from(JSON.stringify(value)),command.intentJson,expected(),at));
});
test('raw report intent and base64 substitutions refuse the complete receipt without exposing private payload',()=>{
 for(const mutate of [v=>v.intent_base64=b64('{}'),v=>v.report_base64=b64('PRIVATE_CANARY'),v=>v.report_base64+='\n',v=>v.intent_base64='!!!!',v=>v.report_base64=b64(rawReport()+' '),v=>v.extra='PRIVATE_CANARY',v=>v.capture.extra=true,v=>v.capture.sourceReceipts[0].extra=true]){
  const {command,value}=receipt();mutate(value);refuse(()=>receive(value,command));
 }
 const {command,raw}=receipt();refuse(()=>parse(raw,command.intentJson,{...expected(),reportSha256:'f'.repeat(64)},AT));refuse(()=>read('{}'));refuse(()=>read(command.intentJson+' '));refuse(()=>read(Buffer.from(command.intentJson)));
});
test('fixed native key grammar rejects duplicates and escaped aliases even when aliases replace rather than duplicate a key',()=>{
 for(const change of [s=>s.replace('"schema_version":1','"schema_version":true,"schema_version":1'),s=>s.replace('"capturedAt":','"capturedAt":"PRIVATE_CANARY","capturedAt":'),s=>s.replace('"sourceVersionId":','"sourceVersionId":"PRIVATE_CANARY","sourceVersionId":'),s=>s.replace('"kind":','"k\\u0069nd":'),s=>s.replace('"sourceVersionId":','"sourceVersionI\\u0064":')]){
  const {command,value}=receipt(),raw=JSON.stringify(value),changed=change(raw);assert.notEqual(raw,changed);refuse(()=>parse(Buffer.from(changed),command.intentJson,expected(),AT));
 }
});
test('intrinsic native bytes ignore shadowed length and reject wrappers invalid UTF8 BOM and capacity overflow',()=>{
 const {command,raw}=receipt();for(const value of [raw.toString(),{toString(){throw Error('PRIVATE_CANARY');}},new DataView(raw.buffer,raw.byteOffset,raw.byteLength),Buffer.alloc(131073),Buffer.from([0xff]),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),raw])])refuse(()=>parse(value,command.intentJson,expected(),AT));
 const guarded=Buffer.from(raw);Object.defineProperty(guarded,'byteLength',{get(){throw Error('PRIVATE_CANARY');}});Object.defineProperty(guarded,'length',{get(){throw Error('PRIVATE_CANARY');}});assert.equal(parse(guarded,command.intentJson,expected(),AT).capture.captureId,JSON.parse(command.intentJson).capture_id);
 for(const field of ['intent_base64','report_base64']){const {command,value}=receipt();value[field]=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(value[field],'base64')]).toString('base64');refuse(()=>receive(value,command));}
});
