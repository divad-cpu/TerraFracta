import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {heldReport,decisionRow,bytes} from './helpers/operator_held_fixture.mjs';
import {proposalReport,proposalScope,proposalId,proposalBytes} from './helpers/proposal_fixture.mjs';
import {heldBrowseSelection} from '../src/operator-held-browse.ts';
import {proposalBrowseSelection} from '../src/operator-proposal-navigation.ts';
import {canonicalHeldDecisionScope,createHeldDecisionsReader} from '../src/server/operator-held-decisions-reader.ts';
import {createProposalReader} from '../src/server/operator-proposal-reader.ts';

const Held=loadTsx(new URL('../src/operator-held-decisions-view.tsx',import.meta.url)).HeldDecisionsView;
const Proposal=loadTsx(new URL('../src/operator-proposal-view.tsx',import.meta.url)).ProposalComparisonView;
const render=(View,props)=>renderToStaticMarkup(View(props));
const links=html=>[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>({href:m[1].replaceAll('&amp;','&'),text:m[2]}));
const url=link=>new URL(link.href,'https://example.invalid');
const query=u=>Object.fromEntries(u.searchParams);
const scope=()=>({runId:proposalId(1),cursor:{decidedAt:'2026-09-28T07:00:00.000001Z',decisionId:proposalId(90)}});
const runReturn=()=>({runId:proposalId(1),cursor:{createdAt:'2026-09-28T05:30:00.000001Z',runId:proposalId(99)}});
const heldQuery=()=>({runId:proposalId(1),beforeDecidedAt:scope().cursor.decidedAt,beforeDecisionId:scope().cursor.decisionId,reason:'material_conflict',returnToRuns:'1',returnBeforeCreatedAt:runReturn().cursor.createdAt,returnBeforeRunId:proposalId(99)});
function report(){
 const r=heldReport(scope());r.run.createdAt='2026-09-28T05:30:00.000000Z';r.observedAt='2026-09-28T08:00:00.000000Z';
 r.decisions=[{...decisionRow(9),decisionId:proposalId(2),decidedAt:'2026-09-28T06:30:00.000001Z'},
  {...decisionRow(8),decisionId:proposalId(1),decidedAt:'2026-09-28T06:30:00.000001Z',reasonCodes:['source_not_approved']}];return r;
}

test('visible held row links distinguish tied times and retain the exact checked page reason and independent run return',()=>{
 const r=report(),html=render(Held,{decision:{kind:'ok',report:r},selection:scope(),reason:'',runReturn:runReturn()});
 const rows=links(html).filter(x=>x.text==='Link to this recorded hold');assert.equal(rows.length,2);
 rows.forEach((link,i)=>{
  const u=url(link),id=r.decisions[i].decisionId;assert.equal(u.hash,`#recorded-hold-${id}`);assert.ok(html.includes(`id="recorded-hold-${id}"`));
  const selected=heldBrowseSelection(query(u));assert.ok(selected);assert.deepEqual(selected,{scope:scope(),reason:'',runReturn:runReturn()});
  assert.equal(u.pathname,'/editorial-preview/held');assert.equal(u.searchParams.has('decisionId'),false);
 });
 assert.match(html,/Following a link makes a new read/);assert.match(html,/may be absent or filtered out/);
 const filtered=render(Held,{decision:{kind:'ok',report:r},selection:scope(),reason:'material_conflict',runReturn:runReturn()});
 assert.deepEqual(query(url(links(filtered).find(x=>x.text==='Link to this recorded hold'))),heldQuery());
});

test('filtered empty malformed mismatched and held rows acquire no unobserved hold anchors or record links',()=>{
 const r=report();const filtered=render(Held,{decision:{kind:'ok',report:r},reason:'material_conflict'});
 assert.ok(filtered.includes(`id="recorded-hold-${proposalId(2)}"`));assert.ok(!filtered.includes(`recorded-hold-${proposalId(1)}`));
 for(const props of [
  {decision:{kind:'ok',report:r},reason:'mode_unsupported'},
  {decision:{kind:'ok',report:{...r,privateNote:'invented_private_canary'}}},
  {decision:{kind:'ok',report:r},selection:{...scope(),runId:proposalId(99)}},
  ...['invalid_scope','unconfigured','unavailable','changed','not_found'].map(kind=>({decision:{kind,report:r},selection:scope()})),
 ])assert.doesNotMatch(render(Held,props),/id="recorded-hold-|Link to this recorded hold|invented_private_canary/);
});

test('only a checked comparison with matching selected held-page context offers an exact hold-location link',()=>{
 const p=proposalReport(),browse={...heldQuery(),decisionId:proposalId(2)};
 const html=render(Proposal,{decision:{kind:'ok',report:p},selection:proposalScope(),browseQuery:browse});
 const located=links(html).find(x=>x.text==='Locate this recorded hold on the selected page (new read)');assert.ok(located);
 assert.equal(url(located).hash,`#recorded-hold-${proposalId(2)}`);assert.deepEqual(query(url(located)),heldQuery());
 const old=links(html).find(x=>x.text==='Return to the selected held page (new read)');assert.ok(old);assert.equal(url(old).hash,'');assert.deepEqual(query(url(old)),heldQuery());
 assert.match(html,/this link does not retain the held page/);
 for(const props of [
  {decision:{kind:'ok',report:p},selection:proposalScope()},
  {decision:{kind:'ok',report:p},selection:proposalScope(),browseQuery:{...browse,decisionId:proposalId(99)}},
  {decision:{kind:'ok',report:{...p,privateNote:'invented_private_canary'}},selection:proposalScope(),browseQuery:browse},
  ...['invalid_scope','unconfigured','unavailable','capture_missing','changed','not_found'].map(kind=>({decision:{kind},selection:proposalScope(),browseQuery:browse})),
 ])assert.doesNotMatch(render(Proposal,props),/Locate this recorded hold|#recorded-hold-|invented_private_canary/);
});

test('actual held and comparison pages follow an exact location through new byte reads and withhold a changed page',async()=>{
 const calls={held:[],proposal:[]},signals=[];
 const readHeld=createHeldDecisionsReader(async(s,signal)=>{calls.held.push(structuredClone(s));signals.push(signal);return bytes(calls.held.length===1?report():{schemaVersion:1,status:'changed',requested:s});},()=>0,()=>assert.fail('unexpected diagnostic'));
 const readProposal=createProposalReader(async(s,signal)=>{calls.proposal.push(structuredClone(s));signals.push(signal);return proposalBytes(proposalReport());},()=>0,()=>assert.fail('unexpected diagnostic'));
 const intercept=name=>name==='next/navigation'?{notFound(){assert.fail('unexpected notFound');},unstable_rethrow(){}}:name.endsWith('operator-held-decisions-reader.ts')?{canonicalHeldDecisionScope,readHeldDecisions:readHeld}:name.endsWith('operator-proposal-reader.ts')?{readCapturedProposal:readProposal}:undefined;
 const held=loadTsx(new URL('../app/editorial-preview/held/page.tsx',import.meta.url),intercept).default;
 const proposal=loadTsx(new URL('../app/editorial-preview/held/proposal/page.tsx',import.meta.url),intercept).default;
 const first=renderToStaticMarkup(await held({searchParams:Promise.resolve(heldQuery())}));
 const inspect=query(url(links(first).find(x=>x.text==='Inspect captured proposal')));assert.deepEqual(proposalBrowseSelection(inspect).scope,proposalScope());
 const comparison=renderToStaticMarkup(await proposal({searchParams:Promise.resolve(inspect)}));
 const located=url(links(comparison).find(x=>x.text==='Locate this recorded hold on the selected page (new read)'));assert.equal(located.hash,`#recorded-hold-${proposalId(2)}`);
 const second=renderToStaticMarkup(await held({searchParams:Promise.resolve(query(located))}));
 assert.deepEqual(calls,{held:[scope(),scope()],proposal:[proposalScope()]});assert.ok(signals.every(x=>x.aborted));
 assert.match(second,/Held decision list changed/);assert.doesNotMatch(second,/id="recorded-hold-|Link to this recorded hold|invented-source/);
});
