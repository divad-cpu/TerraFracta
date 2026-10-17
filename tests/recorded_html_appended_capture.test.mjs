import assert from 'node:assert/strict';import test from 'node:test';
import {createRecordedHtmlAppendedCaptureResolver as resolver} from '../src/server/recorded-html-appended-capture.ts';
import {htmlCaptureFixture as fixture} from './helpers/html_capture_transport_fixture.mjs';
function input(){const f=fixture();return {f,v:{preparationId:f.report.preparation.operation_id,captureId:f.native.capture_id,
 preparationReportJson:f.bundle.candidateReportJson,preparationExpected:f.expected,lookupRaw:Buffer.from(JSON.stringify(f.lookup)),observedAt:f.f.observedAt,
 record:{retainedIntentJson:f.f.retainedIntentJson,rawReceiptJson:f.raw.toString('utf8'),actualComparisonJson:JSON.stringify(f.f.actualReport)}}};}
test('HTML continuation joins explicit preparation metadata full capture and separate comparison without a connection',async()=>{
 const {f,v}=input(),r=await resolver(()=>0,async()=>assert.fail('No diagnostic'))(v);assert.equal(r.kind,'ok');assert.equal(r.joined.stored.capture.captureId,f.native.capture_id);assert.equal(r.captureId,f.native.capture_id);assert.equal(r.joined.stored.intentJson,f.f.retainedIntentJson);assert.equal(r.joined.stored.bundle.proposalJson,f.bundle.proposalJson);assert.equal(r.observedAt,f.f.observedAt);assert.match(r.evidenceState,/recorded_html_continuation_not_current_or_publication_qualified/);
});
test('choice metadata is lazy and no full saved-record selector runs until a checked explicit selection',async()=>{
 const {v}=input();v.captureId=null;let reads=0;Object.defineProperty(v,'record',{enumerable:true,get(){reads++;throw Error('INVENTED_RECORD_TRAP');}});
 const r=await resolver(()=>0)(v);assert.equal(r.kind,'choice_required');assert.equal(r.choices.matches.length,1);assert.equal(reads,0);assert.doesNotMatch(JSON.stringify(r),/rawReceiptJson|candidateReportJson|proposed_assertion/);
});
test('unknown capture returns not_found without touching an unrelated saved record',async()=>{
 const {v}=input();v.captureId='00000000-0000-4000-8000-000000000999';Object.defineProperty(v,'record',{enumerable:true,get(){assert.fail('No unrelated record');}});assert.deepEqual(await resolver(()=>0)(v),{kind:'not_found'});
});
test('malformed full scope and reentrant key additions withhold contents before any saved selector',async()=>{
 const {v}=input();for(const bad of [null,{},Object.create(v),{...v,extra:true},{...v,[Symbol('extra')]:true},{...v,preparationId:'00000000-0000-4000-8000-000000000999'},{...v,observedAt:'0000-01-01T00:00:00.000000Z'}])assert.deepEqual(await resolver(()=>0)(bad),{kind:'invalid_scope'});
 const changed={...v};Object.defineProperty(changed,'preparationId',{enumerable:true,get(){changed.extra=true;return v.preparationId;}});assert.deepEqual(await resolver(()=>0)(changed),{kind:'invalid_scope'});
});
test('corrupt full custody or a different separate comparison withholds every composition detail',async()=>{
 for(const mutate of [r=>r.rawReceiptJson='{}',r=>r.retainedIntentJson='{}',r=>r.actualComparisonJson='{}']){const {v}=input();mutate(v.record);assert.deepEqual(await resolver(()=>0,async()=> 'saved')(v),{kind:'unavailable'});}
});
test('selected saved-record getters cannot enlarge closed scope or mutate the record key grammar',async()=>{
 const {v}=input(),saved=v.record;Object.defineProperty(v,'record',{enumerable:true,get(){v.extra=true;return saved;}});assert.deepEqual(await resolver(()=>0)(v),{kind:'unavailable'});
 const second=input().v,intent=second.record.retainedIntentJson;Object.defineProperty(second.record,'retainedIntentJson',{enumerable:true,get(){second.record[Symbol('extra')]=true;return intent;}});assert.deepEqual(await resolver(()=>0)(second),{kind:'unavailable'});
});
test('cancelled and expired outer continuation never returns a partial choice or complete view',async()=>{
 const {v}=input(),parent=new AbortController();parent.abort();assert.deepEqual(await resolver(()=>0)(v,parent.signal),{kind:'unavailable'});
 let at=0;const saved=v.record;Object.defineProperty(v,'record',{enumerable:true,get(){at=3000;return saved;}});assert.deepEqual(await resolver(()=>at)(v),{kind:'unavailable'});
});

test('original outer budget includes initial selection getters and refuses before saved-record access',async()=>{
 for(const capture of [true,false]){const {v}=input();let at=0,reads=0;if(!capture)v.captureId=null;const id=v.preparationId;Object.defineProperty(v,'preparationId',{enumerable:true,get(){at=3000;return id;}});Object.defineProperty(v,'record',{enumerable:true,get(){reads++;assert.fail('No expired saved-record access');}});assert.deepEqual(await resolver(()=>at)(v),{kind:'unavailable'});assert.equal(reads,0);}
 const {v}=input();let reads=0;Object.defineProperty(v,'preparationId',{enumerable:true,get(){reads++;assert.fail('No cancelled selector');}});const parent=new AbortController();parent.abort();assert.deepEqual(await resolver(()=>0)(v,parent.signal),{kind:'unavailable'});assert.equal(reads,0);
 for(const now of [()=>NaN,()=>{throw Error('INVENTED_CLOCK_FAILURE');}])assert.deepEqual(await resolver(now)(input().v),{kind:'unavailable'});
});
