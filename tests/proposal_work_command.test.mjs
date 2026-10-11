import assert from 'node:assert/strict';import test from 'node:test';
import {prepareWorkProposalCapture,recoverWorkProposalCapture,verifyWorkProposalCaptureReceipt,WORK_PROPOSAL_CAPTURE_SQL} from '../src/server/proposal-work-command.ts';
import {proposalReport,proposalId} from './helpers/proposal_fixture.mjs';
const work=()=>({runId:proposalId(1),requestFingerprint:'a'.repeat(64),workClaimId:proposalId(51)});
const selection=()=>({captureId:proposalId(8),runId:proposalId(1),decisionId:proposalId(2),issueId:proposalId(7),basePublicationId:proposalId(6)});
test('worker statement carries detached exact work scope and immutable canonical capture bytes',()=>{
 const r=proposalReport(),w=work(),s=selection(),c=prepareWorkProposalCapture(w,s,JSON.parse(r.capture.proposalJson));
 assert.deepEqual(c.values,[w.runId,w.requestFingerprint,w.workClaimId,s.captureId,s.decisionId,s.issueId,s.basePublicationId,r.capture.proposalJson]);
 assert.equal(c.capture.proposalSha256,r.capture.proposalSha256);
 assert.deepEqual(WORK_PROPOSAL_CAPTURE_SQL.match(/\$\d/g),['$1','$2','$3','$4','$5','$6','$7','$8']);
 assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.work)&&Object.isFrozen(c.values));w.workClaimId=proposalId(99);s.runId=proposalId(99);
 assert.equal(c.work.workClaimId,proposalId(51));assert.equal(c.capture.selection.runId,proposalId(1));
});
test('worker binding refuses foreign run, unknown inputs, malformed fingerprints and non-work UUIDs',()=>{
 for(const w of [{...work(),runId:proposalId(99)},{...work(),workClaimId:null},{...work(),extra:'PRIVATE_CANARY'},
  {...work(),requestFingerprint:'A'.repeat(64)},{...work(),runId:proposalId(1).replace('-4000-','-5000-')},
  {...work(),workClaimId:proposalId(51).replace('-4000-','-5000-')}]){
  assert.throws(()=>prepareWorkProposalCapture(w,selection(),JSON.parse(proposalReport().capture.proposalJson)));
 }
});
test('successor work preparation retains original capture identity/base/hash rather than regenerating',()=>{
 const r=proposalReport(),c=recoverWorkProposalCapture(work(),{runId:proposalId(1),decisionId:proposalId(2),issueId:proposalId(7)},r);
 assert.equal(c.values[3],r.capture.captureId);assert.equal(c.values[7],r.capture.proposalJson);assert.equal(c.capture.proposalSha256,r.capture.proposalSha256);
 r.capture.proposalJson='PRIVATE_CHANGED';assert.ok(!c.values[7].includes('PRIVATE_CHANGED'));
 assert.throws(()=>recoverWorkProposalCapture(work(),{runId:proposalId(1),decisionId:proposalId(2),issueId:proposalId(7)},r));
});
test('worker receipt reuses strict capture verification without claiming lease authorization',()=>{
 const r=proposalReport(),c=prepareWorkProposalCapture(work(),selection(),JSON.parse(r.capture.proposalJson));
 const receipt={schemaVersion:1,status:'stored',...c.capture.selection,proposalSha256:c.capture.proposalSha256,capturedAt:r.capture.capturedAt,observedAt:r.observedAt};
 assert.equal(verifyWorkProposalCaptureReceipt(new TextEncoder().encode(JSON.stringify(receipt)),c).status,'stored');
 for(const patch of [{workAuthorized:true},{captureId:proposalId(99)},{proposalSha256:'0'.repeat(64)}])
  assert.throws(()=>verifyWorkProposalCaptureReceipt(new TextEncoder().encode(JSON.stringify({...receipt,...patch})),c));
});
