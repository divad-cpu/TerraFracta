import assert from 'node:assert/strict';import test from 'node:test';
import {prepareProposalCaptureCommand,verifyProposalCaptureReceipt,PROPOSAL_CAPTURE_SQL} from '../src/server/proposal-capture-command.ts';
import {proposedPayload,proposalId,proposalBytes} from './helpers/proposal_fixture.mjs';
const selection=()=>({captureId:proposalId(38),runId:proposalId(1),decisionId:proposalId(32),issueId:proposalId(7),basePublicationId:proposalId(6)});
const receipt=c=>({...c.selection,schemaVersion:1,status:'stored',proposalSha256:c.proposalSha256,capturedAt:'2026-09-28T07:00:00.000001Z',observedAt:'2026-09-28T07:00:00.000001Z'});
test('trusted command carries only fixed positional values and exact canonical captured content',()=>{
 const s=selection(),p=proposedPayload(),c=prepareProposalCaptureCommand(s,p);s.runId=proposalId(99);p.snapshot.summary='Changed';
 assert.equal(c.selection.runId,proposalId(1));assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.values)&&Object.isFrozen(c.selection));
 assert.deepEqual(c.values.slice(0,5),Object.values(selection()));assert.equal(JSON.parse(c.values[5]).snapshot.summary,'Invented proposed summary.');
 assert.ok(PROPOSAL_CAPTURE_SQL.includes('$6::text'));assert.ok(!PROPOSAL_CAPTURE_SQL.includes(c.values[0]));
});
test('foreign/unknown selection, normalization and non-proposal approval reject before a backend is called',()=>{
 for(const s of [{...selection(),sql:'PRIVATE_CANARY'},{...selection(),runId:'PRIVATE_CANARY'},{...selection(),captureId:null}])assert.throws(()=>prepareProposalCaptureCommand(s,proposedPayload()));
 const p=proposedPayload();p.translation.status='approved';assert.throws(()=>prepareProposalCaptureCommand(selection(),p));
});
test('stored and unchanged replay receipts bind scope/hash and never imply present publication eligibility',()=>{
 const c=prepareProposalCaptureCommand(selection(),proposedPayload());for(const status of ['stored','replayed']){
 const r=verifyProposalCaptureReceipt(proposalBytes({...receipt(c),status}),c);assert.equal(r.status,status);assert.ok(!Object.hasOwn(r,'published'));}
});
test('foreign receipts, byte corruption, duplicate aliases, hidden fields and microsecond reverse time reject',()=>{
 const c=prepareProposalCaptureCommand(selection(),proposedPayload());
 for(const change of [r=>r.captureId=proposalId(99),r=>r.runId=proposalId(99),r=>r.decisionId=proposalId(99),r=>r.issueId=proposalId(99),
 r=>r.basePublicationId=null,r=>r.proposalSha256='b'.repeat(64),r=>r.observedAt='2026-09-28T07:00:00.000000Z',r=>r.extra='PRIVATE_CANARY',r=>r.status='published']){
 const r=receipt(c);change(r);assert.throws(()=>verifyProposalCaptureReceipt(proposalBytes(r),c));}
 for(const raw of [null,new Uint8Array([255]),new Uint8Array(2049),proposalBytes(receipt(c)).slice(0,20)])assert.throws(()=>verifyProposalCaptureReceipt(raw,c));
 const raw=JSON.stringify(receipt(c)).replace('"status":"stored"','"status":"published","\\u0073tatus":"stored"');assert.throws(()=>verifyProposalCaptureReceipt(new TextEncoder().encode(raw),c));
});
