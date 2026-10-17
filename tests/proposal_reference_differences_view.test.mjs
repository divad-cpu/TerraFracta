import { assertUnsentProposalControls } from "./helpers/inspection_controls.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { proposalReport, proposalScope, proposalId } from './helpers/proposal_fixture.mjs';
import { encodeProposalCapture, parseCapturedProposalEnvelope } from '../src/server/proposal-capture.ts';
const {ProposalComparisonView}=loadTsx(new URL('../src/operator-proposal-view.tsx',import.meta.url));
const render=(report,selection)=>renderToStaticMarkup(createElement(ProposalComparisonView,{decision:{kind:'ok',report},selection}));
function recorded(change=()=>{}){
 const report=proposalReport(),payload=JSON.parse(report.capture.proposalJson),base=JSON.parse(report.base.publicationJson);
 base.snapshot=structuredClone(payload.snapshot);change(payload,base,report);Object.assign(report.capture,encodeProposalCapture(payload));
 if(report.base!==null){const publicationJson=JSON.stringify(base),publicationSha256=createHash('sha256').update(publicationJson).digest('hex');report.base={publicationJson,publicationSha256};report.capture.baseContentSha256=publicationSha256;}
 assert.equal(parseCapturedProposalEnvelope(report).status,'ok');return report;
}
const links=html=>[...html.matchAll(/href="#(proposal-(base|proposed)-reference-[^"]+)"[^>]*>(Recorded|Proposed) reference (\d+)<\/a>/g)].map(m=>({id:m[1],side:m[2],number:Number(m[4])}));
function targets(html){const ids=[...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);for(const link of links(html))assert.equal(ids.filter(id=>id===link.id).length,1);}

test('changed reference metadata has exact side-position links and unchanged comparison cautions',()=>{
 const html=render(recorded(p=>{p.snapshot.claims[0].evidence[1].title='Different recorded title';}));
 assert.ok(html.includes('Reference records that differ'));assert.ok(html.includes('1 identical reference occurrence; 1 only in the recorded panel; 1 only in the proposed panel.'));
 assert.deepEqual(links(html),[{id:`proposal-base-reference-${proposalId(3)}-2`,side:'base',number:2},{id:`proposal-proposed-reference-${proposalId(3)}-2`,side:'proposed',number:2}]);
 assert.ok(html.includes('A metadata change appears on each side'));assert.ok(html.includes('does not qualify a source or its evidence'));assert.ok(html.includes('Unverified proposal'));targets(html);
});
test('an added identical duplicate is a distinct proposed occurrence and keeps conflict evidence',()=>{
 const html=render(recorded(p=>{p.snapshot.claims[0].evidence.push(structuredClone(p.snapshot.claims[0].evidence[0]));}));
 assert.ok(html.includes('2 identical reference occurrences; 0 only in the recorded panel; 1 only in the proposed panel.'));
 assert.deepEqual(links(html),[{id:`proposal-proposed-reference-${proposalId(3)}-3`,side:'proposed',number:3}]);assert.ok(html.includes('Conflicting evidence'));targets(html);
});
test('the same exact records in a different order get an order-only explanation',()=>{
 const html=render(recorded(p=>p.snapshot.claims[0].evidence.reverse()));
 assert.ok(html.includes('The same recorded reference values appear in a different order. No reference value was added or removed.'));
 assert.ok(html.includes('2 identical reference occurrences; 0 only in the recorded panel; 0 only in the proposed panel.'));assert.deepEqual(links(html),[]);targets(html);
});
test('a changed version at the same origin is a different full record rather than an inferred source identity',()=>{
 const html=render(recorded((p,b,r)=>{p.snapshot.claims[0].evidence[1].sourceVersionId=proposalId(56);p.dependencyManifest.sourceVersionIds[1]=proposalId(56);r.sourceReceipts[1].sourceVersionId=proposalId(56);}));
 assert.ok(html.includes('1 identical reference occurrence; 1 only in the recorded panel; 1 only in the proposed panel.'));
 assert.equal(links(html).length,2);assert.ok(html.includes(proposalId(5)));assert.ok(html.includes(proposalId(56)));targets(html);
});
test('unchanged references new statement IDs and a witnessed absent base do not invent a reference comparison',()=>{
 for(const report of [recorded(),recorded(p=>p.snapshot.claims[0].id=proposalId(20)),recorded((p,b,r)=>{r.base=null;r.capture.basePublicationId=null;r.capture.baseContentSha256=null;r.capture.baseHeadChangedAt=null;})]){
  const html=render(report);assert.ok(!html.includes('Reference records that differ'));assert.deepEqual(links(html),[]);targets(html);
 }
});
test('foreign corrupt and held reports withhold every new reference link and target',()=>{
 const report=recorded(p=>p.snapshot.claims[0].evidence[1].title='private-canary'),bad=structuredClone(report);bad.capture.proposalSha256='0'.repeat(64);
 for(const html of [render(bad),render(report,{runId:proposalId(99),decisionId:proposalId(2)}),...['unconfigured','unavailable','not_found','capture_missing','changed','invalid_scope'].map(kind=>renderToStaticMarkup(createElement(ProposalComparisonView,{decision:{kind,report},selection:proposalScope()})))]){
  assert.deepEqual(links(html),[]);assert.ok(!html.includes('proposal-base-reference-'));assert.ok(!html.includes('proposal-proposed-reference-'));assert.ok(!html.includes('Reference records that differ'));assert.ok(!html.includes('private-canary'));
 }
});
test('twelve changed positions on both panels remain escaped uniquely targeted and inspection-only',()=>{
 const html=render(recorded((p,b,r)=>{
  const original=structuredClone(p.snapshot.claims[0].evidence);
  b.snapshot.claims[0].evidence=Array.from({length:12},(_,i)=>({...original[i%2],locator:`Recorded ${i}`}));
  p.snapshot.claims[0].evidence=Array.from({length:12},(_,i)=>({...original[i%2],locator:`Proposed ${i}`,title:'<script>title-canary</script>'}));
  r.decision.evidenceLocator='Proposed 0';
 }));
 assert.ok(html.includes('0 identical reference occurrences; 12 only in the recorded panel; 12 only in the proposed panel.'));
 assert.equal(links(html).length,24);targets(html);assert.ok(html.includes('&lt;script&gt;title-canary'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('Supporting evidence'));assert.ok(html.includes('Conflicting evidence'));
 assertUnsentProposalControls(html);for(const forbidden of ['href="https:','rawArchivePath'])assert.ok(!html.includes(forbidden),forbidden);
});
