import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {proposalReport,proposalScope,proposalId} from './helpers/proposal_fixture.mjs';
import {encodeProposalCapture,parseCapturedProposalEnvelope} from '../src/server/proposal-capture.ts';
const {ProposalComparisonView}=loadTsx(new URL('../src/operator-proposal-view.tsx',import.meta.url));
const render=(report,selection)=>renderToStaticMarkup(createElement(ProposalComparisonView,{decision:{kind:'ok',report},selection}));
function recorded(change=()=>{}) {
  const report=proposalReport(),payload=JSON.parse(report.capture.proposalJson),base=JSON.parse(report.base.publicationJson);
  change(payload,base,report);Object.assign(report.capture,encodeProposalCapture(payload));
  if(report.base!==null){const publicationJson=JSON.stringify(base),publicationSha256=createHash('sha256').update(publicationJson).digest('hex');report.base={publicationJson,publicationSha256};report.capture.baseContentSha256=publicationSha256;}
  assert.equal(parseCapturedProposalEnvelope(report).status,'ok');return report;
}
const index=html=>/<details class="proposal-source-index">([\s\S]*?)<\/details>/.exec(html)?.[1]??'';
function targets(html){const ids=[...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,'no duplicate target');for(const [,id]of html.matchAll(/href="#([^"]+)"/g))assert.equal(ids.filter(value=>value===id).length,1,`unique target ${id}`);}
const occurrences=body=>[...body.matchAll(/href="#(proposal-(?:base|proposed)-reference-[^"]+)"/g)].map(m=>m[1]);
test('comparison source index connects every checked panel occurrence and its exact receipt',()=>{
  const html=render(recorded()),body=index(html);assert.ok(body,'cross-panel source index exists');
  assert.ok(body.includes('4 reference occurrences across 2 recorded source versions'));
  for(const id of [4,5])assert.ok(body.includes(proposalId(id)));
  assert.deepEqual(occurrences(body),[`proposal-base-reference-${proposalId(3)}-1`,`proposal-proposed-reference-${proposalId(3)}-1`,`proposal-base-reference-${proposalId(3)}-2`,`proposal-proposed-reference-${proposalId(3)}-2`]);
  assert.ok(body.includes('Supporting evidence'));assert.ok(body.includes('Conflicting evidence'));assert.ok(body.includes('not independent confirmation'));
  assert.ok(body.includes('href="#proposal-source-receipt-1"'));assert.ok(body.includes('href="#proposal-source-receipt-2"'));
  assert.ok(html.includes('id="proposal-source-receipt-1"'));assert.ok(html.includes('href="#proposal-source-version-1"'));targets(html);
});
test('repeated metadata preserves side positions and per-side statement counts',()=>{
  const report=recorded((p,b)=>{p.snapshot.claims.push({...structuredClone(p.snapshot.claims[0]),id:proposalId(20)});p.snapshot.claims[0].evidence.push(structuredClone(p.snapshot.claims[0].evidence[0]));b.snapshot.claims[0].evidence[0].title='Different recorded title';});
  const html=render(report),body=index(html);assert.ok(body,'index exists');
  assert.ok(body.includes('7 reference occurrences across 2 recorded source versions'));
  assert.ok(body.includes('Recorded panel: 1 reference occurrence across 1 statement'));
  assert.ok(body.includes('Proposed panel: 3 reference occurrences across 2 statements'));
  assert.equal(occurrences(body).length,7);assert.ok(body.includes('Different recorded title'));assert.ok(body.includes('Invented table'));targets(html);
});
test('same URL with different exact version stays separate and base-only receipts remain unknown',()=>{
  const report=recorded((p,b,r)=>{b.snapshot.claims[0].evidence[0].sourceVersionId=proposalId(40);b.dependencyManifest.sourceVersionIds[0]=proposalId(40);});
  const html=render(report),body=index(html);assert.ok(body,'index exists');
  assert.ok(body.includes('4 reference occurrences across 3 recorded source versions'));assert.ok(body.includes(proposalId(40)));assert.ok(body.includes(proposalId(4)));
  assert.ok(body.includes('No proposal source receipt for this version. Its language and current source state were not checked.'));
  assert.ok(body.includes('versions do not establish independent origins'));assert.ok(!body.includes('language: nb'));targets(html);
});
test('witnessed absence has only proposed occurrences while no-change still exposes conflicting uses',()=>{
  const absent=recorded((p,b,r)=>{r.base=null;r.capture.basePublicationId=null;r.capture.baseContentSha256=null;r.capture.baseHeadChangedAt=null;});
  const html=render(absent),body=index(html);assert.ok(body,'index exists');assert.ok(body.includes('2 reference occurrences across 2 recorded source versions'));
  assert.ok(body.includes('Recorded panel: 0 reference occurrences across 0 statements'));assert.ok(occurrences(body).every(id=>id.startsWith('proposal-proposed-')));targets(html);
  const identical=render(recorded((p,b)=>b.snapshot=structuredClone(p.snapshot)));assert.ok(index(identical).includes('Conflicting evidence'));assert.ok(identical.includes('0 changed; 1 unchanged.'));targets(identical);
});
test('escaped titles and unknown language remain inspectable without outbound or writing controls',()=>{
  const html=render(recorded((p,b)=>{p.snapshot.claims[0].evidence[0].title='<script>source-canary</script>';b.snapshot.claims[0].evidence[0].locator='<em>position</em>';})),body=index(html);
  assert.ok(body,'index exists');assert.ok(body.includes('&lt;script&gt;source-canary'));assert.ok(body.includes('&lt;em&gt;position'));assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Language not recorded'));assert.ok(html.includes('Unreviewed.'));assert.ok(html.includes('Current public eligibility and source health were not checked'));
  for(const forbidden of ['<form','href="https:','rawArchivePath','Approve proposal','Publish proposal'])assert.ok(!html.includes(forbidden),forbidden);
  const buttons=[...html.matchAll(/<button([^>]*)>([^<]+)<\/button>/g)];
  assert.deepEqual(buttons.map(row=>row[2]),['Clear reference finder','Show all reference choices','Reopen scope preparation','Review scope draft','Clear scope draft','Show all responsibility reference choices','Add responsibility entry','Review responsibility draft','Clear responsibility draft','Reopen responsibility preparation','Show all indicator reference choices','Add indicator entry','Inspect unsent indicator draft','Clear indicator draft','Reopen indicator preparation','Inspect combined preparation packet','Clear preparation packet','Read saved preparation packet','Reopen preparation packet']);
  assert.ok(buttons.every(row=>row[1].includes('disabled=""')),'initial local preparation controls are disabled');
  assert.ok(html.includes('Nothing is submitted, saved to the archive or published'));targets(html);
});
test('held corrupt foreign and changed records expose neither index nor receipt navigation',()=>{
  const report=recorded(p=>p.snapshot.claims[0].evidence[0].title='private-source-canary'),bad=structuredClone(report);bad.capture.proposalSha256='0'.repeat(64);
  const htmls=[render(bad),render(report,{runId:proposalId(99),decisionId:proposalId(2)}),...['invalid_scope','unconfigured','unavailable','not_found','capture_missing','changed'].map(kind=>renderToStaticMarkup(createElement(ProposalComparisonView,{decision:{kind,report},selection:proposalScope()})))];
  for(const html of htmls){assert.equal(index(html),'');assert.ok(!html.includes('proposal-source-version-'));assert.ok(!html.includes('proposal-source-receipt-'));assert.ok(!html.includes('private-source-canary'));targets(html);}
});

test('actual proposal page joins finite native bytes to the index and withholds it after a changed read',async()=>{
  const {createProposalReader}=await import('../src/server/operator-proposal-reader.ts');
  const calls=[],signals=[];
  const reader=createProposalReader(async(scope,signal)=>{calls.push(structuredClone(scope));signals.push(signal);return new TextEncoder().encode(JSON.stringify(calls.length===1?recorded():{schemaVersion:1,status:'changed',requested:scope}));},()=>0,()=>assert.fail('unexpected diagnostic'));
  const intercept=name=>name==='next/navigation'?{notFound(){throw Error('expected production refusal');},unstable_rethrow(){}}:name.endsWith('operator-proposal-reader.ts')?{readCapturedProposal:reader}:undefined;
  const page=loadTsx(new URL('../app/editorial-preview/held/proposal/page.tsx',import.meta.url),intercept).default;
  const html=renderToStaticMarkup(await page({searchParams:Promise.resolve(proposalScope())}));
  assert.ok(index(html).includes('4 reference occurrences across 2 recorded source versions'));targets(html);
  const changed=renderToStaticMarkup(await page({searchParams:Promise.resolve(proposalScope())}));
  assert.ok(changed.includes('Comparison changed'));assert.equal(index(changed),'');assert.ok(!changed.includes('proposal-source-version-'));assert.ok(!changed.includes('Invented contrasting table'));
  const invalid=renderToStaticMarkup(await page({searchParams:Promise.resolve({...proposalScope(),unexpected:'private-canary'})}));
  assert.ok(invalid.includes('Choose a recorded decision'));assert.equal(index(invalid),'');assert.deepEqual(calls,[proposalScope(),proposalScope()]);assert.ok(signals.every(signal=>signal.aborted));
  const production=loadTsx(new URL('../app/editorial-preview/held/proposal/page.tsx',import.meta.url),intercept,{env:{NODE_ENV:'production'}}).default;
  await assert.rejects(production({searchParams:Promise.resolve(proposalScope())}),/expected production refusal/);assert.equal(calls.length,2);
});
