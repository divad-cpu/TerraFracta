import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { weeklyRehearsalObservationSchema } from '../src/weekly-rehearsal-status.ts';
import { exportWeeklyRehearsal } from '../src/weekly-rehearsal-export.ts';
import { readWeeklyRehearsalReport } from '../src/weekly-rehearsal-report.ts';
import { loadTsx } from './helpers/tsx_loader.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const reasons = weeklyRehearsalObservationSchema.shape.reason.options;
const outcomes = {
  history_incomplete: ['held','unknown'], latest_receipt_ambiguous: ['held','unknown'],
  not_due: ['pending','unknown'], within_grace_window: ['pending','unknown'],
  window_invalid: ['invalid','unknown'], run_receipt_invalid: ['invalid','unknown'],
  run_not_completed: ['attention','unknown'], due_source_coverage_incomplete: ['attention','incomplete'],
  visibility_unverified: ['attention','complete'], scheduled_run_late: ['attention','complete'],
  due_window_completed: ['healthy','complete'], scheduled_run_missing: ['attention','unknown'],
  scheduled_run_missing_manual_catchup_complete: ['attention','complete'],
  scheduled_run_missing_manual_catchup_incomplete: ['attention','incomplete'],
};
function status(reason) {
  const [state,coverage] = outcomes[reason];
  return {state:'observed',observation:weeklyRehearsalObservationSchema.parse({
    schemaVersion:1,evidenceKind:'current_local_fictional_weekly_status',
    observedAt: reason==='not_due'?'2026-10-05T05:30:00.000001Z':reason==='within_grace_window'?'2026-10-05T06:30:00.000001Z':'2026-10-05T08:00:00.000001Z',
    dueAt:'2026-10-05T06:00:00Z',windowKey:'2026-W41',graceMinutes:60,state,reason,coverage,
    totalReceipts:3,unreadableReceipts:reason==='history_incomplete'?1:0,pendingReceipts:0,
    realScheduleEnabled:false,trustedRunLedger:false,sourceRequests:0,publicationEnabled:false,alertsSent:0,
  })};
}
function nodes(value) { if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object')return [];return [value,...nodes(value.props?.children)]; }
function harness(kind) {
  let cursor=0,effect,cleanup,layout,layoutCleanup;const cells=[];
  const hooks={useState(initial){const i=cursor++;cells[i]??=initial;return [cells[i],v=>{cells[i]=typeof v==='function'?v(cells[i]):v;}];},useRef(initial){const i=cursor++;cells[i]??={current:initial};return cells[i];},useEffect(fn){effect=fn;},useLayoutEffect(fn){layout=fn;}};
  const name=kind==='saved'?'weekly-rehearsal-report-view.tsx':'weekly-rehearsal-status-view.tsx';
  const component=loadTsx(new URL('../src/'+name,import.meta.url),name=>name==='react'?hooks:undefined)[kind==='saved'?'WeeklyRehearsalReportView':'WeeklyRehearsalStatusView'];
  const render=()=>{cursor=0;return component();};
  return {mount(){render();layoutCleanup=layout?.();cleanup=effect();},unmount(){layoutCleanup?.();cleanup?.();},markup:()=>renderToStaticMarkup(render()),
    choose(file){const input={files:[file],value:'PRIVATE_FILENAME'};nodes(render()).find(n=>n.type==='input').props.onChange({currentTarget:input});assert.equal(input.value,'');},
    clear(){nodes(render()).find(n=>n.type==='button'&&n.props.children==='Clear local report').props.onClick();},
    refresh(){nodes(render()).find(n=>n.type==='button'&&n.props.children==='Check weekly rehearsal history').props.onClick();},};
}
function explanation(html) {const match=html.match(/Recorded reason explanation: <strong>(.*?)<\/strong>/);assert.ok(match,'Historical report lacks its recorded reason explanation');return match[1];}
function file(value) {return new File([exportWeeklyRehearsal(value).body],'PRIVATE_FILENAME.json',{type:'application/json'});}

test('all fourteen checked historical reasons have the same explanation in current and saved views',async t=>{
  assert.equal(reasons.length,14);let dispatched=0;
  for(const reason of reasons){const value=status(reason);const current=harness('current'),saved=harness('saved');
    t.mock.method(globalThis,'fetch',async(url,options)=>{dispatched++;assert.equal(url,'/api/dev/update-rehearsal/status');assert.equal(options.method,'GET');return new Response(JSON.stringify(value));});
    current.mount();saved.mount();try{current.refresh();saved.choose(file(value));await tick();
      const s=saved.markup(),c=current.markup(),meaning=explanation(s);assert.ok(meaning.length>20);assert.ok(c.includes('<strong>'+meaning+'</strong>'));
      assert.ok(s.includes('<code>'+reason+'</code>'));assert.match(s,/dated claim, not an authenticated receipt or a current inspection/);
      assert.doesNotMatch(s,/PRIVATE_FILENAME|href=|<a /);
    }finally{current.unmount();saved.unmount();t.mock.restoreAll();}
  }assert.equal(dispatched,14);
});

test('manual catchup and incomplete history explanations preserve weekly and qualification limits',async t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('Local report attempted upload'));
  const expected={scheduled_run_missing_manual_catchup_complete:/manual rehearsal covered.*weekly trigger still had no completed rehearsal/i,
    scheduled_run_missing_manual_catchup_incomplete:/manual catch-up did not establish a completed, visible rehearsal covering the expected/i,
    history_incomplete:/incomplete or changed.*No weekly coverage was established/i,
    visibility_unverified:/visibility was unresolved/i,
    not_due:/not yet due at the recorded observation/i,
    within_grace_window:/recorded observation was within.*grace period/i};
  for(const [reason,pattern]of Object.entries(expected)){const h=harness('saved');h.mount();try{h.choose(file(status(reason)));await tick();assert.match(explanation(h.markup()),pattern);}finally{h.unmount();}}
});

test('explanations keep exact closed report values and complete serialized bytes unchanged',async()=>{
  for(const reason of reasons){const value=status(reason),exported=exportWeeklyRehearsal(value),raw=new TextEncoder().encode(exported.body).buffer;
    const parsed=readWeeklyRehearsalReport(raw,raw.byteLength);assert.deepEqual(parsed.observation,value.observation);
    assert.equal(exportWeeklyRehearsal({state:'observed',observation:parsed.observation}).body,exported.body);
    assert.equal(exported.filename,'terrafracta-weekly-rehearsal-2026-W41.json');
    const h=harness('saved');h.mount();try{h.choose(file(value));await tick();const html=h.markup();
      assert.ok(html.includes('dateTime="'+value.observation.observedAt+'"')||html.includes('datetime="'+value.observation.observedAt+'"'));
      assert.match(html,/3 recorded receipts/);assert.ok(html.includes('<strong>'+value.observation.state+'</strong>'));
      assert.ok(html.includes('Coverage: '+value.observation.coverage+'.'));
    }finally{h.unmount();}
  }
});

test('historical explanations disappear on clear and invalid replacement with no raw file disclosure',async t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('Local report attempted transport'));
  const h=harness('saved');h.mount();try{assert.doesNotMatch(h.markup(),/Recorded reason explanation/);
    h.choose(file(status('scheduled_run_missing')));await tick();explanation(h.markup());h.clear();assert.doesNotMatch(h.markup(),/Recorded reason explanation|scheduled_run_missing/);
    h.choose(file(status('due_window_completed')));await tick();explanation(h.markup());h.choose(new File(['{"privateNote":"PRIVATE_BODY"}'],'PRIVATE_FILENAME'));await tick();
    assert.match(h.markup(),/could not be read/);assert.doesNotMatch(h.markup(),/Recorded reason explanation|PRIVATE_BODY|PRIVATE_FILENAME|due_window_completed/);
  }finally{h.unmount();}
});

test('current refresh withholds the recorded explanation until a new checked read settles',async t=>{
  let done;const h=harness('current');t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(status('due_window_completed'))));h.mount();try{
    h.refresh();await tick();assert.match(h.markup(),/complete weekly rehearsal was recorded within/);
    t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{done=resolve;}));h.refresh();assert.doesNotMatch(h.markup(),/complete weekly rehearsal was recorded within/);
    done(new Response(JSON.stringify({state:'held',reason:'weekly_rehearsal_unavailable'})));await tick();assert.doesNotMatch(h.markup(),/complete weekly rehearsal was recorded within/);assert.match(h.markup(),/history could not be verified/);
  }finally{h.unmount();}
});

// This code also covers a full source set with an incomplete run or unresolved visibility.
test('manual incomplete reason cannot assert missing sources or a missing weekly trigger cause',async t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('Historical explanation attempted a transport'));
  const value=status('scheduled_run_missing_manual_catchup_incomplete'),h=harness('saved');h.mount();try{
    h.choose(file(value));await tick();const html=h.markup(),meaning=explanation(html);
    assert.match(meaning,/did not establish a completed, visible rehearsal covering the expected example source set/);
    assert.doesNotMatch(meaning,/did not cover|sources (?:were|are) missing|failed source|weekly trigger (?:failed|was late)/i);
    assert.ok(html.includes('<code>scheduled_run_missing_manual_catchup_incomplete</code>'));
    assert.match(html,/Coverage: incomplete/);assert.match(html,/dated claim, not an authenticated receipt/);
    assert.equal(readWeeklyRehearsalReport(new TextEncoder().encode(exportWeeklyRehearsal(value).body).buffer).observation.reason,value.observation.reason);
  }finally{h.unmount();}
});
