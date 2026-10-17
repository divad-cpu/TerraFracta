import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {heldReport,heldScope,heldId,decisionRow,bytes} from './helpers/operator_held_fixture.mjs';
import {heldDecisionsReportSchema} from '../src/operator-held-decisions.ts';
import {heldBrowseSelection,heldBrowseHref} from '../src/operator-held-browse.ts';
import {proposalBrowseSelection,capturedProposalHref} from '../src/operator-proposal-navigation.ts';
import {canonicalHeldDecisionScope,createHeldDecisionsReader} from '../src/server/operator-held-decisions-reader.ts';
const View=loadTsx(new URL('../src/operator-held-decisions-view.tsx',import.meta.url)).HeldDecisionsView;
const oldCursor={decidedAt:'2026-10-05T09:02:00.000001Z',decisionId:heldId(99)};
const runReturn={runId:heldId(1),cursor:{createdAt:'2026-10-05T08:30:00.000001Z',runId:heldId(98)},state:'partial',issueQuery:'housing costs'};
const links=html=>[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>({href:m[1].replaceAll('&amp;','&'),text:m[2]}));
const query=href=>Object.fromEntries(new URL(href,'https://example.invalid').searchParams);
const link=(html,text)=>links(html).find(x=>x.text===text)?.href??assert.fail('Missing '+text);
const rows=html=>/<ol[^>]*aria-label="Recorded held decisions"[^>]*>([\s\S]*?)<\/ol>/.exec(html)?.[1]??'';
function sample(cursor=oldCursor,count=2){const r=heldReport(heldScope(cursor));r.decisions=Array.from({length:count},(_,i)=>({...decisionRow(80-i),sourceKey:`invented:source-${String(i).padStart(2,'0')}`,registrationId:heldId(200+i),sourceVersionId:heldId(300+i),qualificationId:heldId(400+i),reasonCodes:i%2?['source_not_approved']:['material_conflict','material_conflict']}));return heldDecisionsReportSchema.parse(r);}
const render=(props={})=>renderToStaticMarkup(View({decision:{kind:'ok',report:sample()},selection:heldScope(oldCursor),runReturn,...props}));
test('held reference lookup intersects reasons on the checked page while disclosed counts stay before both filters',()=>{
 const html=render({referenceQuery:'source-01',reason:'source_not_approved'});assert.ok(html.includes('Showing 1 of 2 held decisions'));assert.ok(rows(html).includes('invented:source-01'));assert.ok(!rows(html).includes('invented:source-00'));assert.ok(html.includes('material conflict: 1'));assert.ok(html.includes('source not approved: 1'));assert.ok(html.includes('before both page filters'));assert.ok(html.includes('name="heldQ"'));
 const no=render({referenceQuery:'source-01',reason:'material_conflict'});assert.equal(rows(no),'');assert.ok(no.includes('No matching held reference and disclosed reason on this page'));assert.ok(no.includes('not successful processing or successful publication'));
});
test('checked metadata searches keep twenty-row order same-row word matching and exact IDs without undisclosed checks',()=>{
 const r=sample(oldCursor,20);for(const [q,n]of [['source-1',10],[`source-19 ${heldId(319)}`,1],[heldId(219),0],[heldId(419),1],[heldId(61),1],[`source-18 ${heldId(319)}`,0],['suspended',0],['revision',0],['no_material_conflict',0]]){
  const html=render({decision:{kind:'ok',report:r},referenceQuery:q});assert.ok(html.includes(`Showing ${n} of 20`),q);
 }
 const body=rows(render({decision:{kind:'ok',report:r},referenceQuery:'source-1'}));for(let i=10;i<19;i++)assert.ok(body.indexOf(`invented:source-${i}`)<body.indexOf(`invented:source-${i+1}`));
 const empty=sample();empty.decisions=[];const html=render({decision:{kind:'ok',report:empty},referenceQuery:'source'});assert.ok(html.includes('No held decisions returned'));assert.equal(rows(html),'');
});
test('held lookup clear reason links pagination and proposal returns preserve independent cursors and issue lookup',()=>{
 const r=sample();r.decisions=Array.from({length:20},(_,i)=>({...decisionRow(80-i),sourceKey:'invented:source',reasonCodes:['material_conflict']}));r.more=true;r.nextCursor={decidedAt:r.decisions.at(-1).decidedAt,decisionId:r.decisions.at(-1).decisionId};heldDecisionsReportSchema.parse(r);
 const html=render({decision:{kind:'ok',report:r},referenceQuery:'source',reason:'material_conflict'});
 for(const label of ['Clear this page’s reason filter','Older held decisions','Start a fresh held-decision read','material conflict: 20','Link to this recorded hold']){
  const q=query(link(html,label)),parsed=heldBrowseSelection(q);assert.ok(parsed,label);assert.equal(parsed.referenceQuery,'source');assert.deepEqual(parsed.runReturn,runReturn);assert.equal(parsed.scope.runId,heldId(1));
 }
 const cleared=heldBrowseSelection(query(link(html,'Clear held-reference search')));assert.ok(cleared);assert.equal(cleared.referenceQuery,undefined);assert.equal(cleared.reason,'material_conflict');assert.deepEqual(cleared.scope,r.requested);
 const p=query(link(html,'Inspect captured proposal')),selected=proposalBrowseSelection(p);assert.ok(selected);assert.equal(selected.held.referenceQuery,'source');assert.deepEqual(selected.held.runReturn,runReturn);assert.deepEqual(selected.scope,{runId:heldId(1),decisionId:heldId(80)});assert.equal(query(capturedProposalHref(selected.scope,selected.held)).heldQ,'source');assert.equal(query(heldBrowseHref(selected.held.scope,selected.held.reason,selected.held.runReturn,selected.held.referenceQuery)).heldQ,'source');
 const back=query(link(html,'Back to selected recorded-run page'));assert.equal(back.issueQ,'housing costs');assert.ok(!Object.hasOwn(back,'heldQ'));
});
test('native held page owns query once refuses malformed values before provider and withholds replaced detail without widening scope',async()=>{
 const calls=[];let changed=false;const reader=createHeldDecisionsReader(async(s,signal)=>{calls.push({scope:structuredClone(s),signal});return bytes(changed?{schemaVersion:1,status:'changed',requested:s}:sample(s.cursor));},()=>0,()=>assert.fail('diagnostic'));
 const page=loadTsx(new URL('../app/editorial-preview/held/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){assert.fail('production');},unstable_rethrow(){}}:name.endsWith('operator-held-decisions-reader.ts')?{canonicalHeldDecisionScope,readHeldDecisions:reader}:undefined).default;
 const visit=async q=>renderToStaticMarkup(await page({searchParams:Promise.resolve(q)}));let observed=0;const q={runId:heldId(1)};Object.defineProperty(q,'heldQ',{enumerable:true,get(){observed++;return observed===1?'ＳＯＵＲＣＥ-01':'PRIVATE_CHANGED_CANARY';}});
 const first=await visit(q);assert.equal(observed,1);assert.ok(first.includes('Showing 1 of 2'));assert.equal(calls.length,1);assert.deepEqual(calls[0].scope,heldScope());assert.ok(!first.includes('PRIVATE_CHANGED_CANARY'));
 for(const value of [null,['source'],undefined,0,'\0','x'.repeat(81),'\ufdfa'.repeat(5)]){assert.ok((await visit({runId:heldId(1),heldQ:value})).includes('selection is invalid'));assert.equal(calls.length,1);}
 changed=true;const held=await visit({runId:heldId(1),beforeDecidedAt:oldCursor.decidedAt,beforeDecisionId:oldCursor.decisionId,heldQ:'source-01'});assert.equal(rows(held),'');assert.ok(held.includes('Held decision list changed'));assert.equal(query(link(held,'Start a fresh held-decision read')).heldQ,'source-01');assert.deepEqual(calls.map(x=>x.scope),[heldScope(),heldScope(oldCursor)]);assert.ok(calls.every(x=>x.signal.aborted));
 let accesses=0;const denied=render({referenceQuery:['source'],decision:{kind:'ok',get report(){accesses++;assert.fail('must not observe');}}});assert.equal(accesses,0);assert.ok(denied.includes('selection is invalid'));
});
test('legacy selectors remain exact and corrupt held or foreign envelopes reveal neither lookup nor new metadata',()=>{
 const legacy={runId:heldId(1),reason:'material_conflict'};assert.deepEqual(heldBrowseSelection(legacy),{scope:heldScope(),reason:'material_conflict'});assert.equal(heldBrowseHref(heldScope(),'material_conflict'),`/editorial-preview/held?runId=${heldId(1)}&reason=material_conflict`);
 for(const raw of [Object.assign(Object.create({heldQ:'PRIVATE'}),legacy),Object.defineProperty({...legacy},'heldQ',{value:'PRIVATE',enumerable:false})])assert.deepEqual(heldBrowseSelection(raw),{scope:heldScope(),reason:'material_conflict'});
 for(const props of [{decision:{kind:'ok',report:{...sample(),privateCanary:'PRIVATE'}}},{selection:heldScope()},...['invalid_scope','unconfigured','unavailable','not_found','changed'].map(kind=>({decision:{kind,report:sample()}}))]){const html=render({...props,referenceQuery:'source-01'});assert.equal(rows(html),'');assert.ok(!html.includes('name="heldQ"'));assert.ok(!html.includes('PRIVATE'));assert.ok(!html.includes('invented:source-01'));}
 const normalized=heldBrowseSelection({runId:heldId(1),heldQ:'  ＳＯＵＲＣＥ  '});assert.ok(normalized);assert.equal(normalized.referenceQuery,'SOURCE');assert.deepEqual(normalized.scope,heldScope());
});
