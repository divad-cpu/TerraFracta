import assert from 'node:assert/strict';import test from 'node:test';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {canonicalProposalScope,createProposalReader} from '../src/server/operator-proposal-reader.ts';
import {readHeldDecisions,canonicalHeldDecisionScope} from '../src/server/operator-held-decisions-reader.ts';
import {proposalReport,proposalScope,proposalId,proposalBytes} from './helpers/proposal_fixture.mjs';
import {heldReport,decisionRow} from './helpers/operator_held_fixture.mjs';
const scope=()=>({runId:proposalId(1),cursor:{decidedAt:'2026-09-28T07:00:00.000001Z',decisionId:proposalId(90)}});
const heldQuery=()=>({runId:proposalId(1),beforeDecidedAt:scope().cursor.decidedAt,beforeDecisionId:scope().cursor.decisionId,reason:'material_conflict'});
const proposalQuery=()=>({...proposalScope(),...heldQuery()});
const links=html=>[...html.matchAll(/href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>({href:m[1].replaceAll('&amp;','&'),text:m[2]}));
const q=(html,text)=>Object.fromEntries(new URL(links(html).find(x=>x.text===text)?.href??assert.fail('missing '+text),'https://example.invalid').searchParams);
function recorded(scopeValue=scope()){
 const r=heldReport(scopeValue);r.run.createdAt='2026-09-28T05:30:00.000000Z';r.observedAt='2026-09-28T08:00:00.000000Z';
 r.decisions=[{...decisionRow(9),decisionId:proposalId(2),decidedAt:'2026-09-28T06:30:00.000001Z'},
  {...decisionRow(8),decisionId:proposalId(1),decidedAt:'2026-09-28T06:20:00.000001Z',reasonCodes:['source_not_approved']}];return r;
}
function harness(proposalRead=createProposalReader(async()=>proposalBytes(proposalReport()),()=>0,async()=> 'saved'),heldRead=async s=>({kind:'ok',report:recorded(s)})){
 const calls={proposal:[],held:[]},marker=Error('NEXT_NOT_FOUND');
 const intercept=name=>name==='next/navigation'?{notFound(){throw marker;}}:name.endsWith('operator-proposal-reader.ts')?
  {canonicalProposalScope,readCapturedProposal:async s=>{calls.proposal.push(s);return proposalRead(s);}}:name.endsWith('operator-held-decisions-reader.ts')?
  {canonicalHeldDecisionScope,readHeldDecisions:async s=>{calls.held.push(s);return heldRead(s);}}:undefined;
 const proposal=loadTsx(new URL('../app/editorial-preview/held/proposal/page.tsx',import.meta.url),intercept).default;
 const held=loadTsx(new URL('../app/editorial-preview/held/page.tsx',import.meta.url),intercept).default;
 return {calls,proposal,held,renderProposal:async query=>renderToStaticMarkup(await proposal({searchParams:Promise.resolve(query)})),
  renderHeld:async query=>renderToStaticMarkup(await held({searchParams:Promise.resolve(query)}))};
}
const View=loadTsx(new URL('../src/operator-proposal-view.tsx',import.meta.url)).ProposalComparisonView;
const render=(decision,selection,browseQuery)=>renderToStaticMarkup(createElement(View,{decision,selection,browseQuery}));
test('actual filtered older held page to captured proposal and back keeps exact selection and makes separate narrow fresh reads',async()=>{
 const h=harness(),first=await h.renderHeld(heldQuery()),inspect=q(first,'Inspect captured proposal');assert.deepEqual(inspect,proposalQuery());
 const comparison=await h.renderProposal(inspect);assert.deepEqual(h.calls.proposal,[proposalScope()]);assert.ok(comparison.includes('The invented share was 8.2%.'));
 const back=q(comparison,'Return to the selected held page (new read)');assert.deepEqual(back,heldQuery());
 const second=await h.renderHeld(back);assert.deepEqual(h.calls.held,[scope(),scope()]);assert.ok(second.includes('Showing 1 of 2 held decisions'));
 for(const text of ['navigation only','will be checked again','may have changed','Unverified proposal','no approval, editing, collection or publication control'])assert.ok(comparison.includes(text),text);
});
test('legacy first-page all-reason inspection preserves the existing two-key proposal and run-only return',async()=>{
 const h=harness(),first=await h.renderHeld({runId:proposalId(1)});assert.deepEqual(q(first,'Inspect captured proposal'),proposalScope());
 const comparison=await h.renderProposal(proposalScope());assert.deepEqual(q(comparison,'Back to this run’s held decisions'),{runId:proposalId(1)});
 assert.ok(!comparison.includes('Return to the selected held page'));assert.deepEqual(h.calls.proposal,[proposalScope()]);
});
test('withheld and rejected-read pages preserve checked return/retry selection without borrowing private report fields',async()=>{
 for(const read of [...['unconfigured','unavailable','not_found','capture_missing','changed'].map(kind=>async()=>({kind})),async()=>{throw Error('PRIVATE_CANARY');}]){
  const h=harness(read),html=await h.renderProposal(proposalQuery());assert.deepEqual(h.calls.proposal,[proposalScope()]);
  assert.deepEqual(q(html,'Read this selected comparison again'),proposalQuery());assert.deepEqual(q(html,'Return to the selected held page (new read)'),heldQuery());
  for(const text of ['PRIVATE_CANARY','The invented share','Affected page',proposalId(8)])assert.ok(!html.includes(text));assert.ok(!html.includes('<form'));assert.ok(!html.includes('<button'));
 }
});
test('foreign or corrupt envelopes remain withheld while unrelated or malformed return context is dropped',()=>{
 const foreign=proposalReport();foreign.requested.runId=proposalId(99);const html=render({kind:'ok',report:foreign},proposalScope(),proposalQuery());
 assert.ok(html.includes('Proposal unavailable'));assert.deepEqual(q(html,'Return to the selected held page (new read)'),heldQuery());assert.ok(!html.includes(proposalId(99)));assert.ok(!html.includes('The invented share'));
 for(const browse of [{...proposalQuery(),runId:proposalId(99)},{...proposalQuery(),decisionId:proposalId(99)},{...proposalQuery(),reason:'PRIVATE_CANARY'},null]){
  const out=render({kind:'ok',report:proposalReport()},proposalScope(),browse);assert.ok(!out.includes('Return to the selected held page'));assert.ok(!out.includes('PRIVATE_CANARY'));
  assert.deepEqual(q(out,'Back to this run’s held decisions'),{runId:proposalId(1)});
 }
 assert.ok(!render({kind:'invalid_scope'},proposalScope(),proposalQuery()).includes('Return to the selected held page'));
});
test('invalid return tuples and inherited required scope refuse before the actual private read without echoing',async()=>{
 const h=harness(),partial=proposalQuery();delete partial.beforeDecisionId;
 for(const query of [partial,{...proposalQuery(),reason:'PRIVATE_CANARY'},{...proposalQuery(),beforeDecidedAt:['PRIVATE_CANARY']},
  {...proposalQuery(),returnTo:'https://example.invalid/PRIVATE_CANARY'},Object.assign(Object.create(proposalScope()),{beforeDecidedAt:scope().cursor.decidedAt,reason:'material_conflict'})]){
  const html=await h.renderProposal(query);assert.ok(html.includes('selection is invalid'));assert.ok(!html.includes('PRIVATE_CANARY'));assert.ok(!html.includes('The invented share'));assert.ok(!html.includes('Return to the selected held page'));
 }assert.deepEqual(h.calls.proposal,[]);
});
test('a return makes a new held read and changed continuation withholds old records instead of replaying the prior page',async()=>{
 const h=harness(undefined,async()=>({kind:'changed'})),comparison=await h.renderProposal(proposalQuery());
 const html=await h.renderHeld(q(comparison,'Return to the selected held page (new read)'));assert.deepEqual(h.calls.held,[scope()]);assert.ok(html.includes('Held decision list changed'));
 assert.ok(!html.includes('invented-source'));assert.ok(!html.includes('Recorded holds'));assert.deepEqual(q(html,'Start a fresh held-decision read'),{runId:proposalId(1),reason:'material_conflict'});
});
test('twenty bounded decisions link their own IDs and incoming page selection rather than the next cursor or another row',()=>{
 const r=recorded();r.decisions=Array.from({length:20},(_,i)=>({...decisionRow(40-i),decidedAt:'2026-09-28T06:00:00.000001Z',reasonCodes:[i%2?'source_not_approved':'material_conflict']}));r.more=true;r.nextCursor={decidedAt:r.decisions[19].decidedAt,decisionId:r.decisions[19].decisionId};
 const Held=loadTsx(new URL('../src/operator-held-decisions-view.tsx',import.meta.url)).HeldDecisionsView;
 const html=renderToStaticMarkup(createElement(Held,{decision:{kind:'ok',report:r},selection:r.requested,reason:'material_conflict'}));
 const inspect=links(html).filter(x=>x.text==='Inspect captured proposal');assert.equal(inspect.length,10);
 inspect.forEach((link,i)=>assert.deepEqual(Object.fromEntries(new URL(link.href,'https://example.invalid').searchParams),{...heldQuery(),decisionId:r.decisions[i*2].decisionId}));
 assert.ok(html.includes('Showing 10 of 20 held decisions'));assert.ok(html.includes('Some reason entries')===false);
});

test('unstable original query is never revisited across the private read and retained return selection cannot drift',async()=>{
 let reads=0;const input=proposalQuery();Object.defineProperty(input,'runId',{enumerable:true,get(){return ++reads<=2?proposalId(1):proposalId(99);}});
 const h=harness(async selected=>{assert.deepEqual(selected,proposalScope());assert.ok(Object.isFrozen(selected));return {kind:'unavailable'};});
 const html=await h.renderProposal(input);assert.equal(reads,1);assert.deepEqual(h.calls.proposal,[proposalScope()]);
 assert.deepEqual(q(html,'Return to the selected held page (new read)'),heldQuery());assert.deepEqual(q(html,'Read this selected comparison again'),proposalQuery());assert.ok(!html.includes(proposalId(99)));
 const mutable=proposalQuery();const after=harness(async()=>{mutable.beforeDecisionId=proposalId(99);mutable.reason='source_not_approved';return {kind:'unavailable'};});
 const stable=await after.renderProposal(mutable);assert.deepEqual(q(stable,'Return to the selected held page (new read)'),heldQuery());
});
