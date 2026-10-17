import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';
import {parseCapturedProposalEnvelope} from '../src/server/proposal-capture.ts';
import {prepareAppendedIssueCapture as prepare} from '../src/server/appended-issue-capture.ts';import {compareStoredAppendedIssueCapture as compare} from '../src/server/appended-capture-comparison.ts';
const AT='2026-10-15T00:01:16.000000Z';const b64=s=>Buffer.from(s).toString('base64');
function fixture(){
 const v=JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-issue-review.json',import.meta.url),'utf8')).cases[0],command=prepare(v.bundle,v.expected),i=JSON.parse(command.intentJson),proposal=JSON.parse(v.bundle.proposalJson),candidate=JSON.parse(v.bundle.candidateReportJson),context=JSON.parse(candidate.parts.context_json),current=candidate.extraction_report.current;
 const sourceReceipts=proposal.dependencyManifest.sourceVersionIds.map(id=>({sourceVersionId:id,contentSha256:id===current.source_version_id?current.content_sha256:'f'.repeat(64),retrievedAt:proposal.snapshot.claims.flatMap(c=>c.evidence).find(e=>e.sourceVersionId===id).retrievedAt,languageCode:'en'}));
 const capture={captureId:i.capture_id,runId:i.run_id,decisionId:i.decision_id,issueId:i.issue_id,basePublicationId:i.base_publication_id,baseHeadChangedAt:context.issue.head.changed_at,baseContentSha256:i.part_sha256[1],proposalSha256:JSON.parse(v.bundle.compositionJson).proposal_sha256,capturedAt:'2026-10-15T00:01:13.000000Z',sourceReceipts};
 const value={schema_version:1,kind:'invented_appended_issue_capture_stored',capture_id:i.capture_id,preparation_operation_id:i.preparation_operation_id,stored_at:'2026-10-15T00:01:14.000000Z',intent_base64:b64(command.intentJson),parts_base64:command.values.slice(1),capture};
 const report={schemaVersion:1,status:'ok',requested:{runId:i.run_id,decisionId:i.decision_id},observedAt:'2026-10-15T00:01:15.000000Z',decision:{decisionId:i.decision_id,decidedAt:context.held.decided_at,sourceVersionId:context.held.source_version_id,sourceSha256:context.held.content_sha256,evidenceLocator:context.held.locator,reasonCodes:['semantics_unqualified'],undisclosedReasonCount:0},target:{issueId:i.issue_id,jurisdictionId:context.issue.jurisdiction_id,jurisdictionSlug:context.issue.jurisdiction_slug,issueSlug:context.issue.issue_slug},capture:{captureId:capture.captureId,capturedAt:capture.capturedAt,proposalJson:v.bundle.proposalJson,proposalSha256:capture.proposalSha256,basePublicationId:capture.basePublicationId,baseHeadChangedAt:capture.baseHeadChangedAt,baseContentSha256:capture.baseContentSha256},sourceReceipts,base:{publicationJson:v.bundle.baselineJson,publicationSha256:i.part_sha256[1]}};
 return {command,value,report,raw:Buffer.from(JSON.stringify(value))};
}
const refuse=fn=>assert.throws(fn,/^Error: appended_capture_comparison_unavailable$/);
test('separate historical custody and complete current comparison join exact payload baseline identities sources and time',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));const f=fixture(),r=compare(f.raw,f.command.intentJson,AT,f.report);assert.equal(r.report.capture.proposalJson,r.stored.bundle.proposalJson);assert.equal(r.report.base.publicationJson,r.stored.bundle.baselineJson);assert.match(r.evidenceState,/not_source_or_publication_qualified/);
});
test('missing changed or malformed current read cannot be replaced by historical custody',()=>{
 const f=fixture();for(const status of ['not_found','capture_missing','changed'])refuse(()=>compare(f.raw,f.command.intentJson,AT,{schemaVersion:1,status,requested:f.report.requested}));
 refuse(()=>compare(f.raw,f.command.intentJson,AT,null));refuse(()=>compare(f.raw,'{}',AT,f.report));
});
test('current report must agree with all historical selection and preserved raw baseline rather than merely parse',()=>{
 for(const mutate of [r=>r.requested.runId='00000000-0000-4000-8000-000000000999',r=>r.capture.captureId='00000000-0000-4000-8000-000000000999',r=>r.capture.capturedAt='2026-10-15T00:01:13.000001Z',
  r=>r.base.publicationJson+=' ',r=>r.sourceReceipts[0].contentSha256='a'.repeat(64),r=>r.target.jurisdictionId='another-invented-region']){
  const f=fixture();mutate(f.report);refuse(()=>compare(f.raw,f.command.intentJson,AT,f.report));
 }
});
test('matching historical association is no substitute for appended candidate exact decision passage and time',()=>{
 for(const mutate of [r=>r.decision.decidedAt='2026-10-15T00:00:50.000001Z',r=>r.decision.evidenceLocator='another invented locator',r=>r.decision.sourceSha256='a'.repeat(64)]){
  const f=fixture();mutate(f.report);refuse(()=>compare(f.raw,f.command.intentJson,AT,f.report));
 }
});
test('current comparison observation must follow actual association storage and precede caller observation at microsecond precision',()=>{
 const f=fixture();for(const observedAt of ['2026-10-15T00:01:13.999999Z','2026-10-15T00:01:16.000001Z'])refuse(()=>compare(f.raw,f.command.intentJson,AT,{...f.report,observedAt}));
 assert.ok(compare(f.raw,f.command.intentJson,AT,{...f.report,observedAt:f.value.stored_at}));assert.ok(compare(f.raw,f.command.intentJson,AT,{...f.report,observedAt:AT}));
});

test('a selfconsistent actual held source matching a preserved baseline citation cannot stand in for the appended candidate',()=>{
 const f=fixture(),baseline=JSON.parse(Buffer.from(f.value.parts_base64[1],'base64').toString());
 const reference=baseline.snapshot.claims[0].evidence[0],receipt=f.report.sourceReceipts.find(s=>s.sourceVersionId===reference.sourceVersionId);
 f.report.decision.sourceVersionId=reference.sourceVersionId;f.report.decision.sourceSha256=receipt.contentSha256;f.report.decision.evidenceLocator=reference.locator;
 assert.equal(parseCapturedProposalEnvelope(f.report).status,'ok');
 refuse(()=>compare(f.raw,f.command.intentJson,AT,f.report));
});
