// Fixed fictional trial boundary; no application import or connection settings.
import {readFileSync} from 'node:fs';
import {prepareWorkProposalCapture,recoverWorkProposalCapture,verifyWorkProposalCaptureReceipt,WORK_PROPOSAL_CAPTURE_SQL} from '../src/server/proposal-work-command.ts';
const input=JSON.parse(readFileSync(0,'utf8'));
const recovering=input.mode==='recover'||input.mode==='recover_verify';
const command=recovering?recoverWorkProposalCapture(input.work,input.selection,input.report):prepareWorkProposalCapture(input.work,input.selection,input.payload);
if(input.mode==='prepare'||input.mode==='recover')console.log(JSON.stringify({...command,sql:WORK_PROPOSAL_CAPTURE_SQL}));
else if(input.mode==='verify'||input.mode==='recover_verify')console.log(JSON.stringify(verifyWorkProposalCaptureReceipt(new TextEncoder().encode(JSON.stringify(input.receipt)),command)));
else throw Error('Fixed fictional work mode unavailable');
