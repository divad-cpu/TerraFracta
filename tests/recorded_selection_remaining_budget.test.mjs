import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRecordedAppendedCaptureResolver as plainAppended} from '../src/server/recorded-appended-capture.ts';
import {createRecordedHtmlAppendedCaptureResolver as htmlAppended} from '../src/server/recorded-html-appended-capture.ts';
import {createRecordedInitialCaptureHistoryResolver as plainInitial} from '../src/server/recorded-initial-capture-history.ts';
import {createRecordedHtmlInitialCaptureHistoryResolver as htmlInitial} from '../src/server/recorded-html-initial-capture-history.ts';
import {htmlCaptureFixture} from './helpers/html_capture_transport_fixture.mjs';
const json=n=>JSON.parse(readFileSync(new URL('../fixtures/'+n,import.meta.url),'utf8'));
function input(kind){
 if(kind==='htmlAppended'){const f=htmlCaptureFixture();return {preparationId:f.report.preparation.operation_id,captureId:f.native.capture_id,preparationReportJson:f.bundle.candidateReportJson,preparationExpected:f.expected,lookupRaw:Buffer.from(JSON.stringify(f.lookup)),observedAt:f.f.observedAt,record:{retainedIntentJson:f.f.retainedIntentJson,rawReceiptJson:f.raw.toString('utf8'),actualComparisonJson:JSON.stringify(f.f.actualReport)}};}
 if(kind==='plainAppended'){const f=json('fictional-recorded-capture-history.json'),s=json('fictional-appended-capture.json');return {preparationId:f.preparationId,captureId:f.captureId,preparationReportJson:f.preparationReportJson,preparationExpected:f.preparationExpected,lookupRaw:Buffer.from(f.lookupJson),observedAt:f.observedAt,record:{retainedIntentJson:s.retainedIntentJson,rawReceiptJson:s.rawReceiptJson,actualComparisonJson:JSON.stringify(s.actualComparison)}};}
 const h=json(kind==='htmlInitial'?'fictional-html-initial-capture-history.json':'fictional-initial-capture-history.json'),record=kind==='htmlInitial'?json('fictional-html-initial-capture.json'):h.record;
 return {preparationId:h.preparationId,captureId:record.id,preparationReportJson:h.preparationReportJson,preparationExpected:h.preparationExpected,lookupRaw:Buffer.from(h.lookupJson),lookupObservedAt:h.lookupObservedAt,captureObservedAt:h.captureObservedAt,record};
}
for(const[kind,create]of Object.entries({plainAppended,htmlAppended,plainInitial,htmlInitial}))test(kind+' saved history preserves original remaining interval across all nested readers',async t=>{
 const v=input(kind),id=v.preparationId;let clock=0;const delays=[],original=setTimeout;
 Object.defineProperty(v,'preparationId',{enumerable:true,get(){clock=750;return id;}});
 t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>{delays.push(delay);return original(fn,delay,...args);});
 const result=await create(()=>clock,async()=>assert.fail('No diagnostic'))(v);
 assert.equal(result.kind,'ok');assert.deepEqual(delays,[2250]);
});
