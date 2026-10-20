import assert from 'node:assert/strict';
import test from 'node:test';
import {sharedViewModule} from './helpers/shared_view_module.mjs';
import {recordedSourceLanguageLocations} from '../src/recorded-source-language-locations.ts';
import {recordedProposalSourceIndex} from '../src/recorded-proposal-source-index.ts';
import {proposalReport} from './helpers/proposal_fixture.mjs';
const create=()=>sharedViewModule(new URL('../src/recorded-source-language-finder-view.tsx',import.meta.url),'RecordedSourceLanguageFinder');
const select=h=>h.nodes().find(n=>n.type==='select');
const change=(h,value)=>select(h).props.onChange({currentTarget:{value}});
function ready(t){t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));const report=proposalReport(),snapshot=JSON.parse(report.capture.proposalJson).snapshot,index=recordedProposalSourceIndex(JSON.parse(report.base.publicationJson).snapshot,snapshot);const props={locations:recordedSourceLanguageLocations(report.sourceReceipts,index),comparisonKey:'a'.repeat(64)},h=create()(props);h.commit();t.after(()=>h.unmount());return{h,props};}
const ids=h=>h.nodes().filter(n=>n.type==='a'&&n.props.href.startsWith('#proposal-source-receipt-')).map(n=>n.props.href);
const forbidden=new Proxy({},{get(){assert.fail('Retired event observed');}});

test('exact-code selector has All missing and recorded choices with no additional button or transport port',t=>{
 const {h}=ready(t);assert.equal(select(h).props.disabled,false);assert.deepEqual(h.nodes().filter(n=>n.type==='option').map(n=>n.props.value),['all','missing','code:nb']);
 assert.doesNotMatch(h.html(),/<button|<form|type="file"|type="submit"|href="https:/);assert.match(h.html(),/2 of 2 captured source-version receipts match/);
});
test('selecting missing one exact code and All changes locator results only',t=>{const{h}=ready(t);change(h,'missing');assert.deepEqual(ids(h),['#proposal-source-receipt-2']);change(h,'code:nb');assert.deepEqual(ids(h),['#proposal-source-receipt-1']);change(h,'all');assert.equal(ids(h).length,2);assert.match(h.html(),/not independent sources or review readiness/);});
test('invalid choices and event faults withhold results without exception-body echo then allow explicit recovery',t=>{
 const{h}=ready(t);for(const value of ['__proto__','code:NB','code:unknown']){change(h,value);assert.deepEqual(ids(h),[]);assert.match(h.html(),/Matching locations are withheld/);}
 select(h).props.onChange({get currentTarget(){throw Error('PRIVATE_FAULT');}});assert.deepEqual(ids(h),[]);assert.doesNotMatch(h.html(),/PRIVATE_FAULT/);change(h,'all');assert.equal(ids(h).length,2);
});
test('newest selection wins reentrant target and value getters without observing retired later values',t=>{
 const{h}=ready(t),old=select(h).props.onChange;
 old({get currentTarget(){change(h,'missing');return{get value(){assert.fail('Retired value observed');}};}});assert.deepEqual(ids(h),['#proposal-source-receipt-2']);
 select(h).props.onChange({currentTarget:{get value(){change(h,'code:nb');return'missing';}}});assert.deepEqual(ids(h),['#proposal-source-receipt-1']);
});
test('comparison or receipt replacement retires callbacks and resets prior selection',t=>{
 for(const replacement of ['key','receipts']){const{h,props}=ready(t);change(h,'missing');const old=select(h).props.onChange;
 if(replacement==='key')props.comparisonKey='b'.repeat(64);else props.locations={...props.locations,codes:['en'],entries:props.locations.entries.map(e=>({...e,languageCode:'en'}))};
 h.render();old(forbidden);assert.equal(select(h).props.disabled,true);assert.equal(select(h).props.value,'all');h.commit();assert.equal(select(h).props.value,'all');assert.equal(ids(h).length,2);
 }
});
test('unmount retires saved handlers before any event observation',t=>{const{h}=ready(t),old=select(h).props.onChange;h.unmount();old(forbidden);assert.equal(select(h).props.disabled,true);});
