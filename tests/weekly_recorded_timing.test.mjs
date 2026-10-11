import assert from 'node:assert/strict';
import test from 'node:test';
import { weeklyReportHarness } from './helpers/weekly_report_harness.mjs';
import { weeklyStatusHarness } from './helpers/weekly_status_harness.mjs';
import { parseWeeklyRehearsalStatus } from '../src/weekly-rehearsal-status.ts';
import { exportWeeklyRehearsal } from '../src/weekly-rehearsal-export.ts';
import { readWeeklyRehearsalReport } from '../src/weekly-rehearsal-report.ts';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function observed(dueAt='2026-09-28T06:00:00Z',observedAt='2026-10-03T14:36:03.626268+00:00',windowKey='2026-W40',reason='run_not_completed') {
  return parseWeeklyRehearsalStatus({state:'observed',observation:{schemaVersion:1,evidenceKind:'current_local_fictional_weekly_status',observedAt,dueAt,windowKey,graceMinutes:60,
    state:reason==='history_incomplete'?'held':'attention',reason,coverage:'unknown',totalReceipts:8,unreadableReceipts:reason==='history_incomplete'?1:0,pendingReceipts:0,
    realScheduleEnabled:false,trustedRunLedger:false,sourceRequests:0,publicationEnabled:false,alertsSent:0}});
}
function select(ui,file){const input={files:[file],value:'PRIVATE_TIME_FILENAME'};ui.input().onChange({currentTarget:input});assert.equal(input.value,'');}
const file=value=>new File([exportWeeklyRehearsal(value).body],'PRIVATE_TIME_FILENAME.json');
function exact(html,value){assert.match(html,/<summary>Exact recorded rehearsal times<\/summary>/);
  assert.match(html,/Recorded example window/);assert.match(html,/Recorded observation \(UTC\)/);assert.match(html,/Recorded example due time \(UTC\)/);
  for(const instant of [value.observation.observedAt,value.observation.dueAt])assert.ok(html.includes('<time dateTime="'+instant+'"><code>'+instant+'</code></time>'));
  assert.ok(html.includes(value.observation.windowKey));assert.match(html,/60 minutes, a fixed fictional rehearsal parameter/);
  assert.match(html,/minute precision/);assert.match(html,/do not establish a trusted clock, live operation, source freshness or an enabled schedule/);
}

test('saved report exposes exact UTC observation, due time, example window and fixed grace',async t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('Saved timing attempted transport'));const value=observed(),h=weeklyReportHarness();h.mount();try{
    select(h,file(value));await turn();exact(h.markup(),value);assert.match(h.markup(),/dated claim, not an authenticated receipt/);assert.doesNotMatch(h.markup(),/PRIVATE_TIME_FILENAME|<a /);
  }finally{h.unmount();}
});

test('current checked observation exposes the same exact timing without a new operation',async t=>{
  const value=observed();let calls=0;t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;assert.equal(url,'/api/dev/update-rehearsal/status');assert.equal(options.method,'GET');return Response.json(value);});
  const h=weeklyStatusHarness();h.mount();try{assert.doesNotMatch(h.markup(),/Exact recorded rehearsal times/);h.button().onClick();await turn();exact(h.markup(),value);assert.equal(calls,1);assert.equal(h.buttons().length,2);
    assert.match(h.markup(),/not a trusted live run ledger/);
  }finally{h.unmount();}
});

test('recorded UTC precision and seasonal due times stay literal rather than recalculated',async t=>{
  const values=[observed('2026-03-23T07:00:00Z','2026-03-25T12:03:04.000001Z','2026-W13'),
    observed('2026-03-30T06:00:00+00:00','2026-04-01T12:03:04.999999+00:00','2026-W14'),
    observed('2026-10-26T07:00:00Z','2026-10-28T12:03:04.100000Z','2026-W44')];
  let response; t.mock.method(globalThis,'fetch',async()=>Response.json(response));
  const current=weeklyStatusHarness(),saved=weeklyReportHarness();current.mount();saved.mount();try{
    for(const value of values){response=value;current.button().onClick();select(saved,file(value));await turn();exact(current.markup(),value);exact(saved.markup(),value);}
  }finally{current.unmount();saved.unmount();}
});

test('unchecked, cleared and refused observations disclose no exact timing or private input',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({state:'held',reason:'weekly_rehearsal_unavailable'}));const current=weeklyStatusHarness(),saved=weeklyReportHarness();current.mount();saved.mount();try{
    current.button().onClick();await turn();assert.match(current.markup(),/could not be verified/);assert.doesNotMatch(current.markup(),/Exact recorded rehearsal times/);
    select(saved,new File(['{"PRIVATE_TIMING_BODY":true}'],'PRIVATE_TIME_FILENAME'));await turn();assert.match(saved.markup(),/could not be read/);assert.doesNotMatch(saved.markup(),/Exact recorded rehearsal times|PRIVATE_TIMING/);
    select(saved,file(observed()));await turn();saved.button().onClick();assert.doesNotMatch(saved.markup(),/Exact recorded rehearsal times|2026-W40/);
  }finally{current.unmount();saved.unmount();}
});

test('a checked incomplete-history report keeps timing as dated fields without coverage qualification',async t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('Historical timing attempted upload'));const value=observed(undefined,undefined,undefined,'history_incomplete'),h=weeklyReportHarness();h.mount();try{
    select(h,file(value));await turn();exact(h.markup(),value);assert.match(h.markup(),/No weekly coverage was established/);assert.match(h.markup(),/Coverage: unknown/);assert.match(h.markup(),/1 withheld/);
  }finally{h.unmount();}
});

test('timing presentation leaves complete report bytes, classification and activation fields unchanged',()=>{
  const value=observed(),exported=exportWeeklyRehearsal(value),buffer=new TextEncoder().encode(exported.body).buffer,reopened=readWeeklyRehearsalReport(buffer,buffer.byteLength);
  assert.deepEqual(reopened.observation,value.observation);assert.equal(exportWeeklyRehearsal({state:'observed',observation:reopened.observation}).body,exported.body);
  assert.equal(reopened.observation.realScheduleEnabled,false);assert.equal(reopened.observation.publicationEnabled,false);assert.equal(reopened.observation.sourceRequests,0);assert.equal(reopened.observation.alertsSent,0);
});
