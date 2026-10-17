import { assertUnsentProposalControls } from "./helpers/inspection_controls.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { proposalReport, proposalScope, proposalId } from './helpers/proposal_fixture.mjs';
import { encodeProposalCapture, parseCapturedProposalEnvelope } from '../src/server/proposal-capture.ts';

const { ProposalComparisonView }=loadTsx(new URL('../src/operator-proposal-view.tsx',import.meta.url));
const render=(decision,selection)=>renderToStaticMarkup(createElement(ProposalComparisonView,{decision,selection}));
function recorded(change=()=>{}) {
  const report=proposalReport(),payload=JSON.parse(report.capture.proposalJson),base=JSON.parse(report.base.publicationJson);
  change(payload,base,report); Object.assign(report.capture,encodeProposalCapture(payload));
  if(report.base!==null){const publicationJson=JSON.stringify(base),publicationSha256=createHash('sha256').update(publicationJson).digest('hex');
    report.base={publicationJson,publicationSha256};report.capture.baseContentSha256=publicationSha256;}
  assert.equal(parseCapturedProposalEnvelope(report).status,'ok');return report;
}
function assertTargets(html) {
  const ids=[...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'unique element IDs');
  for(const [,href] of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(href),href);
}
test('recorded change overview links exact changed wording to both versions and preserves caution',()=>{
  const html=render({kind:'ok',report:recorded()});
  for(const text of ['Recorded changes','Changed statement: Wording.','Statements: 0 added; 0 removed; 1 changed; 0 unchanged.',
    'No page fields changed.','do not measure importance, correctness or publication eligibility','Unverified proposal','Unreviewed.',
    'Conflicting evidence','Missing conflicting evidence is not evidence of agreement','Current public eligibility and source health were not checked'])assert.ok(html.includes(text),text);
  assert.ok(html.includes('href="#proposal-base-claim-'+proposalId(3)+'"'));assert.ok(html.includes('href="#proposal-proposed-claim-'+proposalId(3)+'"'));assertTargets(html);
  assertUnsentProposalControls(html);assert.ok(!html.includes('href="https://'));
});
test('page field and source-reference changes are explicit while captured source values remain escaped',()=>{
  const report=recorded((p,b)=>{p.snapshot.title='Changed <em>title</em>';p.snapshot.summary='Changed summary.';p.snapshot.lastEvidenceReviewOn='2026-09-29';
    p.snapshot.claims[0].type='policy_action';p.snapshot.claims[0].periodLabel='2025–2026';p.snapshot.claims[0].evidence.reverse();
    b.snapshot.claims[0].evidence[0].publisher='Recorded <script>publisher</script>';});
  const html=render({kind:'ok',report});
  assert.ok(html.includes('Changed page fields: Title, Summary, Recorded evidence review date.'));
  assert.ok(html.includes('Changed statement: Statement type, Wording, Data period, Source references.'));
  assert.ok(html.includes('Changed &lt;em&gt;title&lt;/em&gt;'));assert.ok(html.includes('Recorded &lt;script&gt;publisher&lt;/script&gt;'));
  assert.ok(!html.includes('<script>publisher'));assertTargets(html);
});
test('new and removed IDs point only to the versions that contain them',()=>{
  const report=recorded((p)=>p.snapshot.claims[0].id=proposalId(20)),html=render({kind:'ok',report});
  assert.ok(html.includes('Statements: 1 added; 1 removed; 0 changed; 0 unchanged.'));
  for(const href of ['proposal-proposed-claim-'+proposalId(20),'proposal-base-claim-'+proposalId(3)])assert.ok(html.includes('href="#'+href+'"'));
  for(const href of ['proposal-base-claim-'+proposalId(20),'proposal-proposed-claim-'+proposalId(3)])assert.ok(!html.includes('href="#'+href+'"'));
  assertTargets(html);
});
test('reordering the same IDs preserves both panel orders without claiming wording changed',()=>{
  const report=recorded((p,b)=>{b.snapshot=structuredClone(p.snapshot);p.snapshot.claims.push({...structuredClone(p.snapshot.claims[0]),id:proposalId(20)});
    b.snapshot.claims=structuredClone(p.snapshot.claims);p.snapshot.claims.reverse();}),html=render({kind:'ok',report});
  assert.ok(html.includes('same statement IDs appear in a different order'));assert.ok(html.includes('0 changed; 2 unchanged'));
  assert.ok(html.includes('No statement fields changed.'));
  assert.ok(html.indexOf('id="proposal-base-claim-'+proposalId(3))<html.indexOf('id="proposal-base-claim-'+proposalId(20)));
  assert.ok(html.indexOf('id="proposal-proposed-claim-'+proposalId(20))<html.indexOf('id="proposal-proposed-claim-'+proposalId(3)));assertTargets(html);
});
test('witnessed no publication is additions; failed or stale reads expose no overview or old values',()=>{
  const report=recorded((p,b,r)=>{r.base=null;r.capture.basePublicationId=null;r.capture.baseContentSha256=null;r.capture.baseHeadChangedAt=null;}),html=render({kind:'ok',report});
  assert.ok(html.includes('All proposed statements are additions against that checked absence.'));assert.ok(html.includes('1 added; 0 removed; 0 changed; 0 unchanged.'));assertTargets(html);
  for(const kind of ['unconfigured','unavailable','not_found','capture_missing','changed','invalid_scope']){
    const out=render({kind},proposalScope());assert.ok(!out.includes('Recorded changes'));assert.ok(!out.includes('The invented share'));assert.ok(!out.includes('proposal-proposed-claim'));
  }
});
test('corrupt hashes, duplicate claim IDs and mismatched selection withhold the change overview',()=>{
  const hash=recorded();hash.capture.proposalSha256='0'.repeat(64);
  const duplicate=recorded(),p=JSON.parse(duplicate.capture.proposalJson);p.snapshot.claims.push(structuredClone(p.snapshot.claims[0]));
  // A deliberately corrupt stored object: do not use the trusted encoder to fabricate acceptance.
  duplicate.capture.proposalJson=JSON.stringify(p);duplicate.capture.proposalSha256=createHash('sha256').update(duplicate.capture.proposalJson).digest('hex');
  for(const [report,selection] of [[hash,undefined],[duplicate,undefined],[recorded(),{runId:proposalId(99),decisionId:proposalId(2)}]]){
    const html=render({kind:'ok',report},selection);assert.ok(html.includes('Proposal unavailable'));assert.ok(!html.includes('Recorded changes'));assert.ok(!html.includes('The invented share'));
  }
});
test('no recorded field difference still retains holds, unknown translation and publication caution',()=>{
  const html=render({kind:'ok',report:recorded((p,b)=>b.snapshot=structuredClone(p.snapshot))});
  for(const text of ['Recorded changes','0 added; 0 removed; 0 changed; 1 unchanged.','No statement fields changed.','material conflict','Unreviewed.',
    'does not approve a source','not a link to a verified public page'])assert.ok(html.includes(text),text);assertTargets(html);
});
