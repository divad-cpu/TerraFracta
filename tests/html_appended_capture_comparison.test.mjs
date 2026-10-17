import assert from 'node:assert/strict';import test from 'node:test';
import {parseCapturedProposalEnvelope} from '../src/server/proposal-capture.ts';
import {compareStoredHtmlAppendedIssueCapture as compare} from '../src/server/html-appended-capture-comparison.ts';
import {htmlAppendedCaptureFixture} from './helpers/html_appended_capture_fixture.mjs';
const AT='2026-10-18T02:00:21.000000Z';

const refuse=fn=>assert.throws(fn,/^Error: html_appended_capture_comparison_unavailable$/);
test('separate historical custody and complete current comparison join exact payload baseline identities sources and time',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));const f=htmlAppendedCaptureFixture(),r=compare(f.raw,f.command.intentJson,AT,f.report);assert.equal(r.report.capture.proposalJson,r.stored.bundle.proposalJson);assert.equal(r.report.base.publicationJson,r.stored.bundle.baselineJson);assert.match(r.evidenceState,/not_source_or_publication_qualified/);
});
test('missing changed or malformed current read cannot be replaced by historical custody',()=>{
 const f=htmlAppendedCaptureFixture();for(const status of ['not_found','capture_missing','changed'])refuse(()=>compare(f.raw,f.command.intentJson,AT,{schemaVersion:1,status,requested:f.report.requested}));
 refuse(()=>compare(f.raw,f.command.intentJson,AT,null));refuse(()=>compare(f.raw,'{}',AT,f.report));
});
test('current report must agree with all historical selection and preserved raw baseline rather than merely parse',()=>{
 for(const mutate of [r=>r.requested.runId='00000000-0000-4000-8000-000000000999',r=>r.capture.captureId='00000000-0000-4000-8000-000000000999',r=>r.capture.capturedAt='2026-10-18T02:00:18.000001Z',
  r=>r.base.publicationJson+=' ',r=>r.sourceReceipts[0].contentSha256='a'.repeat(64),r=>r.target.jurisdictionId='another-invented-region']){
  const f=htmlAppendedCaptureFixture();mutate(f.report);refuse(()=>compare(f.raw,f.command.intentJson,AT,f.report));
 }
});
test('matching historical association is no substitute for appended candidate exact decision passage and time',()=>{
 for(const mutate of [r=>r.decision.decidedAt='2026-10-15T00:00:50.000001Z',r=>r.decision.evidenceLocator='another invented locator',r=>r.decision.sourceSha256='a'.repeat(64)]){
  const f=htmlAppendedCaptureFixture();mutate(f.report);refuse(()=>compare(f.raw,f.command.intentJson,AT,f.report));
 }
});
test('current comparison observation must follow actual association storage and precede caller observation at microsecond precision',()=>{
 const f=htmlAppendedCaptureFixture();for(const observedAt of ['2026-10-18T02:00:18.999999Z','2026-10-18T02:00:21.000001Z'])refuse(()=>compare(f.raw,f.command.intentJson,AT,{...f.report,observedAt}));
 assert.ok(compare(f.raw,f.command.intentJson,AT,{...f.report,observedAt:f.value.stored_at}));assert.ok(compare(f.raw,f.command.intentJson,AT,{...f.report,observedAt:AT}));
});

test('a selfconsistent actual held source matching a preserved baseline citation cannot stand in for the appended candidate',()=>{
 const f=htmlAppendedCaptureFixture(),baseline=JSON.parse(Buffer.from(f.value.parts_base64[1],'base64').toString());
 const reference=baseline.snapshot.claims[0].evidence[0],receipt=f.report.sourceReceipts.find(s=>s.sourceVersionId===reference.sourceVersionId);
 f.report.decision.sourceVersionId=reference.sourceVersionId;f.report.decision.sourceSha256=receipt.contentSha256;f.report.decision.evidenceLocator=reference.locator;
 assert.equal(parseCapturedProposalEnvelope(f.report).status,'ok');
 refuse(()=>compare(f.raw,f.command.intentJson,AT,f.report));
});
