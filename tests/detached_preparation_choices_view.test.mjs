import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-detached-preparation-history.json',import.meta.url),'utf8'));
const {DetachedPreparationChoicesView}=loadTsx(new URL('../src/detached-preparation-choices-view.tsx',import.meta.url));
const render=(b,change={})=>renderToStaticMarkup(DetachedPreparationChoicesView({raw:b.choicesJson,expected:b.expectedChoices,...change}));
test('unselected real metadata shows two explicit choices and no candidate or original text',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));const b=fixture(),html=render(b);
 assert.match(html,/No preparation is selected automatically/);assert.match(html,/Choose one record explicitly/);assert.equal((html.match(/Inspect recorded preparation [12]/g)??[]).length,2);
 for(const report of b.reports)assert.ok(html.includes(`?preparation=${report.operationId}`));
 assert.doesNotMatch(html,/Changed exact|Invented first historical candidate|Invented second historical candidate|Original exact|<form|<input|<button|<script/);
});
test('each explicit member renders its own exact recorded report and historical qualification limits',()=>{
 const b=fixture();for(const [index,report]of b.reports.entries()){const html=render(b,{selected:report.operationId,selectedRaw:report.reportJson,selectedExpected:report.expected});
 assert.ok(html.includes(`Invented ${index===0?'first':'second'} historical candidate`));assert.match(html,/Opening this page does not perform a fresh storage read/);assert.match(html,/aria-current="page"/);assert.match(html,/No editorial action is available/);}
});
test('unknown choice or wrong full report holds selected details without rendering partial source text',()=>{
 const b=fixture();for(const change of [{selected:'PRIVATE_CANARY'},{selected:b.reports[0].operationId,selectedRaw:b.reports[1].reportJson,selectedExpected:b.reports[1].expected}]){
 const html=render(b,change);assert.match(html,/Selected preparation unavailable/);assert.doesNotMatch(html,/PRIVATE_CANARY|Changed exact|Invented first historical candidate|Invented second historical candidate/);}
});
test('invalid choices report suppresses even metadata and selected report',()=>{
 const b=fixture(),html=render(b,{raw:b.choicesJson+' ',selected:b.reports[0].operationId,selectedRaw:b.reports[0].reportJson,selectedExpected:b.reports[0].expected});
 assert.match(html,/Historical choices unavailable/);assert.doesNotMatch(html,/Inspect recorded preparation|Changed exact|Invented first historical candidate/);
});
