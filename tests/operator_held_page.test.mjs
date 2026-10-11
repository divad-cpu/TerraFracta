import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {canonicalHeldDecisionScope,createHeldDecisionsReader,readHeldDecisions} from '../src/server/operator-held-decisions-reader.ts';
import {canonicalOperatorAuditChoice,canonicalOperatorAuditRunCursor} from '../src/server/operator-audit-choices-reader.ts';
import {choices,choiceId} from './helpers/operator_audit_choices_fixture.mjs';
import {heldId,heldScope,heldReport,decisionRow,bytes} from './helpers/operator_held_fixture.mjs';
const pageSource=new URL('../app/editorial-preview/held/page.tsx',import.meta.url);
function harness(mode='development',read=readHeldDecisions){
 const marker=new Error('NEXT_NOT_FOUND'),calls=[],modules=new Map();
 function load(source){if(modules.has(source.href))return modules.get(source.href);const exports={},native=createRequire(source);modules.set(source.href,exports);
  const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports','process',compiled)(name=>{
   if(name==='next/navigation')return {unstable_rethrow:native(name).unstable_rethrow,notFound(){throw marker;}};
   if(source.href===pageSource.href&&name.endsWith('operator-held-decisions-reader.ts'))return {canonicalHeldDecisionScope,readHeldDecisions:async s=>{calls.push(s);return read(s);}};
   if(name.startsWith('.')){const candidate=new URL(name.endsWith('.tsx')?name:name+'.tsx',source);if(existsSync(candidate))return load(candidate);}
   return native(name);
  },exports,{env:{NODE_ENV:mode}});return exports;
 }
 const module=load(pageSource),view=load(new URL('../src/operator-held-decisions-view.tsx',import.meta.url)).HeldDecisionsView;
 return {marker,calls,module,page:module.default,render:async q=>renderToStaticMarkup(await module.default({searchParams:Promise.resolve(q)})),
  view:(decision,selection)=>renderToStaticMarkup(createElement(view,{decision,selection})),
  choices:report=>renderToStaticMarkup(createElement(load(new URL('../src/operator-audit-choices-view.tsx',import.meta.url)).OperatorAuditChoicesView,{decision:{kind:'ok',report}}))};
}
test('actual recorded choice link opens strict held page from selected run without guessing an issue',async()=>{
 const report=choices(choiceId(1)),s={runId:choiceId(1),cursor:null},actual=heldReport(s),h=harness('development',createHeldDecisionsReader(async selected=>{assert.deepEqual(selected,s);return bytes(actual);},undefined,()=>Promise.resolve()));
 const selected=h.choices(report),link=[...selected.matchAll(/href="([^"]+)"/g)].find(x=>x[1].startsWith('/editorial-preview/held?'))[1].replaceAll('&amp;','&'),url=new URL(link,'https://example.invalid');
 assert.deepEqual(Object.fromEntries(url.searchParams),{runId:choiceId(1)});const html=await h.render(Object.fromEntries(url.searchParams));
 assert.ok(html.includes('<h1>Held decisions</h1>'));assert.ok(html.includes('Recorded holds'));assert.ok(html.includes('material conflict'));assert.ok(html.includes('Recorded false'));
 assert.ok(html.includes('Proposal details are read separately'));assert.ok(!html.includes('Inspect recorded audit'));assert.ok(!html.includes('PRIVATE_CANARY'));assert.equal(h.calls.length,1);
 const back=[...html.matchAll(/href="([^"]+)"/g)].find(x=>x[1].startsWith('/editorial-preview/audit/select?'))[1];
 assert.deepEqual(Object.fromEntries(new URL(back,'https://example.invalid').searchParams),{runId:choiceId(1)});
 const restored=h.choices(choices(new URL(back,'https://example.invalid').searchParams.get('runId')));
 assert.ok(restored.includes(`name="runId" value="${choiceId(1)}"`));assert.ok(restored.includes('Inspect recorded audit'));
});
test('actual older held link passes exact tuple and renders last5 without approval controls',async()=>{
 const all=Array.from({length:25},(_,i)=>decisionRow(39-i)),cursor={decidedAt:all[19].decidedAt,decisionId:all[19].decisionId},seen=[];
 const read=createHeldDecisionsReader(async s=>{seen.push(s);const r=heldReport(s);r.decisions=s.cursor===null?all.slice(0,20):all.slice(20);r.more=s.cursor===null;r.nextCursor=r.more?cursor:null;return bytes(r);},undefined,()=>Promise.resolve()),h=harness('development',read);
 const first=await h.render({runId:heldId(1)}),href=[...first.matchAll(/href="([^"]+)"/g)].find(x=>x[1].includes('beforeDecisionId'))[1].replaceAll('&amp;','&'),url=new URL(href,'https://example.invalid');
 const second=await h.render(Object.fromEntries(url.searchParams));assert.deepEqual(seen,[heldScope(),heldScope(cursor)]);for(const row of all.slice(20))assert.ok(second.includes(row.decisionId));for(const row of all.slice(0,20))assert.ok(!second.includes('<code>'+row.decisionId+'</code>'));
 assert.ok(!second.includes('Older held decisions'));assert.ok(second.includes('Start a fresh held-decision read'));assert.ok(!second.includes('method="post"'));assert.ok(second.includes('Apply reason filter'));
});
test('held page production and unknown modes refuse before props; malformed queries never read or echo',async()=>{
 for(const mode of ['production','test','']){const h=harness(mode);await assert.rejects(h.page(new Proxy({}, {get(){assert.fail('props inspected');}})),e=>e===h.marker);assert.equal(h.calls.length,0);assert.equal(h.module.dynamic,'force-dynamic');}
 const h=harness();for(const q of [{},null,[],{runId:['PRIVATE_CANARY']},{runId:heldId(1),beforeDecisionId:heldId(9)},
  {runId:heldId(1),beforeDecidedAt:'2026-10-05T09:00:00.000001Z'}, {runId:heldId(1),sql:'PRIVATE_CANARY'},{runId:'PRIVATE_CANARY'}]){
  const html=await h.render(q);assert.ok(html.includes('The selection is invalid'));assert.ok(!html.includes('PRIVATE_CANARY'));}
 const html=renderToStaticMarkup(await h.page({searchParams:Promise.reject(new Error('PRIVATE_CANARY'))}));assert.ok(html.includes('The selection is invalid'));assert.equal(h.calls.length,0);
});
test('held direct presenter withholds malformed or mismatched metadata and makes unknown fields explicit',()=>{
 const h=harness(),r=heldReport();r.decisions[0].reasonCodes=[];r.decisions[0].undisclosedReasonCount=2;r.decisions[0].undisclosedCheckCount=1;
 const html=h.view({kind:'ok',report:r},heldScope());assert.ok(html.includes('2 reason entries are not disclosed'));assert.ok(html.includes('1 other check fields are not disclosed'));assert.ok(html.includes('Not recorded'));assert.ok(html.includes('does not mean there is no conflict'));
 for(const mutate of [r=>r.private='PRIVATE_CANARY',r=>r.decisions[0].reasonCodes=['PRIVATE_CANARY'],r=>r.decisions[0].checks.raw='PRIVATE_CANARY']){const r=heldReport();mutate(r);const out=h.view({kind:'ok',report:r});assert.ok(out.includes('Held decisions unavailable'));assert.ok(!out.includes('PRIVATE_CANARY'));assert.ok(!out.includes('Recorded holds'));}
 assert.ok(h.view({kind:'ok',report:heldReport()}, {runId:heldId(99),cursor:null}).includes('Held decisions unavailable'));
});
test('ordinary held outcomes disclose no prior records and technical reader failures use no body detail',async()=>{
 const h=harness();for(const [kind,label] of [['unconfigured','not configured'],['unavailable','not an empty or healthy result'],['not_found','No matching recorded run'],['changed','Held decision list changed']]){const html=h.view({kind});assert.ok(html.includes(label));assert.ok(!html.includes('Recorded holds'));assert.ok(!html.includes(heldId(9)));}
 const empty=heldReport();empty.decisions=[];assert.ok(h.view({kind:'ok',report:empty}).includes('No held decisions returned'));
 const html=await harness('development',async()=>{throw new Error('PRIVATE_CANARY');}).render({runId:heldId(1)});assert.ok(html.includes('Held decisions unavailable'));assert.ok(!html.includes('PRIVATE_CANARY'));
});
test('actual withheld held-list pages retain the selected run and reset the continuation on fresh GET navigation',async()=>{
 const cursor={decidedAt:'2026-10-05T09:00:00.000001Z',decisionId:heldId(9)};
 for(const kind of ['unconfigured','unavailable','not_found','changed']){
  const h=harness('development',async()=>({kind})),html=await h.render({runId:heldId(1),beforeDecidedAt:cursor.decidedAt,beforeDecisionId:cursor.decisionId});
  const links=[...html.matchAll(/href="([^"]+)"/g)].map(x=>x[1].replaceAll('&amp;','&'));
  const fresh=links.find(x=>x.startsWith('/editorial-preview/held?'));assert.ok(fresh,kind);assert.deepEqual(Object.fromEntries(new URL(fresh,'https://example.invalid').searchParams),{runId:heldId(1)});
  const back=links.find(x=>x.startsWith('/editorial-preview/audit/select?'));assert.ok(back,kind);assert.deepEqual(Object.fromEntries(new URL(back,'https://example.invalid').searchParams),{runId:heldId(1)});
  assert.equal(h.calls.length,1);assert.ok(!html.includes('Recorded holds'));assert.ok(!html.includes(heldId(9)));assert.ok(!html.includes('Older held decisions'));assert.ok(!html.includes('<button'));assert.ok(!html.includes('<form'));
 }
});
test('withheld list navigation rejects invalid selections and never borrows a foreign report or old cursor',()=>{
 const h=harness();for(const bad of [null,{},[],{...heldScope(),sql:'PRIVATE_CANARY'},{...heldScope(),runId:'PRIVATE_CANARY'}]){
  const html=h.view({kind:'unavailable'},bad);assert.ok(!html.includes('PRIVATE_CANARY'));assert.ok(!html.includes('/held?'));assert.ok(!html.includes('/audit/select?'));
 }
 assert.ok(!h.view({kind:'invalid_scope'},heldScope()).includes('/audit/select?'));
 const r=heldReport(),html=h.view({kind:'ok',report:r},{runId:heldId(99),cursor:null});assert.ok(html.includes('Held decisions unavailable'));assert.ok(html.includes('/held?runId='+heldId(99)));assert.ok(!html.includes(heldId(1)));assert.ok(!html.includes('Recorded holds'));
});
