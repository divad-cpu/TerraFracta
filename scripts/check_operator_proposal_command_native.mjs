// Fixed invented producer trial helper; no connection, endpoint or credential.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {prepareProposalCaptureCommand,verifyProposalCaptureReceipt,PROPOSAL_CAPTURE_SQL} from '../src/server/proposal-capture-command.ts';
import {proposedPayload,proposalId} from '../tests/helpers/proposal_fixture.mjs';
const selection={captureId:proposalId(38),runId:proposalId(1),decisionId:proposalId(32),issueId:proposalId(7),basePublicationId:proposalId(6)};
const command=prepareProposalCaptureCommand(selection,proposedPayload()),input=JSON.parse(readFileSync(0,'utf8'));
if(input.mode==='prepare')console.log(JSON.stringify({sql:PROPOSAL_CAPTURE_SQL,values:command.values,sha256:command.proposalSha256}));
else if(input.mode==='verify'){
 const receipts=input.receipts.map(({name,value,status})=>{const expected=name.startsWith('producer-concurrent')?
  prepareProposalCaptureCommand({...selection,captureId:proposalId(28),decisionId:proposalId(22)},proposedPayload()):name.startsWith('producer-reverse')?
  prepareProposalCaptureCommand({...selection,captureId:proposalId(48),decisionId:proposalId(42)},proposedPayload()):command;
  const r=verifyProposalCaptureReceipt(new TextEncoder().encode(JSON.stringify(value)),expected);assert.equal(r.status,status,name);
  return {name,captureId:r.captureId,status:r.status,proposalSha256:r.proposalSha256,capturedAt:r.capturedAt};});
 for(const id of new Set(receipts.map(r=>r.captureId)))assert.equal(new Set(receipts.filter(r=>r.captureId===id).map(r=>r.capturedAt)).size,1);
 console.log(JSON.stringify({methods:receipts.length,receipts,publicationAuthorized:false}));
}else throw Error('Fixed producer trial mode unavailable');
