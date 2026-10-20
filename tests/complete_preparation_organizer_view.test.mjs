import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {responsibilityDraftHarness} from './helpers/responsibility_draft_harness.mjs';
import {completeSample} from './helpers/complete_preparation_fixture.mjs';
const suffix=(h,end)=>h.nodes().find(n=>n.props.id?.endsWith(end))??assert.fail(end);
const button=(h,label)=>h.nodes().find(n=>n.type==='button'&&n.props.children===label)??assert.fail(label);
const click=(h,label)=>button(h,label).props.onClick();
const edit=(h,name,value)=>suffix(h,'-'+name).props.onChange({currentTarget:{value}});
const inspect=h=>click(h,'Inspect preparations together');
const html=h=>renderToStaticMarkup(h.render());
const forbidden=new Proxy({},{get(){assert.fail('Retired event was observed');}});
function ready(t){t.mock.method(globalThis,'fetch',()=>assert.fail('No transport'));const p=completeSample(),h=responsibilityDraftHarness(p.context,undefined,{url:new URL('../src/complete-preparation-organizer-view.tsx',import.meta.url),name:'CompletePreparationOrganizerView'});h.mount();t.after(()=>h.unmount());return{...p,h};}
function fill(p){edit(p.h,'bundle',p.bundleJson);edit(p.h,'milestones',p.milestoneJson);inspect(p.h);}

test('overview starts unadmitted and introduces no File form copy output or request port',t=>{
 const p=completeSample(),h=responsibilityDraftHarness(p.context,undefined,{url:new URL('../src/complete-preparation-organizer-view.tsx',import.meta.url),name:'CompletePreparationOrganizerView'});
 assert.equal(button(h,'Inspect preparations together').props.disabled,true);h.mount();
 assert.equal(suffix(h,'-bundle').props.maxLength,196608);assert.equal(suffix(h,'-milestones').props.maxLength,16384);
 assert.doesNotMatch(html(h),/<form|type="file"|type="submit"|readonly|download=|href="https:/);h.unmount();
});
test('explicit inspection reads both preparations without changing exact input bytes',t=>{const p=ready(t);fill(p);assert.match(html(p.h),/Invented documented future target/);assert.match(html(p.h),/Invented uncertain evaluated finding/);assert.equal(suffix(p.h,'-bundle').props.value,p.bundleJson);assert.equal(suffix(p.h,'-milestones').props.value,p.milestoneJson);});
test('failed inspection withholds all prior output and retains both exact editable copies',t=>{const p=ready(t);fill(p);edit(p.h,'milestones','PRIVATE_INVALID');inspect(p.h);const text=html(p.h);assert.match(text,/Preparation overview held/);assert.doesNotMatch(text,/<section aria-label="Preparations with planned milestones"/);assert.equal(suffix(p.h,'-bundle').props.value,p.bundleJson);assert.equal(suffix(p.h,'-milestones').props.value,'PRIVATE_INVALID');});
test('ordinary edits retire visible output before deferred state merges without losing independent slot edits',t=>{const p=ready(t);fill(p);p.h.pauseMerges();edit(p.h,'bundle',p.bundleJson);assert.doesNotMatch(html(p.h),/aria-label="Preparations with planned milestones"/);edit(p.h,'milestones',p.milestoneJson);p.h.flushMerges();assert.equal(suffix(p.h,'-bundle').props.value,p.bundleJson);assert.equal(suffix(p.h,'-milestones').props.value,p.milestoneJson);inspect(p.h);assert.match(html(p.h),/aria-label="Preparations with planned milestones"/);});
test('newer same-control input wins reentrant getters while independent controls still merge',t=>{const p=ready(t),old=suffix(p.h,'-milestones').props.onChange;old({get currentTarget(){edit(p.h,'milestones',p.milestoneJson);return{get value(){assert.fail('Retired value getter');}};}});assert.equal(suffix(p.h,'-milestones').props.value,p.milestoneJson);edit(p.h,'bundle',p.bundleJson);inspect(p.h);assert.match(html(p.h),/Invented documented future target/);});
test('Clear and context retirement block retained input callbacks before event observation',t=>{
 for(const action of ['clear','context','invalid','unmount']){const p=ready(t);fill(p);const old=suffix(p.h,'-bundle').props.onChange,oldInspect=button(p.h,'Inspect preparations together').props.onClick;
 if(action==='clear')click(p.h,'Clear preparation overview');
 if(action==='context'){const c=structuredClone(p.context);c.binding.captureId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';p.h.render(c);}
 if(action==='invalid')p.h.render({});if(action==='unmount')p.h.unmount();
 old(forbidden);oldInspect();assert.doesNotMatch(html(p.h),/aria-label="Preparations with planned milestones"/);
 }
});
test('throwing event observations preserve existing copied inputs and return opaque held state',t=>{const p=ready(t);fill(p);suffix(p.h,'-bundle').props.onChange({get currentTarget(){throw Error('PRIVATE_EVENT_FAILURE');}});assert.equal(suffix(p.h,'-bundle').props.value,p.bundleJson);assert.equal(suffix(p.h,'-milestones').props.value,p.milestoneJson);assert.match(html(p.h),/Preparation overview held/);assert.doesNotMatch(html(p.h),/PRIVATE_EVENT_FAILURE/);});
