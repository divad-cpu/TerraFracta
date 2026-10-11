import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {parseUpdateRunReport,osloScheduledKey,updateRunReportSchema} from '../src/update-run-report.ts';
import {parseFictionalResponseSnapshot} from '../src/fictional-response-snapshot.ts';
import {parseFictionalCompletionSnapshot} from '../src/fictional-completion-snapshot.ts';
import {parseFictionalPipelineSnapshot} from '../src/fictional-pipeline-snapshot.ts';
import {parseFictionalCaptureFailure} from '../src/fictional-capture-failure.ts';
const load=name=>{const value=JSON.parse(readFileSync(new URL('../fixtures/'+name+'.json',import.meta.url),'utf8'));if(name==='fictional_update_report'){value.trigger='manual';value.scheduledDueAt=null;value.requestKey='fictional:manual:2026w41';}return value;};
const base='2026-10-05T07:30:00';
const fractions=['000001','000000001','000000000000001'];
test('run report refuses reversed admitted decimal chronology',()=>{
 for(const fraction of fractions){const value=load('fictional_update_report');value.startedAt=base+'.'+fraction+'Z';value.finishedAt=base+'Z';assert.throws(()=>parseUpdateRunReport(value),/finished before/);}
});
test('run report retains exact equal offsets and decimal spellings without mutation',()=>{
 for(const [started,finished] of [[base+'.000001Z','2026-10-05T09:30:00.000001000+02:00'],['1969-12-31T23:59:59.999999999Z','1970-01-01T00:00:00Z'],['0000-01-01T00:00:00Z','0001-01-01T00:00:00Z']]){
  const value=load('fictional_update_report');value.startedAt=started;value.finishedAt=finished;const before=structuredClone(value);assert.deepEqual(parseUpdateRunReport(value),value);assert.deepEqual(value,before);
 }
});
test('Monday schedule rejects any nonzero fractional instant at admitted precision',()=>{
 for(const fraction of ['000001','000000001','000000000000001','1']) for(const [whole,suffix] of [['2026-10-05T06:00:00','Z'],['2026-10-05T08:00:00','+02:00']]){
  const due=whole+'.'+fraction+suffix;assert.equal(osloScheduledKey(due,'fictional-country'),null);
  const value=load('fictional_update_report');value.trigger='scheduled';value.scheduledDueAt=due;value.requestKey='weekly:2026w41:fictional-country';assert.throws(()=>parseUpdateRunReport(value),/Monday 08:00/);
 }
});
test('exact Monday zero fractions and before-due decimal controls retain existing schedule policy',()=>{
 for(const due of ['2026-10-05T06:00:00Z','2026-10-05T06:00:00.000000000Z','2026-10-05T08:00:00.000+02:00']){
  assert.equal(osloScheduledKey(due,'fictional-country'),'weekly:2026w41:fictional-country');
  const value=load('fictional_update_report');value.trigger='scheduled';value.scheduledDueAt=due;value.requestKey='weekly:2026w41:fictional-country';value.startedAt='2026-10-05T06:00:00Z';value.finishedAt=base+'Z';assert.equal(parseUpdateRunReport(value).trigger,'scheduled');
  value.startedAt='2026-10-05T05:59:59.999999999999Z';assert.throws(()=>parseUpdateRunReport(value),/Monday 08:00/);
 }
});
for(const [name,parse,file,field] of [['response',parseFictionalResponseSnapshot,'fictional_response_snapshot','savedAt'],['completion',parseFictionalCompletionSnapshot,'fictional_completion_snapshot','finishedAt'],['pipeline',parseFictionalPipelineSnapshot,'fictional_pipeline_snapshot','finishedAt'],['capture failure',parseFictionalCaptureFailure,'fictional_capture_failure_snapshot','finishedAt']]){
 const set=(value,stamp)=>{if(value.cases)for(const entry of value.cases)entry[field]=stamp;else value[field]=stamp;if(value.fact){value.fact.retrievedAt=base+'Z';value.fact.lastEvidenceReviewOn=base.slice(0,10);}};
 test(name+' refuses a future decimal event before its enclosing recording',()=>{
  for(const fraction of fractions){const value=load(file);value.recordedAt=base+'Z';set(value,base+'.'+fraction+'Z');assert.throws(()=>parse(value));}
 });
 test(name+' keeps equivalent offset/precision chronology and closed permissions',()=>{
  const value=load(file);value.recordedAt=base+'.123456789000Z';set(value,'2026-10-05T09:30:00.123456789+02:00');const before=structuredClone(value);assert.deepEqual(parse(value),value);assert.deepEqual(value,before);
  const privateValue={...value,privatePath:'private-canary'};assert.throws(()=>parse(privateValue));
 });
}
test('pipeline source retrieval cannot occur after the stored-fact finish by a decimal digit',()=>{
 for(const fraction of fractions){const value=load('fictional_pipeline_snapshot');value.recordedAt=base+'.9Z';for(const entry of value.cases)entry.finishedAt=base+'Z';value.fact.retrievedAt=base+'.'+fraction+'Z';value.fact.lastEvidenceReviewOn=base.slice(0,10);assert.throws(()=>parseFictionalPipelineSnapshot(value));}
});

test('invalid ISO leaf times retain failed Zod parsing without an unexpected comparator exception',()=>{
 for(const invalid of ['invalidZ','2026-10-05T07:30:60Z','2026-10-05T07:30:00+24:00','2026-02-30T00:00:00Z']){
  const report=load('fictional_update_report');report.finishedAt=invalid;assert.equal(updateRunReportSchema.safeParse(report).success,false);
  assert.throws(()=>parseUpdateRunReport(report),error=>Array.isArray(error.issues));
  for(const [parse,file,field] of [[parseFictionalResponseSnapshot,'fictional_response_snapshot','savedAt'],[parseFictionalCompletionSnapshot,'fictional_completion_snapshot','finishedAt'],[parseFictionalPipelineSnapshot,'fictional_pipeline_snapshot','finishedAt'],[parseFictionalCaptureFailure,'fictional_capture_failure_snapshot','finishedAt']]){
   const value=load(file);if(value.cases)value.cases[0][field]=invalid;else value[field]=invalid;
   assert.throws(()=>parse(value),error=>Array.isArray(error.issues));
  }
 }
});
