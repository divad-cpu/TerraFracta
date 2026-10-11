import assert from 'node:assert/strict';import test from 'node:test';
import {recoverProposalCaptureCommand,verifyProposalCaptureReceipt} from '../src/server/proposal-capture-command.ts';
import {proposalReport,proposalId} from './helpers/proposal_fixture.mjs';
const scope=()=>({runId:proposalId(1),decisionId:proposalId(2),issueId:proposalId(7)});
test('recovery retains exact stored canonical wording/hash/identity/base and detaches inputs',()=>{
 const r=proposalReport(),s=scope(),c=recoverProposalCaptureCommand(s,r);
 assert.deepEqual(c.values,[proposalId(8),s.runId,s.decisionId,s.issueId,proposalId(6),r.capture.proposalJson]);
 assert.equal(c.proposalSha256,r.capture.proposalSha256);assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.values)&&Object.isFrozen(c.selection));
 r.capture.proposalJson='PRIVATE_CHANGED';s.runId=proposalId(99);assert.equal(c.values[1],proposalId(1));assert.ok(!c.values[5].includes('PRIVATE_CHANGED'));
});
test('no capture, changed, unavailable and foreign target refuse rather than regenerate',()=>{
 for(const status of ['capture_missing','changed','not_found'])assert.throws(()=>recoverProposalCaptureCommand(scope(),{schemaVersion:1,status,requested:{runId:proposalId(1),decisionId:proposalId(2)}}));
 for(const s of [{...scope(),runId:proposalId(99)},{...scope(),decisionId:proposalId(99)},{...scope(),issueId:proposalId(99)},{...scope(),sql:'PRIVATE_CANARY'}])assert.throws(()=>recoverProposalCaptureCommand(s,proposalReport()));
 for(const r of [null,{}, {kind:'unavailable'}])assert.throws(()=>recoverProposalCaptureCommand(scope(),r));
});
test('corrupt receipts, chronology, aliases and content cannot become a replay command',()=>{
 for(const change of [r=>r.capture.proposalJson+=' ',r=>r.capture.proposalSha256='0'.repeat(64),r=>r.sourceReceipts[0].contentSha256='0'.repeat(64),
  r=>r.observedAt='2026-09-28T06:59:59.999999Z',r=>r.capture.proposalJson=r.capture.proposalJson.replace('"kind":"review_only"','"kind":"review_only","kind":"review_only"')]){
  const r=proposalReport();change(r);assert.throws(()=>recoverProposalCaptureCommand(scope(),r));
 }
});
test('recovered command verifies original stored and replayed receipts without accepting publication claims',()=>{
 const r=proposalReport(),c=recoverProposalCaptureCommand(scope(),r);
 for(const status of ['stored','replayed']){
  const receipt={schemaVersion:1,status,...c.selection,proposalSha256:c.proposalSha256,capturedAt:r.capture.capturedAt,observedAt:r.observedAt};
  assert.equal(verifyProposalCaptureReceipt(new TextEncoder().encode(JSON.stringify(receipt)),c).status,status);
  assert.throws(()=>verifyProposalCaptureReceipt(new TextEncoder().encode(JSON.stringify({...receipt,publicationAuthorized:true})),c));
 }
});
