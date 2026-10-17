import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';
import {prepareHtmlAppendedIssueCapture as prepare,prepareHtmlAppendedIssueCaptureRead as read,parseStoredHtmlAppendedIssueCapture as parse,HTML_APPENDED_CAPTURE_SQL,HTML_APPENDED_CAPTURE_READ_SQL} from '../src/server/html-appended-issue-capture.ts';
import {htmlAppendedIssueReviewVectors} from './helpers/html_appended_issue_review_vectors.mjs';
const cases=htmlAppendedIssueReviewVectors().cases;const vectors=()=>structuredClone(cases);
const AT='2026-10-18T02:00:20.000000Z',b64=s=>Buffer.from(s).toString('base64'),refuse=fn=>assert.throws(fn,/^Error: html_appended_issue_capture_unavailable$/);
export function receipt(vector=vectors()[0]){
 const command=prepare(vector.bundle,vector.expected),i=JSON.parse(command.intentJson),p=JSON.parse(vector.bundle.proposalJson),ctx=JSON.parse(vector.bundle.contextJson),current=JSON.parse(vector.bundle.candidateReportJson).extraction.inspection.current;
 const sources=p.dependencyManifest.sourceVersionIds.map(id=>({sourceVersionId:id,contentSha256:id===current.source_version_id?current.content_sha256:'f'.repeat(64),retrievedAt:p.snapshot.claims.flatMap(c=>c.evidence).find(e=>e.sourceVersionId===id).retrievedAt,languageCode:'en'}));
 const value={schema_version:1,kind:'invented_html_appended_issue_capture_stored',capture_id:i.capture_id,preparation_operation_id:i.preparation_operation_id,stored_at:'2026-10-18T02:00:19.000000Z',intent_base64:b64(command.intentJson),parts_base64:command.values.slice(1),
  capture:{captureId:i.capture_id,runId:i.run_id,decisionId:i.decision_id,issueId:i.issue_id,basePublicationId:i.base_publication_id,baseHeadChangedAt:ctx.baseline.head_changed_at,baseContentSha256:i.part_sha256[1],proposalSha256:JSON.parse(vector.bundle.compositionJson).proposal_sha256,capturedAt:'2026-10-18T02:00:18.000000Z',sourceReceipts:sources}};
 return {command,value,raw:Buffer.from(JSON.stringify(value,null,1))};
}
test('required strict wholeissue admission prepares fixed sevenbytea statement and independent retained intent without execution',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));
 for(const index of [0,1,2,3]){const v=vectors()[index],c=prepare(v.bundle,v.expected),i=JSON.parse(c.intentJson);assert.equal(c.sql,HTML_APPENDED_CAPTURE_SQL);assert.equal(c.values.length,7);assert.deepEqual(c.sql.match(/\$\d+/g),['$1','$2','$3','$4','$5','$6','$7']);
  assert.equal(c.values[0],b64(c.intentJson));assert.equal(c.bundle.proposalJson,v.bundle.proposalJson);assert.equal(i.kind,'invented_html_appended_issue_capture');assert.ok(c.receiptEstimate<=131072);assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.values));
  assert.deepEqual(read(c.intentJson),{sql:HTML_APPENDED_CAPTURE_READ_SQL,values:[i.capture_id]});
 }
 const v=vectors()[0];refuse(()=>prepare(v.bundle,{...v.expected,preparationIntentJson:'{}'}));refuse(()=>read('{}'));
});
test('complete historical receipt preserves all six exact parts with independent whole intent and exact native metadata',()=>{
 for(const index of [0,1,2,3]){const v=vectors()[index],{command,raw}=receipt(v),r=parse(raw,command.intentJson,AT);assert.deepEqual(r.bundle,v.bundle);assert.equal(r.capture.sourceReceipts.length,JSON.parse(v.bundle.proposalJson).dependencyManifest.sourceVersionIds.length);
  assert.equal(r.storedAt,'2026-10-18T02:00:19.000000Z');assert.equal(r.observedAt,AT);assert.match(r.evidenceState,/not_current_qualification_or_publication/);
 }
});
test('any raw part or retained intent substitution and noncanonical base64 holds the complete receipt',()=>{
 for(let index=0;index<6;index++){const {command,value}=receipt();value.parts_base64[index]=b64('PRIVATE_CANARY');refuse(()=>parse(Buffer.from(JSON.stringify(value)),command.intentJson,AT));}
 for(const mutate of [v=>v.intent_base64=b64('{}'),v=>v.parts_base64[0]+='\n',v=>v.parts_base64[1]='!!!!',v=>v.extra=true,v=>v.capture.extra=true,v=>v.capture.sourceReceipts[0].extra=true]){
  const {command,value}=receipt();mutate(value);refuse(()=>parse(Buffer.from(JSON.stringify(value)),command.intentJson,AT));
 }
 const {command,raw}=receipt();refuse(()=>parse(raw,command.intentJson+' ',AT));refuse(()=>parse(raw,'{}',AT));
});
test('capture identity fullbaseline head native sourcehash sourcecount retrieval and chronology each remain bound',()=>{
 for(const mutate of [v=>v.capture.runId='00000000-0000-4000-8000-000000000999',v=>v.capture.baseContentSha256='f'.repeat(64),v=>v.capture.baseHeadChangedAt=AT,
  v=>v.capture.proposalSha256='f'.repeat(64),v=>v.capture.sourceReceipts.pop(),v=>v.capture.sourceReceipts.push(v.capture.sourceReceipts[0]),v=>v.capture.sourceReceipts.at(-1).contentSha256='f'.repeat(64),
  v=>v.capture.sourceReceipts[0].retrievedAt='2026-10-15T00:00:00.000001Z',v=>v.stored_at='2026-10-18T02:00:17.999999Z',v=>v.capture.capturedAt='2026-10-17T23:59:59.999999Z',v=>v.stored_at='2026-10-18T02:00:20.000001Z']){
  const {command,value}=receipt();mutate(value);refuse(()=>parse(Buffer.from(JSON.stringify(value)),command.intentJson,AT));
 }
});
test('duplicate and escaped alias keys are refused in fixed nested receipt without free-text lexical ambiguity',()=>{
 for(const mutate of [s=>s.replace('"schema_version":1','"schema_version":true,"schema_version":1'),s=>s.replace('"capturedAt":','"capturedAt":"PRIVATE_CANARY","capturedAt":'),
  s=>s.replace('"sourceVersionId":','"sourceVersionId":"PRIVATE_CANARY","sourceVersionId":'),s=>s.replace('"kind":','"k\\u0069nd":"PRIVATE_CANARY","kind":')]){
  const {command,value}=receipt(),raw=mutate(JSON.stringify(value));assert.notEqual(raw,JSON.stringify(value));refuse(()=>parse(Buffer.from(raw),command.intentJson,AT));
 }
});
test('native intrinsic byte accounting refuses wrappers oversized and invalid UTF8 while ignoring shadowed length',()=>{
 const {command,raw}=receipt();for(const value of [raw.toString(),{toString(){throw Error('PRIVATE_CANARY');}},Buffer.alloc(131073),Buffer.from([0xff])])refuse(()=>parse(value,command.intentJson,AT));
 const guarded=Buffer.from(raw);Object.defineProperty(guarded,'byteLength',{get(){throw Error('PRIVATE_CANARY');}});assert.equal(parse(guarded,command.intentJson,AT).capture.captureId,JSON.parse(command.intentJson).capture_id);
});

test('coherently changed retained/native capture selection must still equal the sixpart admitted selection',()=>{
 for(const [field,native] of [['capture_id','captureId'],['run_id','runId'],['decision_id','decisionId'],['issue_id','issueId'],['base_publication_id','basePublicationId']]){
  const {command,value}=receipt(),i=JSON.parse(command.intentJson);i[field]='00000000-0000-4000-8000-000000000999';
  const intent=JSON.stringify(Object.fromEntries(Object.entries(i).sort(([a],[b])=>a.localeCompare(b))));value.intent_base64=b64(intent);value.capture[native]=i[field];if(field==='capture_id')value.capture_id=i[field];
  refuse(()=>parse(Buffer.from(JSON.stringify(value)),intent,AT));
 }
});

test('a UTF8 BOM in any of seven encoded carriers cannot disappear before exact raw-part hashing',()=>{
 for(let index=-1;index<6;index++){
  const {command,value}=receipt(),key=index<0?value.intent_base64:value.parts_base64[index];
  const changed=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(key,'base64')]).toString('base64');
  if(index<0)value.intent_base64=changed;else value.parts_base64[index]=changed;
  refuse(()=>parse(Buffer.from(JSON.stringify(value)),command.intentJson,AT));
 }
 const {command,raw}=receipt();refuse(()=>parse(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),raw]),command.intentJson,AT));
});
test('native candidate source language must agree with the independently bound HTML original',()=>{
 const {command,value}=receipt(),current=JSON.parse(vectors()[0].bundle.candidateReportJson).extraction.inspection.current;
 value.capture.sourceReceipts.find(s=>s.sourceVersionId===current.source_version_id).languageCode='no';
 refuse(()=>parse(Buffer.from(JSON.stringify(value)),command.intentJson,AT));
});
