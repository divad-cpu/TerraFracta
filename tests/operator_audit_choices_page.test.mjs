import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canonicalOperatorAuditChoice,canonicalOperatorAuditRunCursor,createOperatorAuditChoicesReader,readOperatorAuditChoices } from '../src/server/operator-audit-choices-reader.ts';
import { canonicalOperatorAuditScope,createOperatorAuditReader } from '../src/server/operator-audit-reader.ts';
import { choices,choiceId,bytes } from './helpers/operator_audit_choices_fixture.mjs';
import { audit } from './helpers/operator_audit_fixture.mjs';

// Actual source pages/presenters rendered by React. Intercept only the two
// server reader calls and Next refusal; no placeholder view or web listener.
const pageSource=new URL('../app/editorial-preview/audit/select/page.tsx',import.meta.url);
function harness(mode='development',read=readOperatorAuditChoices,readAudit=async()=>({kind:'unconfigured'})){
  const marker=new Error('NEXT_NOT_FOUND'),calls=[],modules=new Map();
  function load(source){
    if(modules.has(source.href))return modules.get(source.href);
    const exports={},native=createRequire(source);modules.set(source.href,exports);
    const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','exports','process',compiled)(name=>{
      if(name==='next/navigation')return {unstable_rethrow:native(name).unstable_rethrow,notFound:()=>{throw marker;}};
      if(source.href===pageSource.href&&name.endsWith('operator-audit-choices-reader.ts'))return {canonicalOperatorAuditChoice,canonicalOperatorAuditRunCursor,readOperatorAuditChoices:async (id,signal,cursor)=>{calls.push(id);return read(id,signal,cursor);}};
      if(source.href.endsWith('/audit/page.tsx')&&name.endsWith('operator-audit-reader.ts'))return {canonicalOperatorAuditScope,readOperatorAudit:readAudit};
      if(name.startsWith('.')){const candidate=new URL(name.endsWith('.tsx')?name:name+'.tsx',source);if(existsSync(candidate))return load(candidate);}
      return native(name);
    },exports,{env:{NODE_ENV:mode}});return exports;
  }
  const module=load(pageSource),view=load(new URL('../src/operator-audit-choices-view.tsx',import.meta.url)).OperatorAuditChoicesView;
  return {marker,calls,module,page:module.default,
    render:async query=>renderToStaticMarkup(await module.default({searchParams:Promise.resolve(query)})),
    view:(decision,selection,cursor)=>renderToStaticMarkup(createElement(view,{decision,selection,cursor})),
    audit:async query=>renderToStaticMarkup(await load(new URL('../app/editorial-preview/audit/page.tsx',import.meta.url)).default({searchParams:Promise.resolve(query)}))};
}

test('actual older-run link passes an exact keyset cursor to reader and keeps independently selected run and issue form',async()=>{
  const all=Array.from({length:26},(_,i)=>({runId:choiceId(29-i),jurisdictionId:'invented-jurisdiction',createdAt:'2026-10-05T09:00:00.000001Z',runState:'completed'})),intents=[],seen=[];
  const next={createdAt:all[19].createdAt,runId:all[19].runId};
  const read=createOperatorAuditChoicesReader(async(id,_signal,cursor)=>{
    seen.push({id,cursor});const report=choices(id);report.runs=cursor===null?all.slice(0,20):all.slice(20);
    report.moreRuns=cursor===null;report.requestedCursor=cursor;report.nextCursor=cursor===null?next:null;
    report.selectedRun=all.find(run=>run.runId===id)??null;report.issues=report.selectedRun?[{issueId:choiceId(30),issueKey:'housing-costs'}]:[];return bytes(report);
  },undefined,code=>intents.push(code));
  const h=harness('development',read),first=await h.render({runId:choiceId(29)});
  const link=[...first.matchAll(/href="([^"]+)"/g)].find(match=>match[1].includes('beforeCreatedAt'))[1].replaceAll('&amp;','&');
  const url=new URL(link,'https://example.invalid');assert.equal(url.pathname,'/editorial-preview/audit/select');
  const second=await h.render(Object.fromEntries(url.searchParams));assert.equal(seen.length,2);assert.deepEqual(seen[1],{id:choiceId(29),cursor:next});
  assert.ok(second.includes('<h2 id="recorded-runs-heading">Older recorded runs</h2>'));assert.ok(second.includes(`name="runId" value="${choiceId(29)}"`));
  assert.ok(second.includes('Newest recorded runs'));assert.ok(second.includes(`runId=${choiceId(9)}&amp;beforeCreatedAt=`));
  assert.ok(second.includes('Each page makes a new read'));assert.deepEqual(intents,[]);
});

test('incomplete cursors never read; changed continuation has a fresh restart and no partial choices',async()=>{
  const h=harness(),stamp='2026-10-05T09:00:00.000001Z';
  for(const value of [{beforeCreatedAt:stamp},{beforeRunId:choiceId(10)},{beforeCreatedAt:stamp,beforeRunId:[choiceId(10)]},
    {beforeCreatedAt:'PRIVATE_CANARY',beforeRunId:choiceId(10)},{beforeCreatedAt:stamp,beforeRunId:choiceId(10),limit:'100'}]){
    const html=await h.render(value);assert.ok(html.includes('The selection is invalid'));assert.ok(!html.includes('PRIVATE_CANARY'));}
  assert.deepEqual(h.calls,[]);
  const cursor={createdAt:stamp,runId:choiceId(10)},intents=[];
  const read=createOperatorAuditChoicesReader(async id=>bytes({schemaVersion:2,status:'changed',requestedRunId:id,requestedCursor:cursor}),undefined,code=>intents.push(code));
  const html=await harness('development',read).render({beforeCreatedAt:stamp,beforeRunId:cursor.runId});
  assert.ok(html.includes('Recorded run list changed'));assert.ok(html.includes('href="/editorial-preview/audit/select"'));assert.ok(!html.includes('<select'));assert.ok(!html.includes('Stored run state:'));assert.deepEqual(intents,[]);
});

test('actual choices page denies production and unknown mode before parameter access',async()=>{
  for(const mode of ['production','test','']){const h=harness(mode),poison=new Proxy({}, {get(){assert.fail('Request accessed');}});
    await assert.rejects(h.page(poison),error=>error===h.marker);assert.deepEqual(h.calls,[]);
    assert.equal(h.module.dynamic,'force-dynamic');assert.equal(h.module.runtime,'nodejs');assert.deepEqual(h.module.metadata.robots,{index:false,follow:false});}
});

test('unknown duplicate or invalid selection fields never read or echo their contents',async()=>{
  const h=harness();for(const value of [null,[],{runId:[choiceId(1),choiceId(1)]},{runId:null},{runId:''},{runId:'PRIVATE_CANARY'},
    {runId:choiceId(1),issueId:choiceId(30)},{extra:undefined},{sql:'PRIVATE_CANARY'},{runId:choiceId(1),cursor:'PRIVATE_CANARY'}]){
    const html=await h.render(value);assert.ok(html.includes('The selection is invalid'));assert.ok(!html.includes('PRIVATE_CANARY'));}
  const html=renderToStaticMarkup(await h.page({searchParams:Promise.reject(new Error('PRIVATE_CANARY'))}));assert.ok(html.includes('The selection is invalid'));assert.deepEqual(h.calls,[]);
});

test('actual overview and selected issue GET form bind exact checked data and lead to actual audit',async()=>{
  let choiceReads=0,auditReads=0;
  const read=createOperatorAuditChoicesReader(async id=>{choiceReads++;return bytes(choices(id));},undefined,()=>Promise.resolve());
  const readAudit=createOperatorAuditReader(async scope=>{auditReads++;assert.deepEqual(scope,{runId:choiceId(1),issueId:choiceId(30),cursor:null});
    const value=audit();value.requested={...scope};value.run.runId=scope.runId;value.history.issueId=scope.issueId;return bytes(value);},undefined,()=>Promise.resolve());
  const h=harness('development',read,readAudit),overview=await h.render({});
  assert.ok(overview.includes(`/editorial-preview/audit/select?runId=${choiceId(1)}`));assert.ok(!overview.includes('<select'));
  const selected=await h.render({runId:choiceId(1)});
  const form=selected.match(/<form[^>]+>/)?.[0];assert.ok(form);assert.ok(form.includes('method="get"'));assert.ok(form.includes('action="/editorial-preview/audit"'));
  const run=selected.match(/name="runId"[^>]*value="([^"]+)"/)[1],issue=selected.match(/<option value="([^"]+)"/)[1];
  assert.equal(run,choiceId(1));assert.equal(issue,choiceId(30));assert.ok(selected.includes('housing costs'));assert.ok(selected.includes('aria-current="true"'));
  assert.ok(selected.includes('Their presence does not mean this run updated or published them'));
  const opened=await h.audit({runId:run,issueId:issue});assert.ok(opened.includes('Recorded audit snapshot'));
  assert.equal(choiceReads,2);assert.equal(auditReads,1);assert.deepEqual(h.calls,[null,choiceId(1)]);
});

test('unconfigured unavailable empty absent and empty-issue states do not create success or selectable false data',async()=>{
  for(const [decision,text] of [[{kind:'unconfigured'},'not configured'],[{kind:'unavailable'},'not an empty or healthy result']]){
    const html=await harness('development',async()=>decision).render({});assert.ok(html.includes(text));assert.ok(!html.includes('<select'));}
  const h=harness(),empty={...choices(),runs:[]};assert.ok(h.view({kind:'ok',report:empty}).includes('No recorded runs returned'));
  const absent=choices(choiceId(99));assert.ok(h.view({kind:'ok',report:absent},choiceId(99)).includes('No matching recorded run'));
  const noIssues=choices(choiceId(1));noIssues.issues=[];const html=h.view({kind:'ok',report:noIssues},choiceId(1));assert.ok(html.includes('No issue dossiers returned'));assert.ok(!html.includes('<select'));
  assert.ok((await harness('development',async()=>{throw new Error('PRIVATE_CANARY');}).render({})).includes('Recorded choices unavailable'));
});

test('direct presenter withholds extended or mismatched data; bounded lists disclose more rows',()=>{
  const h=harness();for(const mutate of [r=>r.privateText='<script>PRIVATE_CANARY</script>',r=>r.issues[0].issueKey='<script>PRIVATE_CANARY</script>',r=>r.selectedRun=null]){
    const value=choices(choiceId(1));mutate(value);const html=h.view({kind:'ok',report:value},choiceId(1));assert.ok(html.includes('Recorded choices unavailable'));assert.ok(!html.includes('PRIVATE_CANARY'));assert.ok(!html.includes('<select'));}
  assert.ok(h.view({kind:'ok',report:choices(choiceId(1))},choiceId(2)).includes('Recorded choices unavailable'));
  const value=choices(choiceId(1));value.runs=Array.from({length:20},(_,i)=>({...value.runs[0],runId:choiceId(20-i)}));value.selectedRun={...value.runs.at(-1)};value.moreRuns=true;value.nextCursor={createdAt:value.runs.at(-1).createdAt,runId:value.runs.at(-1).runId};
  value.issues=Array.from({length:50},(_,i)=>({issueId:choiceId(100+i),issueKey:`issue-${String(i).padStart(2,'0')}`}));value.moreIssues=true;
  const html=h.view({kind:'ok',report:value},choiceId(1));assert.ok(html.includes('More older recorded runs are available'));assert.ok(html.includes('Only the first 50 issue keys'));assert.equal((html.match(/<option /g)||[]).length,50);
});

function links(html) {
  return [...html.matchAll(/href="([^"]+)"/g)].map(match=>new URL(match[1].replaceAll('&amp;','&'),'https://example.invalid'));
}
function freshSelection(html,runId) {
  const selected=links(html).filter(url=>url.pathname==='/editorial-preview/audit/select'&&url.searchParams.get('runId')===runId);
  assert.ok(selected.length>=2,'Both workspace and refresh must retain the independently selected run');
  for(const url of selected) assert.deepEqual([...url.searchParams], [['runId',runId]],'Recovery must discard old continuation');
  const refresh=html.match(/href="([^"]+)">Refresh recorded choices/);
  assert.ok(refresh);const url=new URL(refresh[1].replaceAll('&amp;','&'),'https://example.invalid');
  assert.deepEqual([...url.searchParams],[['runId',runId]]);
  assert.ok(links(html).some(url=>url.pathname==='/editorial-preview/held'&&url.searchParams.get('runId')===runId));
  assert.ok(!html.includes('<select'));assert.ok(!html.includes('Stored run state:'));
  assert.ok(!html.includes('#audit-sources-heading'));assert.ok(!html.includes('#audit-history-heading'));
  return url;
}

test('withheld actual choices pages retain independently selected run and clear older cursor across all recovery outcomes',async()=>{
  const run=choiceId(29),cursor={createdAt:'2026-10-05T09:00:00.000001Z',runId:choiceId(10)};
  for(const kind of ['unconfigured','unavailable','changed','throws']) {
    const reads=[];const h=harness('development',async(id,_signal,before)=>{
      reads.push({id,before});if(kind==='throws')throw Error('PRIVATE_REJECTED_RECORD');return {kind};
    });
    const html=await h.render({runId:run,beforeCreatedAt:cursor.createdAt,beforeRunId:cursor.runId});
    freshSelection(html,run);assert.deepEqual(reads,[{id:run,before:cursor}]);
    assert.ok(!html.includes('PRIVATE_REJECTED_RECORD'));assert.ok(!html.includes(cursor.createdAt));
    assert.ok(!html.includes(cursor.runId));assert.equal((html.match(/aria-current="location"/g)||[]).length,1);
  }
});

test('following the actual fresh recovery GET preserves the run and restores independently checked issue choices',async()=>{
  const run=choiceId(1),cursor={createdAt:'2026-10-05T09:00:00.000001Z',runId:choiceId(10)},seen=[];
  const h=harness('development',async(id,_signal,before)=>{
    seen.push({id,before});return before===null?{kind:'ok',report:choices(id)}:{kind:'changed'};
  });
  const held=await h.render({runId:run,beforeCreatedAt:cursor.createdAt,beforeRunId:cursor.runId});
  const url=freshSelection(held,run),recovered=await h.render(Object.fromEntries(url.searchParams));
  assert.deepEqual(seen,[{id:run,before:cursor},{id:run,before:null}]);
  assert.ok(recovered.includes(`name="runId" value="${run}"`));assert.ok(recovered.includes('<select'));
  assert.ok(recovered.includes('Their presence does not mean this run updated or published them'));
});

test('refused direct choices payloads never supply rejected scope, issue controls or private wording to recovery',()=>{
  const h=harness(),run=choiceId(99),other=choiceId(1),cursor={createdAt:'2026-10-05T09:00:00.000001Z',runId:choiceId(10)};
  for(const value of [choices(other),{...choices(other),privateText:'PRIVATE_REJECTED_RECORD'}]) {
    const html=h.view({kind:'ok',report:value},run,cursor);
    freshSelection(html,run);assert.ok(!html.includes(other));assert.ok(!html.includes(choiceId(30)));
    assert.ok(!html.includes('housing costs'));assert.ok(!html.includes('PRIVATE_REJECTED_RECORD'));
  }
});

test('invalid direct selection or cursor and invalid_scope never supply run-scoped recovery even with a plausible report',()=>{
  const h=harness(),run=choiceId(1),stamp='2026-10-05T09:00:00.000001Z';
  const invalidSelections=['PRIVATE_SELECTION',[run],{runId:run},'A0000000-0000-4000-8000-000000000001',' '+run];
  const invalidCursors=[{createdAt:stamp},{runId:choiceId(10)},{createdAt:stamp,runId:choiceId(10),extra:'PRIVATE_CURSOR'},[],{createdAt:'PRIVATE_CURSOR',runId:choiceId(10)}];
  for(const [decision,selection,cursor] of [
    ...invalidSelections.map(selection=>[{kind:'unavailable'},selection,null]),
    ...invalidCursors.map(cursor=>[{kind:'changed'},run,cursor]),
    [{kind:'invalid_scope'},run,null],
    [{kind:'invalid_scope',report:choices(run)},run,{createdAt:stamp,runId:choiceId(10)}],
  ]) {
    const html=h.view(decision,selection,cursor);
    for(const url of links(html))assert.equal(url.searchParams.has('runId'),false);
    assert.ok(!html.includes('PRIVATE_'));assert.ok(!html.includes('<select'));
  }
});

test('missing recovery selection stays an overview and checked success retains its existing selected-run semantics',()=>{
  const h=harness();
  for(const kind of ['unconfigured','unavailable','changed']) {
    const html=h.view({kind});for(const url of links(html))assert.equal(url.searchParams.has('runId'),false);
  }
  const value=choices(choiceId(1)),html=h.view({kind:'ok',report:value});
  assert.ok(html.includes('<select'));assert.ok(html.includes(`name="runId" value="${choiceId(1)}"`));
  assert.ok(!html.includes('Refresh recorded choices'));
  const absent=h.view({kind:'ok',report:choices(choiceId(99))},choiceId(99));
  assert.ok(absent.includes('No matching recorded run'));assert.ok(!absent.includes('/editorial-preview/held?'));
});
