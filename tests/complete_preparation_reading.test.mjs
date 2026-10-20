import assert from 'node:assert/strict';
import test from 'node:test';
import {completePreparationReading} from '../src/complete-preparation-reading.ts';
import {plannedMilestoneDraftJson} from '../src/planned-milestone-draft.ts';
import {evaluationPreparationBundleJson} from '../src/evaluation-preparation-bundle.ts';
import {completeSample} from './helpers/complete_preparation_fixture.mjs';

test('same-comparison overview reuses original seven-part bundle bytes and preserves independent plan fields',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No source request'));
 const p=completeSample(),before=structuredClone(p),r=completePreparationReading(p.bundleJson,p.milestoneJson,p.context);
 assert.ok(r);assert.equal(evaluationPreparationBundleJson(r.bundle,r.context),p.bundleJson);
 assert.equal(r.bundle.preparations.preparationPacket,p.packetJson);assert.equal(r.bundle.preparations.evaluation,p.evaluationJson);
 assert.equal(r.milestones.status,'supplied');assert.deepEqual(p,before);
 assert.equal(r.milestones.entries[0].statement.number,2);
 assert.deepEqual(r.milestones.entries[0].fields.map(f=>[f.key,f.value,f.precision]),[
 ['description','Invented documented future target',null],['targetDate','2028 (year only)','year'],['institution',null,null],['reportedDate','2026-09 (month only)','month']]);
});
test('both missing is refused while missing bundle missing plans and supplied empty plans stay distinct',()=>{
 const p=completeSample();assert.equal(completePreparationReading('','',p.context),null);
 assert.equal(completePreparationReading('',p.milestoneJson,p.context).bundle,null);
 assert.equal(completePreparationReading(p.bundleJson,'',p.context).milestones.status,'not_supplied');
 p.milestones.entries=[];assert.equal(completePreparationReading(p.bundleJson,plannedMilestoneDraftJson(p.milestones,p.context),p.context).milestones.status,'empty');
});
test('any malformed over-budget noncanonical or wrong-type copy refuses all combined details',()=>{
 const p=completeSample();
 for(const name of ['bundleJson','milestoneJson'])for(const raw of ['PRIVATE_BROKEN',' '.repeat(196609),p[name]+'\n','\ufeff'+p[name],JSON.stringify(JSON.parse(p[name])),null,{},true]){
  const q={...p,[name]:raw};assert.equal(completePreparationReading(q.bundleJson,q.milestoneJson,p.context),null);
 }
 assert.equal(completePreparationReading(p.milestoneJson,p.bundleJson,p.context),null);
});
test('foreign comparison in either independent child or context refuses the whole overview',()=>{
 const p=completeSample(),foreign=structuredClone(p.context);foreign.binding.captureId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 for(const name of ['bundleJson','milestoneJson']){
  const q={...p},v=JSON.parse(q[name]);v.binding.captureId=foreign.binding.captureId;q[name]=JSON.stringify(v,null,2);
  assert.equal(completePreparationReading(q.bundleJson,q.milestoneJson,p.context),null);
 }
 assert.equal(completePreparationReading(p.bundleJson,p.milestoneJson,foreign),null);
});
test('all source date precisions remain explicit without clocks or inferred completion',()=>{
 const p=completeSample();for(const date of [{precision:'day',value:'2028-02-29'},{precision:'month',value:'2028-02'},{precision:'year',value:'2028'},{precision:'period',label:'After a source-described consultation'}]){
  p.milestones.entries[0].fields.targetDate.date=date;
  const r=completePreparationReading('',plannedMilestoneDraftJson(p.milestones,p.context),p.context),field=r.milestones.entries[0].fields.find(f=>f.key==='targetDate');
  assert.equal(field.precision,date.precision);assert.equal(field.value,date.precision==='period'?`${date.label} (stated period)`:`${date.value} (${date.precision==='day'?'exact day':date.precision+' only'})`);
 }
 p.milestones.entries[0].fields.targetDate=null;
 assert.equal(completePreparationReading('',plannedMilestoneDraftJson(p.milestones,p.context),p.context).milestones.entries[0].fields.find(f=>f.key==='targetDate').value,null);
});
test('original occurrence ordering roles field selection order and backlinks remain separate',()=>{
 const p=completeSample(),r=completePreparationReading(p.bundleJson,p.milestoneJson,p.context),refs=r.milestones.references;
 assert.deepEqual(refs.map(x=>[x.statementNumber,x.referenceNumber]),[[1,1],[2,1],[2,2]]);
 assert.equal(refs[2].originalRelation,'Points to a conflict');
 assert.equal(refs[2].originalHref,`#proposal-proposed-reference-${p.context.claims[1].id}-2`);
 assert.deepEqual(r.milestones.entries[0].fields[0].references,[refs[2].key,refs[0].key]);
 assert.deepEqual(refs[2].selections.map(s=>s.field),['description','reportedDate']);
});
