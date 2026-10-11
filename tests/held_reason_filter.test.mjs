import assert from 'node:assert/strict';import test from 'node:test';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {canonicalHeldDecisionScope} from '../src/server/operator-held-decisions-reader.ts';
import {heldReport,heldScope,heldId,decisionRow} from './helpers/operator_held_fixture.mjs';

const source=new URL('../app/editorial-preview/held/page.tsx',import.meta.url);
const View=loadTsx(new URL('../src/operator-held-decisions-view.tsx',import.meta.url)).HeldDecisionsView;
function harness(read=async scope=>({kind:'ok',report:heldReport(scope)}),mode='development'){
  const calls=[],marker=Error('NEXT_NOT_FOUND');const page=loadTsx(source,name=>name==='next/navigation'?{notFound(){throw marker;}}:
    name.endsWith('operator-held-decisions-reader.ts')?{canonicalHeldDecisionScope,readHeldDecisions:async scope=>{calls.push(scope);return read(scope);}}:undefined,{env:{NODE_ENV:mode}}).default;
  return {page,calls,marker,render:async query=>renderToStaticMarkup(await page({searchParams:Promise.resolve(query)}))};
}
const render=(decision,selection,reason)=>renderToStaticMarkup(createElement(View,{decision,selection,reason}));
const links=html=>[...html.matchAll(/href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>({href:m[1].replaceAll('&amp;','&'),text:m[2]}));
const query=(html,text)=>Object.fromEntries(new URL(links(html).find(x=>x.text===text).href,'https://example.invalid').searchParams);
function report(scope=heldScope()){const r=heldReport(scope);r.decisions[1].reasonCodes=['source_not_approved'];return r;}
test('reason filtering makes one unchanged private read, exposes matching details and keeps only GET controls',async()=>{
  const h=harness(async scope=>({kind:'ok',report:report(scope)})),html=await h.render({runId:heldId(1),reason:'material_conflict'});
  assert.deepEqual(h.calls,[heldScope()]);assert.ok(html.includes('Showing 1 of 2 held decisions on this checked page.'));
  assert.ok(html.includes(heldId(9)));assert.ok(!html.includes('<code>'+heldId(8)+'</code>'));
  for(const text of ['method="get"','Recorded reason on this page','filters only the checked page','Filtering does not clear a hold','historical held decisions','may be absent'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('method="post"'));assert.ok(html.includes('Apply reason filter'));
});
test('malformed reason selectors refuse before the private read and never echo; production refuses before props',async()=>{
  const h=harness();for(const reason of ['PRIVATE_CANARY','toString',['material_conflict'],null]){
    const html=await h.render({runId:heldId(1),reason});assert.ok(html.includes('selection is invalid'));assert.ok(!html.includes('PRIVATE_CANARY'));assert.ok(!html.includes('Recorded holds'));
  }assert.equal(h.calls.length,0);
  for(const mode of ['production','test','']){const p=harness(undefined,mode);await assert.rejects(p.page(new Proxy({},{get(){assert.fail('props inspected');}})),e=>e===p.marker);assert.equal(p.calls.length,0);}
});
test('older page and fresh read preserve the reason; clearing retains the current exact tuple',async()=>{
  const r=report();r.decisions=Array.from({length:20},(_,i)=>decisionRow(40-i));r.more=true;r.nextCursor={decidedAt:r.decisions[19].decidedAt,decisionId:r.decisions[19].decisionId};
  const first=render({kind:'ok',report:r},r.requested,'source_not_approved');
  assert.ok(first.includes('No matching disclosed reason on this page'));assert.ok(first.includes('More older recorded decisions are available to inspect.'));assert.ok(!first.includes('This page shows 20 held decisions.'));
  const next=query(first,'Older held decisions');assert.deepEqual(next,{runId:heldId(1),beforeDecidedAt:r.nextCursor.decidedAt,beforeDecisionId:r.nextCursor.decisionId,reason:'source_not_approved'});
  const h=harness(async scope=>{const second=report(scope);second.decisions=[decisionRow(20)];second.decisions[0].reasonCodes=['source_not_approved'];return {kind:'ok',report:second};});
  const second=await h.render(next);assert.deepEqual(h.calls,[heldScope(r.nextCursor)]);assert.ok(second.includes('Showing 1 of 1 held decisions'));
  assert.deepEqual(query(second,'Clear this page’s reason filter'),{runId:heldId(1),beforeDecidedAt:r.nextCursor.decidedAt,beforeDecisionId:r.nextCursor.decisionId});
  assert.deepEqual(query(second,'Start a fresh held-decision read'),{runId:heldId(1),reason:'source_not_approved'});
  assert.ok(second.includes('name="beforeDecidedAt" value="'+r.nextCursor.decidedAt+'"'));assert.ok(second.includes('name="beforeDecisionId" value="'+r.nextCursor.decisionId+'"'));
});
test('withheld reason entries make zero matches explicitly incomplete and never become an absence or success claim',()=>{
  const r=report();r.decisions.forEach(d=>{d.reasonCodes=[];d.undisclosedReasonCount=1;});const html=render({kind:'ok',report:r},heldScope(),'material_conflict');
  for(const text of ['Showing 0 of 2 held decisions','Some reason entries are withheld','matching decisions may be omitted','No displayed match does not establish that the reason is absent','Other pages or withheld reason entries may contain matches','not successful processing or successful publication'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('<code>'+heldId(9)+'</code>'));
  const all=render({kind:'ok',report:r},heldScope(),'');assert.ok(all.includes('Showing 2 of 2 held decisions'));assert.ok(all.includes('1 reason entries are not disclosed'));
});
test('a checked empty page remains distinct from nonmatching disclosed reasons',()=>{
  const r=report();r.decisions=[];const html=render({kind:'ok',report:r},heldScope(),'material_conflict');
  assert.ok(html.includes('No held decisions returned'));assert.ok(!html.includes('No matching disclosed reason on this page'));
  assert.ok(html.includes('does not establish successful processing or successful publication'));
});
test('invalid direct filters and corrupt or foreign reports withhold details; failed recovery retains only checked selection and reason',()=>{
  for(const reason of ['PRIVATE_CANARY',['material_conflict']]){const html=render({kind:'ok',report:report()},heldScope(),reason);assert.ok(html.includes('selection is invalid'));assert.ok(!html.includes('PRIVATE_CANARY'));assert.ok(!html.includes('Recorded holds'));}
  const bad=report();bad.extra='PRIVATE_CANARY';for(const [r,s] of [[bad,heldScope()],[report(),heldScope({decidedAt:'2026-10-05T09:00:00.000001Z',decisionId:heldId(99)})]]){
    const html=render({kind:'ok',report:r},s,'material_conflict');assert.ok(html.includes('Held decisions unavailable'));assert.ok(!html.includes('Recorded holds'));assert.ok(!html.includes('PRIVATE_CANARY'));
  }
  for(const kind of ['unconfigured','unavailable','not_found','changed']){
    const html=render({kind},heldScope({decidedAt:'2026-10-05T09:00:00.000001Z',decisionId:heldId(99)}),'material_conflict');
    assert.deepEqual(query(html,'Start a fresh held-decision read'),{runId:heldId(1),reason:'material_conflict'});assert.ok(!html.includes('<form'));assert.ok(!html.includes('Recorded holds'));assert.ok(!html.includes(heldId(99)));
  }
});
test('a recorded checks-passed reason filter remains a historical hold without approval or publication qualification',async()=>{
  const h=harness(async scope=>{const r=report(scope);r.decisions[0].reasonCodes=['qualified_checks_passed'];return {kind:'ok',report:r};});
  const html=await h.render({runId:heldId(1),reason:'qualified_checks_passed'});assert.ok(html.includes('Showing 1 of 2 held decisions'));
  for(const text of ['historical held decisions','does not establish current source health or public eligibility','Filtering does not clear a hold','no approval, editing, collection or publication control'])assert.ok(html.includes(text),text);
});
