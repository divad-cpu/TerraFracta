import { assertUnsentProposalControls } from "./helpers/inspection_controls.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {proposalReport,proposalScope,proposalId} from './helpers/proposal_fixture.mjs';
import {encodeProposalCapture,parseCapturedProposalEnvelope} from '../src/server/proposal-capture.ts';
const {ProposalComparisonView}=loadTsx(new URL('../src/operator-proposal-view.tsx',import.meta.url));
const render=(report,selection,browseQuery)=>renderToStaticMarkup(createElement(ProposalComparisonView,{decision:{kind:'ok',report},selection,browseQuery}));
const fields=['title','summary','lastEvidenceReviewOn'];
const id=(side,field)=>`proposal-${side}-page-${field}`;
function recorded(change=()=>{}){
 const r=proposalReport(),p=JSON.parse(r.capture.proposalJson),b=JSON.parse(r.base.publicationJson);b.snapshot=structuredClone(p.snapshot);change(p,b,r);Object.assign(r.capture,encodeProposalCapture(p));
 if(r.base!==null){const publicationJson=JSON.stringify(b),publicationSha256=createHash('sha256').update(publicationJson).digest('hex');r.base={publicationJson,publicationSha256};r.capture.baseContentSha256=publicationSha256;}
 assert.equal(parseCapturedProposalEnvelope(r).status,'ok');return r;
}
function targets(html){
 const ids=[...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 for(const [,fragment] of html.matchAll(/href="#([^"]+)"/g))assert.equal(ids.filter(x=>x===fragment).length,1,fragment);
 return ids;
}
const links=html=>[...html.matchAll(/href="#(proposal-(?:base|proposed)-page-[^"]+)"/g)].map(m=>m[1]);
test('each separately changed recorded page field links only its exact two values without inferring source or publication qualification',()=>{
 for(const field of fields){
  const r=recorded(p=>p.snapshot[field]=field==='lastEvidenceReviewOn'?'2026-09-27':`Different ${field}`),html=render(r);
  assert.deepEqual(links(html),[id('base',field),id('proposed',field)]);targets(html);
  for(const text of ['Unverified proposal','do not measure importance, correctness or publication eligibility','Current public eligibility and source health were not checked','These explanations describe recorded codes, not current findings.'])assert.ok(html.includes(text),text);
 }
});
test('three changed page fields keep their existing field order and unique side targets alongside exact statement and reference differences',()=>{
 const html=render(recorded(p=>{p.snapshot.title='Different title';p.snapshot.summary='Different summary';p.snapshot.lastEvidenceReviewOn='2026-09-27';p.snapshot.claims[0].assertion='Different assertion';p.snapshot.claims[0].evidence[1].locator='Different locator';}));
 assert.deepEqual(links(html),fields.flatMap(field=>[id('base',field),id('proposed',field)]));assert.ok(html.includes('Changed page fields: Title, Summary, Recorded evidence review date.'));assert.ok(html.includes('Changed statement: Wording, Source references.'));assert.ok(html.includes('Reference records that differ'));targets(html);
});
test('unchanged and statement-only changes retain real panel targets without inventing page-field change links',()=>{
 for(const r of [recorded(),recorded(p=>p.snapshot.claims[0].assertion='Only wording changed')]){
  const html=render(r);assert.deepEqual(links(html),[]);assert.ok(!html.includes('aria-label="Changed page fields"'));assert.ok(html.includes('No page fields changed.'));
  const ids=targets(html);for(const side of ['base','proposed'])for(const field of fields)assert.ok(ids.includes(id(side,field)));
 }
});
test('a checked absent base has only proposed value targets and creates no paired page-field difference links',()=>{
 const html=render(recorded((p,b,r)=>{r.base=null;r.capture.basePublicationId=null;r.capture.baseContentSha256=null;r.capture.baseHeadChangedAt=null;}));
 assert.deepEqual(links(html),[]);const ids=targets(html);for(const field of fields){assert.ok(ids.includes(id('proposed',field)));assert.ok(!ids.includes(id('base',field)));}
 assert.ok(html.includes('This is a checked absence, not a failed read.'));assert.ok(html.includes('All proposed statements are additions against that checked absence.'));
});
test('invalid corrupt foreign and withheld captures expose no page-field link target or private value',()=>{
 const r=recorded(p=>{p.snapshot.title='PRIVATE_FIELD_CANARY';p.snapshot.summary='PRIVATE_FIELD_CANARY';});const bad=structuredClone(r);bad.capture.proposalSha256='0'.repeat(64);
 const outputs=[render(bad),render(r,{runId:proposalId(99),decisionId:proposalId(2)}),...['invalid_scope','unconfigured','unavailable','not_found','capture_missing','changed'].map(kind=>renderToStaticMarkup(createElement(ProposalComparisonView,{decision:{kind,report:r},selection:proposalScope()})))];
 for(const html of outputs){assert.deepEqual(links(html),[]);assert.ok(!html.includes('PRIVATE_FIELD_CANARY'));for(const side of ['base','proposed'])for(const field of fields)assert.ok(!html.includes(id(side,field)));assert.ok(!html.includes('aria-label="Changed page fields"'));}
});
test('literal captured values remain escaped and recorded dates and checked held-return context stay separate from fragment navigation',()=>{
 const html=render(recorded(p=>{p.snapshot.title='Changed <script>title</script>';p.snapshot.summary='Changed <a href="/private">summary</a>';p.snapshot.lastEvidenceReviewOn='2026-09-27';}),proposalScope(),{...proposalScope(),beforeDecidedAt:'2026-09-28T07:00:00.000001Z',beforeDecisionId:proposalId(90),reason:'material_conflict'});
 assert.ok(html.includes('&lt;script&gt;title'));assert.ok(html.includes('&lt;a href=&quot;/private&quot;&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="/private"'));assert.ok(html.includes('Recorded last evidence review: <time dateTime="2026-09-27">2026-09-27</time>'));
 assert.ok(html.includes('Return to the selected held page (new read)'));assert.ok(html.includes('navigation only'));assert.ok(html.includes('reason=material_conflict'));assert.ok(html.includes('Unreviewed.'));assert.ok(html.includes('Conflicting evidence'));
 assertUnsentProposalControls(html);for(const unsafe of ['href="https:','rawArchivePath'])assert.ok(!html.includes(unsafe));targets(html);
});
