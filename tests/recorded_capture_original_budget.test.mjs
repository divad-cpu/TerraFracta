import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRecordedAppendedCaptureResolver as appended} from '../src/server/recorded-appended-capture.ts';
import {createRecordedInitialCaptureHistoryResolver as initial} from '../src/server/recorded-initial-capture-history.ts';
const json=n=>JSON.parse(readFileSync(new URL('../fixtures/'+n,import.meta.url),'utf8'));
function input(kind){
 if(kind==='initial'){const f=json('fictional-initial-capture-history.json');return {preparationId:f.preparationId,captureId:f.captureId,preparationReportJson:f.preparationReportJson,preparationExpected:f.preparationExpected,lookupRaw:Buffer.from(f.lookupJson),lookupObservedAt:f.lookupObservedAt,captureObservedAt:f.captureObservedAt,record:f.record};}
 const f=json('fictional-recorded-capture-history.json'),s=json('fictional-appended-capture.json');return {preparationId:f.preparationId,captureId:f.captureId,preparationReportJson:f.preparationReportJson,preparationExpected:f.preparationExpected,lookupRaw:Buffer.from(f.lookupJson),observedAt:f.observedAt,record:{retainedIntentJson:s.retainedIntentJson,rawReceiptJson:s.rawReceiptJson,actualComparisonJson:JSON.stringify(s.actualComparison)}};
}
for(const [kind,create] of [['appended',appended],['initial',initial]])for(const full of [false,true])test(kind+' original interval covers initial getters for '+(full?'full selection':'metadata choice'),async()=>{
 const v=input(kind);if(!full)v.captureId=null;let at=0,recordReads=0;const id=v.preparationId;
 Object.defineProperty(v,'preparationId',{enumerable:true,get(){at=3000;return id;}});
 Object.defineProperty(v,'record',{enumerable:true,get(){recordReads++;assert.fail('No expired full record');}});
 assert.deepEqual(await create(()=>at,async()=>assert.fail('No expected-hold diagnostic'))(v),{kind:'unavailable'});assert.equal(recordReads,0);
});

for(const [kind,create] of [['appended',appended],['initial',initial]])test(kind+' cancelled and invalid native clock boundaries remain opaque before initial getters',async()=>{
 const v=input(kind);let reads=0;Object.defineProperty(v,'preparationId',{enumerable:true,get(){reads++;assert.fail('No cancelled selector');}});const parent=new AbortController();parent.abort();assert.deepEqual(await create(()=>0)(v,parent.signal),{kind:'unavailable'});assert.equal(reads,0);
 for(const now of [()=>NaN,()=>Infinity,()=>{throw Error('INVENTED_CLOCK_FAILURE');}])assert.deepEqual(await create(now)(input(kind)),{kind:'unavailable'});
 let at=5;const backward=input(kind),id=backward.preparationId;Object.defineProperty(backward,'preparationId',{enumerable:true,get(){at=4;return id;}});assert.deepEqual(await create(()=>at)(backward),{kind:'unavailable'});
});
