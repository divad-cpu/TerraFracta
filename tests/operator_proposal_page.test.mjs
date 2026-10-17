import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';import ts from 'typescript';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {canonicalProposalScope,createProposalReader,readCapturedProposal} from '../src/server/operator-proposal-reader.ts';
import {proposalReport,proposalScope,proposalBytes,proposalId} from './helpers/proposal_fixture.mjs';
const pageSource=new URL('../app/editorial-preview/held/proposal/page.tsx',import.meta.url);
function harness(mode='development',read=readCapturedProposal){
 const marker=Error('NEXT_NOT_FOUND'),calls=[],modules=new Map();
 function load(source){if(modules.has(source.href))return modules.get(source.href);const exports={},native=createRequire(source);modules.set(source.href,exports);
  const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports','process',compiled)(name=>{
   if(name==='next/navigation')return {unstable_rethrow:native(name).unstable_rethrow,notFound(){throw marker;}};
   if(source.href===pageSource.href&&name.endsWith('operator-proposal-reader.ts'))return {canonicalProposalScope,readCapturedProposal:async scope=>{calls.push(scope);return read(scope);}};
   if(name.startsWith('.')){const candidate=new URL(name.endsWith('.tsx')?name:name+'.tsx',source);if(existsSync(candidate))return load(candidate);}
   return native(name);
  },exports,{env:{NODE_ENV:mode}});return exports;}
 const page=load(pageSource).default,view=load(new URL('../src/operator-proposal-view.tsx',import.meta.url)).ProposalComparisonView;
 return {page,marker,calls,render:async q=>renderToStaticMarkup(await page({searchParams:Promise.resolve(q)})),
  view:(decision,selection)=>renderToStaticMarkup(createElement(view,{decision,selection}))};
}
test('real typed reader/page/presenter preserves proposed/current wording, exact conflict refs, translation unknown and safe target',async()=>{
 const h=harness('development',createProposalReader(async()=>proposalBytes(proposalReport()),()=>0,async()=> 'saved'));
 const html=await h.render(proposalScope());assert.equal(h.calls.length,1);
 for(const text of ['The invented share was 7.5%.','The invented share was 8.2%.','Conflicting evidence','invented row 2','Unreviewed.',
  'Language not recorded','Missing conflicting evidence is not evidence of agreement','Proposed content — unverified'])assert.ok(html.includes(text),text);
 assert.ok(html.includes('Prepare missing dossier scope — unsent'));assert.ok(html.includes('<button type="button" disabled="">Review scope draft'));assert.ok(!html.includes('<form'));assert.ok(!html.includes('href="https://example.org'));
 const back=[...html.matchAll(/href="([^"]+)"/g)].find(x=>x[1].startsWith('/editorial-preview/held?'))[1].replaceAll('&amp;','&');
 assert.deepEqual(Object.fromEntries(new URL(back,'https://example.invalid').searchParams),{runId:proposalId(1)});
});
test('production/test/unknown environments refuse before props/private reads; malformed query does not echo',async()=>{
 for(const mode of ['production','test','']){const h=harness(mode);await assert.rejects(h.page(new Proxy({},{get(){assert.fail('props read');}})),e=>e===h.marker);assert.equal(h.calls.length,0);}
 const h=harness();for(const q of [null,[],{}, {...proposalScope(),sql:'PRIVATE_CANARY'}, {...proposalScope(),decisionId:['PRIVATE_CANARY']},
  {...proposalScope(),runId:'PRIVATE_CANARY'}]){const html=await h.render(q);assert.ok(html.includes('selection is invalid'));assert.ok(!html.includes('PRIVATE_CANARY'));}
 assert.equal(h.calls.length,0);
});
test('ordinary absence/legacy/change/read failure withhold all old content; known-none head remains distinct',()=>{
 const h=harness();for(const [kind,label] of [['unconfigured','not configured'],['unavailable','not an empty or healthy result'],
  ['not_found','Held decision not found'],['capture_missing','Proposal not captured'],['changed','Comparison changed']]){
  const html=h.view({kind});assert.ok(html.includes(label));assert.ok(!html.includes('The invented share'));assert.ok(!html.includes(proposalId(8)));}
 const r=proposalReport();r.base=null;r.capture.basePublicationId=null;r.capture.baseContentSha256=null;r.capture.baseHeadChangedAt=null;
 assert.ok(h.view({kind:'ok',report:r}).includes('witnessed issue head had no publication'));
});
test('presenter independently rejects corrupt/mismatched objects and escapes captured assertions rather than executing markup',()=>{
 const h=harness();for(const change of [r=>r.extra='PRIVATE_CANARY',r=>r.capture.proposalSha256='0'.repeat(64),r=>r.target.issueId=proposalId(99)]){
  const r=proposalReport();change(r);const out=h.view({kind:'ok',report:r});assert.ok(out.includes('Proposal unavailable'));assert.ok(!out.includes('PRIVATE_CANARY'));assert.ok(!out.includes('The invented share'));}
 assert.ok(h.view({kind:'ok',report:proposalReport()},{runId:proposalId(99),decisionId:proposalId(2)}).includes('Proposal unavailable'));
 const r=proposalReport(),p=JSON.parse(r.capture.proposalJson);p.snapshot.claims[0].assertion='<script>PRIVATE_CANARY</script>';
 const {encodeProposalCapture}=createRequire(import.meta.url)('../src/server/proposal-capture.ts');Object.assign(r.capture,encodeProposalCapture(p));
 const html=h.view({kind:'ok',report:r});assert.ok(html.includes('&lt;script&gt;PRIVATE_CANARY&lt;/script&gt;'));assert.ok(!html.includes('<script>PRIVATE_CANARY'));
});
test('actual withheld proposal pages retain exact selected GET retry and same-run return without record details',async()=>{
 for(const kind of ['unconfigured','unavailable','not_found','capture_missing','changed']){
  const h=harness('development',async()=>({kind})),html=await h.render(proposalScope());
  const links=[...html.matchAll(/href="([^"]+)"/g)].map(x=>x[1].replaceAll('&amp;','&'));
  const retry=links.find(x=>x.startsWith('/editorial-preview/held/proposal?'));assert.ok(retry,kind);
  assert.deepEqual(Object.fromEntries(new URL(retry,'https://example.invalid').searchParams),proposalScope());
  const back=links.find(x=>x.startsWith('/editorial-preview/held?'));assert.ok(back,kind);assert.deepEqual(Object.fromEntries(new URL(back,'https://example.invalid').searchParams),{runId:proposalId(1)});
  assert.equal(h.calls.length,1);assert.ok(!html.includes('The invented share'));assert.ok(!html.includes(proposalId(8)));assert.ok(!html.includes('Affected page'));assert.ok(!html.includes('<button'));assert.ok(!html.includes('<form'));
 }
});
test('withheld navigation validates only the selection and never trusts corrupt or foreign report scope',()=>{
 const h=harness();for(const bad of [null,{},[],{...proposalScope(),sql:'PRIVATE_CANARY'},{...proposalScope(),runId:'PRIVATE_CANARY'}]){
  const html=h.view({kind:'unavailable'},bad);assert.ok(!html.includes('PRIVATE_CANARY'));assert.ok(!html.includes('/held/proposal?'));assert.ok(!html.includes('/held?'));
 }
 assert.ok(!h.view({kind:'invalid_scope'},proposalScope()).includes('/held?'));
 const report=proposalReport();report.requested.runId=proposalId(99);const html=h.view({kind:'ok',report},proposalScope());
 assert.ok(html.includes('Proposal unavailable'));assert.ok(html.includes('/held?runId='+proposalId(1)));assert.ok(!html.includes(proposalId(99)));assert.ok(!html.includes('The invented share'));
});
