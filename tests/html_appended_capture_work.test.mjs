import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';
import {prepareHtmlAppendedIssueCapture} from '../src/server/html-appended-issue-capture.ts';
import {prepareHtmlAppendedIssueCaptureForWork as prepare,recoverHtmlAppendedIssueCaptureForWork as recover,HTML_APPENDED_WORK_CAPTURE_SQL} from '../src/server/html-appended-capture-work.ts';
import {htmlAppendedIssueReviewVectors} from './helpers/html_appended_issue_review_vectors.mjs';
const cases=htmlAppendedIssueReviewVectors().cases;const vectors=()=>structuredClone(cases);
const scope=v=>({runId:JSON.parse(JSON.parse(v.bundle.candidateReportJson).selection_json).runId,requestFingerprint:'c'.repeat(64),workClaimId:'00000000-0000-4000-8000-000000000999'});
const refuse=fn=>assert.throws(fn,/^Error: html_appended_capture_work_unavailable$/);
test('late work binding reuses all seven admitted association values and the established work identity shape without execution',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));
 for(const index of [0,1,2,3]){const v=vectors()[index],w=scope(v),manual=prepareHtmlAppendedIssueCapture(v.bundle,v.expected),prepared=prepare(w,v.bundle,v.expected);
  assert.equal(prepared.sql,HTML_APPENDED_WORK_CAPTURE_SQL);assert.deepEqual(prepared.values,[w.runId,w.requestFingerprint,w.workClaimId,...manual.values]);assert.deepEqual(prepared.sql.match(/\$\d+/g),Array.from({length:10},(_,i)=>'$'+(i+1)));
  assert.equal(prepared.capture.intentJson,manual.intentJson);assert.equal(prepared.capture.bundle.proposalJson,v.bundle.proposalJson);assert.ok(Object.isFrozen(prepared)&&Object.isFrozen(prepared.work)&&Object.isFrozen(prepared.values));assert.match(prepared.evidenceState,/requires_current_outer_work_fence/);
 }
});
test('a different run malformed fingerprint version5 claim or extra work input cannot acquire an unexecuted association command',()=>{
 const v=vectors()[0],w=scope(v);for(const input of [null,{}, {...w,runId:'00000000-0000-4000-8000-000000000998'}, {...w,requestFingerprint:'C'.repeat(64)}, {...w,workClaimId:'00000000-0000-5000-8000-000000000999'}, {...w,extra:true}])refuse(()=>prepare(input,v.bundle,v.expected));
});
test('incomplete wholeissue evidence cannot be hidden by a syntactically valid work scope',()=>{
 const v=vectors()[0];refuse(()=>prepare(scope(v),v.bundle,{...v.expected,preparationIntentJson:'{}'}));
 const changed=vectors()[1];changed.bundle.proposalJson+=' ';refuse(()=>prepare(scope(changed),changed.bundle,changed.expected));
});
test('recovery cannot replace full retained capture custody with a raw fragment a different intent or an invalid observation',()=>{
 const v=vectors()[0],w=scope(v),manual=prepareHtmlAppendedIssueCapture(v.bundle,v.expected);for(const [raw,intent,observed] of [[Buffer.from('{}'),manual.intentJson,'2026-10-15T00:02:00.000000Z'],[Buffer.alloc(131073),manual.intentJson,'2026-10-15T00:02:00.000000Z'],[Buffer.from('{}'),'{}','2026-10-15T00:02:00.000000Z'],[Buffer.from('{}'),manual.intentJson,'not-a-time']])refuse(()=>recover(w,raw,intent,observed));
});

test('retained illustrative complete HTML receipt reconstructs all seven original values under a new work identity without warm operands',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));
 const f=JSON.parse(readFileSync(new URL('../fixtures/fictional-html-appended-capture.json',import.meta.url),'utf8')),i=JSON.parse(f.retainedIntentJson);
 const w={runId:i.run_id,requestFingerprint:'d'.repeat(64),workClaimId:'00000000-0000-4000-8000-000000000997'},raw=Buffer.from(f.rawBase64,'base64');
 const result=recover(w,raw,f.retainedIntentJson,f.observedAt);
 assert.equal(result.capture.intentJson,f.retainedIntentJson);assert.deepEqual(result.values.slice(0,3),[w.runId,w.requestFingerprint,w.workClaimId]);
 assert.deepEqual(result.values.slice(3),[f.retainedIntentJson,...['candidateReportJson','baselineJson','canonicalBaselineJson','contextJson','proposalJson','compositionJson'].map(k=>result.capture.bundle[k])].map(v=>Buffer.from(v,'utf8').toString('base64')));
 assert.equal(JSON.parse(result.capture.bundle.proposalJson).snapshot.claims.length,3);
 raw.fill(0);assert.equal(result.capture.intentJson,f.retainedIntentJson);
 for(const input of [{...w,runId:'00000000-0000-4000-8000-000000000996'},{...w,requestFingerprint:'bad'},{...w,extra:true}])refuse(()=>recover(input,Buffer.from(f.rawBase64,'base64'),f.retainedIntentJson,f.observedAt));
 refuse(()=>recover(w,Buffer.from(f.rawBase64,'base64'),f.retainedIntentJson,f.observedAt.replace('2026','2025')));
 const altered=structuredClone(i);altered.capture_id='00000000-0000-4000-8000-000000000995';refuse(()=>recover(w,Buffer.from(f.rawBase64,'base64'),JSON.stringify(altered),f.observedAt));
});
