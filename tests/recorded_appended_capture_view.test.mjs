import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
import {createRecordedAppendedCaptureResolver as create} from '../src/server/recorded-appended-capture.ts';
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-recorded-capture-history.json',import.meta.url),'utf8')),saved=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-capture.json',import.meta.url),'utf8'));
const {RecordedAppendedCaptureView:View}=loadTsx(new URL('../src/recorded-appended-capture-view.tsx',import.meta.url));
async function decision(choice=true,empty=false){const f=fixture(),s=saved(),lookup=JSON.parse(f.lookupJson);if(empty)lookup.matches=[];return create(()=>0,async()=> 'unavailable')({preparationId:f.preparationId,captureId:choice?f.captureId:null,preparationReportJson:f.preparationReportJson,preparationExpected:f.preparationExpected,lookupRaw:Buffer.from(JSON.stringify(lookup)),observedAt:f.observedAt,record:{retainedIntentJson:s.retainedIntentJson,rawReceiptJson:s.rawReceiptJson,actualComparisonJson:JSON.stringify(s.actualComparison)}});}
test('a single listed composition stays metadata-only until explicitly chosen',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No request'));const html=renderToStaticMarkup(View({decision:await decision(false)}));for(const text of ['Recorded composition choices','constructed for navigation','not a new database observation','No record is selected automatically','Choose a composition explicitly'])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/Changed exact|Exact Å|Saved whole-issue composition comparison|<form|<button|<input/);assert.match(html,/preparation=2838c9f5.*capture=8e5d2d6a/);
});
test('explicit composition shows its seven-part comparison and returns to the exact preparation scope',async()=>{
 const html=renderToStaticMarkup(View({decision:await decision()}));for(const text of ['Saved whole-issue composition comparison','Changed exact Å source passage.','Earlier supplied document','Current supplied document','Return to this exact preparation','No editorial action is available'])assert.ok(html.includes(text),text);assert.match(html,/href="\/editorial-preview\/capture-history\?preparation=2838c9f5-1ad9-483a-8fde-fa770157e0e6"/);assert.match(html,/aria-current="page"/);assert.doesNotMatch(html,/<form|<button|<input|href="https?:/);
});
test('checked empty metadata remains distinct from failed selection and offers no write action',async()=>{
 const html=renderToStaticMarkup(View({decision:await decision(false,true)}));assert.match(html,/No matching composition/);assert.match(html,/does not authorize another extraction/);assert.doesNotMatch(html,/Saved whole-issue composition comparison|Changed exact|<form|<button/);
});
test('every opaque refusal withholds all private preparation and capture details',()=>{
 for(const kind of ['invalid_scope','not_found','unavailable']){const html=renderToStaticMarkup(View({decision:{kind}}));assert.match(html,/Selected continuation unavailable/);assert.doesNotMatch(html,/2838c9f5|Changed exact|Exact Å|Original exact|Recorded composition 1|Saved whole-issue/);}
});
