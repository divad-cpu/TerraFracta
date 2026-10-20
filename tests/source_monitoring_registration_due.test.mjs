import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {sourceMonitoringFilter} from '../src/source-monitoring-filter.ts';
import {sourceMonitoringSnapshot} from '../src/source-monitoring-snapshot.ts';
import {createInventedSourceMonitoringSnapshot} from '../app/editorial-preview/source-health/example.ts';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {sharedViewModule} from './helpers/shared_view_module.mjs';
const {SourceMonitoringView:View}=loadTsx(new URL('../src/source-monitoring-view.tsx',import.meta.url));
const mount=sharedViewModule(new URL('../src/source-monitoring-explorer.tsx',import.meta.url),'SourceMonitoringExplorer');
const render=(filter,input=createInventedSourceMonitoringSnapshot())=>renderToStaticMarkup(View({input,filter}));
const base={check:'',permission:''};
const select=(h,axis)=>h.nodes().find(n=>n.type==='select'&&n.props.id===`source-monitoring-${axis}-filter`)??assert.fail(axis);
const change=(h,axis,value)=>select(h,axis).props.onChange({currentTarget:{value}});

test('old strict two-field filter admission and exact output remain unchanged without optional defaults',()=>{
 for(const value of [base,{check:'failed',permission:'unresolved'}])assert.deepEqual(sourceMonitoringFilter(value),value);
 const value=sourceMonitoringFilter(base);assert.deepEqual(Object.keys(value),['check','permission']);
 for(const value of [{},{check:''},{permission:''},{...base,provider:'PRIVATE_FIELD'}])assert.equal(sourceMonitoringFilter(value),null);
});
test('registration and due selectors admit only their existing distinct finite observation values',()=>{
 for(const registration of ['','candidate','approved','suspended','retired'])assert.deepEqual(sourceMonitoringFilter({...base,registration}),{...base,registration});
 for(const due of ['','unknown','not_due','due'])assert.deepEqual(sourceMonitoringFilter({...base,due}),{...base,due});
 for(const value of [{...base,registration:'healthy'},{...base,due:'late'},{...base,registration:null},{...base,due:[]},{...base,registration:{toString(){assert.fail('No coercion');}}},{...base,get due(){throw Error('PRIVATE_VALUE');}}])assert.equal(sourceMonitoringFilter(value),null);
});
test('every registration and due observation selects exact rows without changing unfiltered totals',()=>{
 for(const [registration,count]of [['candidate',1],['approved',6],['suspended',1],['retired',0]]){
  const text=render({...base,registration});assert.match(text,new RegExp(`Showing ${count} of 8 source observations`));assert.match(text,/failed: 1\./);assert.match(text,/fetch denied: 1/);
 }
 for(const [due,count]of [['unknown',1],['not_due',1],['due',6]])assert.match(render({...base,due}),new RegExp(`Showing ${count} of 8 source observations`));
});
test('all four axes combine with AND and retain the original full-snapshot detail number',()=>{
 const text=render({check:'complete_unchanged',permission:'allowed',registration:'suspended',due:'due'});
 assert.match(text,/Showing 1 of 8/);assert.match(text,/id="source-monitoring-detail-5"/);assert.match(text,/href="#source-monitoring-detail-5"/);assert.doesNotMatch(text,/id="source-monitoring-detail-1"/);
 const unknown=render({check:'not_recorded',permission:'unresolved',registration:'candidate',due:'unknown'});
 assert.match(unknown,/Showing 1 of 8/);assert.match(unknown,/id="source-monitoring-detail-6"/);assert.match(unknown,/Due time not recorded/);
});
test('no match invalid selector and empty source snapshot remain distinct',()=>{
 const missing=render({...base,registration:'retired'});assert.match(missing,/No observations match/);assert.match(missing,/Showing 0 of 8/);assert.doesNotMatch(missing,/Check the display filters|<table/);
 const invalid=render({...base,due:'PRIVATE_BAD_DUE'});assert.match(invalid,/Check the display filters/);assert.doesNotMatch(invalid,/PRIVATE_BAD_DUE|Showing|<table/);
 const input=createInventedSourceMonitoringSnapshot();input.sources=[];assert.match(render({...base,due:'due'},input),/No source observations supplied/);
});
test('display selection changes no source observation timestamps coverage permission or registration',()=>{
 const input=createInventedSourceMonitoringSnapshot(),before=structuredClone(input),observed=sourceMonitoringSnapshot(input);
 render({...base,registration:'approved',due:'not_due'},input);
 assert.deepEqual(input,before);assert.deepEqual(sourceMonitoringSnapshot(input),observed);
 assert.match(render({...base,due:'not_due'},input),/2026-10-14T12:00:00.000000Z/);
});
test('native controls reuse exact existing registration and due labels and remain display-only',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No source fetch'));
 const h=mount({input:createInventedSourceMonitoringSnapshot()}),text=h.html();
 assert.equal(h.nodes().filter(n=>n.type==='select').length,4);
 for(const axis of ['check','permission','registration','due'])assert.match(text,new RegExp(`for="source-monitoring-${axis}-filter"`));
 for(const label of ['Approved registration','Suspended','Retired','Due time not recorded','Not due at this observation','Due at this observation'])assert.match(text,new RegExp(label));
 assert.doesNotMatch(text,/<form|<input|<textarea|href="https?:/);
});
test('rapid independent native selections retain all four axes and Clear removes every filter',()=>{
 const h=mount({input:createInventedSourceMonitoringSnapshot()});
 change(h,'check','complete_unchanged');change(h,'permission','allowed');change(h,'registration','suspended');change(h,'due','due');
 assert.match(h.html(),/Showing 1 of 8/);assert.match(h.html(),/id="source-monitoring-detail-5"/);
 const reset=h.nodes().find(n=>n.type==='button');assert.equal(reset.props.disabled,false);reset.props.onClick();
 assert.match(h.html(),/Showing 8 of 8/);for(const axis of ['check','permission','registration','due'])assert.equal(select(h,axis).props.value,'');
 assert.equal(h.nodes().find(n=>n.type==='button').props.disabled,true);
});
test('malformed native selector observations withhold opaquely and explicit clear recovers',()=>{
 const h=mount({input:createInventedSourceMonitoringSnapshot()});
 for(const axis of ['check','permission','registration','due']){
  select(h,axis).props.onChange({get currentTarget(){throw Error('PRIVATE_SELECTOR');}});
  assert.match(h.html(),/Check the display filters/);assert.doesNotMatch(h.html(),/PRIVATE_SELECTOR|Showing/);
  h.nodes().find(n=>n.type==='button').props.onClick();
 }
 change(h,'due','not-a-status');assert.match(h.html(),/Check the display filters/);h.nodes().find(n=>n.type==='button').props.onClick();assert.match(h.html(),/Showing 8 of 8/);
});
test('existing display choices may persist across valid supplied snapshots without becoming a fresh source check',()=>{
 const props={input:createInventedSourceMonitoringSnapshot()},h=mount(props);change(h,'registration','suspended');change(h,'due','due');
 props.input=structuredClone(props.input);props.input.sources[4].registrationState='retired';
 assert.match(h.html(),/Showing 0 of 8/);assert.equal(select(h,'registration').props.value,'suspended');assert.match(h.html(),/not a live assessment/);
});
