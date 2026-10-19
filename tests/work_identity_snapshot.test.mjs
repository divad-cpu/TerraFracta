import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {prepareInitialCandidateCaptureForWork as plainInitial} from '../src/server/initial-candidate-capture.ts';
import {prepareHtmlInitialCandidateCaptureForWork as htmlInitial} from '../src/server/html-initial-candidate-capture.ts';
import {preparePdfInitialCandidateCaptureForWork as pdfInitial} from '../src/server/pdf-initial-candidate-capture.ts';
import {prepareAppendedIssueCaptureForWork as plainAppended} from '../src/server/appended-capture-work.ts';
import {prepareHtmlAppendedIssueCaptureForWork as htmlAppended} from '../src/server/html-appended-capture-work.ts';
import {prepareWorkProposalCapture as commonPrepare,recoverWorkProposalCapture as commonRecover} from '../src/server/proposal-work-command.ts';
import {proposalReport,proposalId} from './helpers/proposal_fixture.mjs';
import {htmlInitialFixture,OBSERVED} from './helpers/html_initial_candidate_fixture.mjs';
import {createPostgresInitialCandidateWorkTransport as plainOwner} from '../src/server/postgres-initial-candidate-work-transport.ts';
import {createPostgresHtmlInitialCandidateWorkTransport as htmlOwner} from '../src/server/postgres-html-initial-candidate-work-transport.ts';
const read=name=>readFileSync(new URL('../fixtures/'+name,import.meta.url),'utf8'),json=name=>JSON.parse(read(name));
const original='90000000-0000-4000-8000-000000000098',changed='90000000-0000-4000-8000-000000000097';
const work=runId=>({runId,requestFingerprint:'a'.repeat(64),workClaimId:original});
function mutation(input,w,seen){return new Proxy(input,{get(target,key){seen.calls++;w.workClaimId=changed;return Reflect.get(target,key);},getOwnPropertyDescriptor(target,key){seen.calls++;w.workClaimId=changed;return Reflect.getOwnPropertyDescriptor(target,key);}});}
function initialRows(){
 const plain={raw:read('fictional-detached-preparation.json'),expected:json('fictional-detached-preparation-expected.json')};
 const html=json('fictional-html-initial-candidate.json'),pdf=json('fictional-stored-pdf-preparation-review.json');
 return [['plain',plainInitial,plain.raw,plain.expected],['HTML',htmlInitial,html.reportJson,html.expected],['PDF',pdfInitial,pdf.reportJson,pdf.expected]];
}
for(const [name,prepare,raw,expected]of initialRows())test(name+' initial capture retains original work before accepted report descriptor callbacks',()=>{
 const r=JSON.parse(raw),selection=JSON.parse(r.parts?r.parts.selection_json:r.selection_json),w=work(selection.runId),seen={calls:0};
 const command=prepare(w,raw,mutation(expected,w,seen));assert.ok(seen.calls>0);assert.equal(w.workClaimId,changed);assert.equal(command.work.workClaimId,original);assert.equal(command.values[2],original);
});
for(const [name,prepare,file]of [['plain',plainAppended,'fictional-appended-issue-review.json'],['HTML',htmlAppended,'fictional-html-appended-issue-review.json']])test(name+' complete capture retains original work before accepted composition descriptor callbacks',()=>{
 const v=json(file).cases[0],r=JSON.parse(v.bundle.candidateReportJson),selection=JSON.parse(r.parts?r.parts.selection_json:r.selection_json),w=work(selection.runId),seen={calls:0};
 const command=prepare(w,v.bundle,mutation(v.expected,w,seen));assert.ok(seen.calls>0);assert.equal(w.workClaimId,changed);assert.equal(command.work.workClaimId,original);assert.equal(command.values[2],original);
});
test('common capture preparation snapshots work before accepted selection getters',()=>{
 const r=proposalReport(),w=work(proposalId(1)),s={captureId:proposalId(8),runId:proposalId(1),decisionId:proposalId(2),issueId:proposalId(7),basePublicationId:proposalId(6)},id=s.captureId;let calls=0;
 Object.defineProperty(s,'captureId',{enumerable:true,get(){calls++;w.workClaimId=changed;return id;}});
 const out=commonPrepare(w,s,JSON.parse(r.capture.proposalJson));assert.equal(calls,1);assert.equal(out.work.workClaimId,original);
});
test('common retained recovery snapshots work before accepted report getters',()=>{
 const r=proposalReport(),w=work(proposalId(1)),capture=r.capture;let calls=0;
 Object.defineProperty(r,'capture',{enumerable:true,get(){calls++;w.workClaimId=changed;return capture;}});
 const out=commonRecover(w,{runId:proposalId(1),decisionId:proposalId(2),issueId:proposalId(7)},r);assert.ok(calls>0);assert.equal(out.work.workClaimId,original);
});
for(const name of ['plain','HTML'])test(name+' initial explicit owner recovery captures current work before external expectation callbacks',async()=>{
 let raw,intent,expected,at,prepare;
 if(name==='plain'){const f=json('fictional-initial-candidate-capture.json');raw=f.rawReceiptJson;intent=f.retainedIntentJson;expected=f.preparationExpected;at=f.captureObservedAt;prepare=plainOwner;}
 else{const f=htmlInitialFixture();raw=f.raw.toString('utf8');intent=f.command.intentJson;expected=f.expected;at=OBSERVED;prepare=htmlOwner;}
 const i=JSON.parse(intent),w=work(i.run_id),queries=[],seen={calls:0};
 const client={getTransactionStatus:()=> 'I',query:async q=>{queries.push(q);return q.text.startsWith('SET ')?{command:'SET',rowCount:null,fields:[],rows:[]}:{command:'SELECT',rowCount:1,fields:[{name:'admitted',dataTypeID:16},{name:'capture',dataTypeID:25}],rows:[[true,raw]]};}};
 const owner={user:'postgres',shutdown:async()=>true,run:async(_signal,execute)=>execute(client,()=>{})};
 const out=await prepare(owner,()=>at,async()=>assert.fail('No diagnostic')).recover(w,Buffer.from(raw),intent,mutation(expected,w,seen),at,new AbortController().signal);
 assert.ok(seen.calls>0);assert.equal(out.kind,'confirmed');assert.equal(out.work.workClaimId,original);assert.equal(queries.at(-1).values[2],original);
});
