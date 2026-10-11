import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sample } from './helpers/public_read_rows_fixture.mjs';
import { createPublicIssueReader, createDevelopmentPublicIssueHandler, DEVELOPMENT_READ_TIMEOUT_MS, PUBLIC_CANDIDATE_BYTES } from '../src/server/public-issue-reader.ts';
import { createCurrentIssueStatusHandler } from '../src/server/current-issue-status.ts';
import { diagnosticCodes, diagnosticCodesV5, diagnosticEventSchema, makeDiagnosticEvent } from '../src/error-diagnostics.ts';
import { buildDiagnosticReport, parseDiagnosticReport, diagnosticSelection, selectDiagnosticEvents } from '../src/diagnostic-report.ts';
import { readDiagnosticExport } from '../src/diagnostic-import.ts';
import { ErrorLogStore } from '../src/server/error-log-store.ts';
import { createDevelopmentErrorRecorder } from '../src/server/error-diagnostics.ts';
import { createDiagnosticIntake } from '../src/server/error-log-intake.ts';
import { createClientErrorReporter } from '../src/client-error-diagnostics.ts';
import { exportErrorLog } from '../scripts/export_error_log.mjs';

const code='public_issue_read', held={status:503,cacheControl:'no-store'};
const route=sample().requestedRoute, bytes=value=>new TextEncoder().encode(JSON.stringify(value));
const turn=()=>new Promise(done=>setImmediate(done));
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const context=()=>({params:Promise.resolve({country:route.jurisdictionSlug,issue:route.issueSlug})});
const request=(kind,signal)=>new Request(`http://127.0.0.1:3000/api/dev/${kind}/${route.jurisdictionSlug}/${route.issueSlug}`,{headers:{'sec-fetch-site':'same-origin'},signal});

test('provider, raw-wire, decoder and route-binding faults emit exactly one fixed code with no error or request data',async()=>{
 const providers=[async()=>{throw Error('PRIVATE_PROVIDER_CANARY');}, async()=> 'PRIVATE_RAW_CANARY',
  async()=>new Uint8Array(3),async()=>new Uint8Array(PUBLIC_CANDIDATE_BYTES+1),
  async()=>new Uint8Array([255,255,255,255]),async()=>new TextEncoder().encode('{bad')];
 for(const provider of providers){const calls=[];assert.deepEqual(await createPublicIssueReader(provider,undefined,async(...args)=>{calls.push(args);return 'saved';})(route),held);await turn();assert.deepEqual(calls,[[code]]);}
 const calls=[];assert.deepEqual(await createPublicIssueReader(async()=>bytes(sample()),undefined,async(...args)=>{calls.push(args);return 'saved';})({...route,issueSlug:'another-issue'}),held);
 await turn();assert.deepEqual(calls,[[code]]);
});

test('invalid/unconfigured/absent and rejected rights/editorial/head candidates remain silent ordinary results',async()=>{
 const record=()=>assert.fail('ordinary result logged');
 assert.deepEqual(await createPublicIssueReader(undefined,undefined,record)(route),held);
 assert.equal((await createPublicIssueReader(()=>assert.fail('invalid dispatch'),undefined,record)({})).status,404);
 assert.equal((await createPublicIssueReader(async()=>bytes(null),undefined,record)(route)).status,404);
 for(const transform of [value=>value.sources[0].registration.allow_public_derived=false,value=>value.head.current_publication_id='ffffffff-ffff-4fff-8fff-ffffffffffff',value=>value.dossier.editorial_state='withheld']){
  const value=sample();transform(value);assert.deepEqual(await createPublicIssueReader(async()=>bytes(value),undefined,record)(route),held);
 }
 assert.deepEqual(await createPublicIssueReader(async()=>bytes({candidate_state:'rejected'}),undefined,record)(route),held);
 assert.equal((await createPublicIssueReader(async()=>bytes(sample()),undefined,record)(route)).status,200);await turn();
});

test('initial and later thrown/invalid/regressing clocks hold and report once',async()=>{
 for(const values of [[NaN],[()=>{throw Error('PRIVATE_CLOCK_CANARY');}],[0,NaN],[0,-1],[0,3000],[0,0,3000],[0,()=>{throw Error('PRIVATE_CLOCK_CANARY');}]]){
  const calls=[];let reads=0;const clock=()=>{const value=values.shift();return typeof value==='function'?value():value;};
  assert.deepEqual(await createPublicIssueReader(async()=>{reads++;return bytes(sample());},clock,async(...args)=>{calls.push(args);return 'saved';})(route),held);
  await turn();assert.deepEqual(calls,[[code]]);assert.ok(reads<=1);
 }
});

test('owned development deadline aborts the child and reports one technical fault',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const calls=[];let child;
 const pending=createPublicIssueReader(async(_route,signal)=>{child=signal;return new Promise(()=>{});},()=>0,async(...args)=>{calls.push(args);return 'saved';})(route);
 await Promise.resolve();t.mock.timers.tick(DEVELOPMENT_READ_TIMEOUT_MS);assert.deepEqual(await pending,held);await turn();
 assert.equal(child.aborted,true);assert.deepEqual(calls,[[code]]);
});

test('preabort and prompt midflight cancellation consume late success/failure without diagnostics',async()=>{
 const record=()=>assert.fail('caller cancellation logged');const pre=new AbortController();pre.abort();
 assert.deepEqual(await createPublicIssueReader(()=>assert.fail('preabort dispatch'),undefined,record)(route,pre.signal),held);
 for(const late of ['success','failure']){
  const wait=deferred(),parent=new AbortController();let settled=false,child;
  const pending=createPublicIssueReader(async(_route,signal)=>{child=signal;return wait.promise;},undefined,record)(route,parent.signal).then(value=>{settled=true;return value;});
  await turn();parent.abort();await turn();assert.equal(settled,true);assert.deepEqual(await pending,held);assert.equal(child.aborted,true);
  if(late==='success')wait.resolve(bytes(sample()));else wait.reject(Error('PRIVATE_LATE_CANARY'));await turn();
 }
});

test('concurrent current reads retain separate fault/cancellation ownership and fresh recovery',async()=>{
 const waits=[deferred(),deferred()],calls=[];let index=0;
 const read=createPublicIssueReader(async()=>waits[index++].promise,undefined,async(...args)=>{calls.push(args);return 'saved';});
 const parent=new AbortController(),a=read(route,parent.signal),b=read(route);await turn();parent.abort();
 assert.deepEqual(await a,held);waits[1].reject(Error('PRIVATE_ACTIVE_CANARY'));assert.deepEqual(await b,held);
 waits[0].reject(Error('PRIVATE_RETIRED_CANARY'));await turn();assert.deepEqual(calls,[[code]]);
 assert.equal((await createPublicIssueReader(async()=>bytes(sample()),undefined,()=>assert.fail('recovery fault'))(route)).status,200);
});

test('throwing, rejecting and stalled recorders cannot mask or delay the closed current read',async()=>{
 for(const record of [()=>{throw Error('PRIVATE_LOGGER_CANARY');},()=>Promise.reject(Error('PRIVATE_LOGGER_CANARY')),()=>new Promise(()=>{})]){
  assert.deepEqual(await createPublicIssueReader(async()=>{throw Error('PRIVATE_PROVIDER_CANARY');},undefined,record)(route),held);await turn();
 }
});

test('actual issue and status handlers preserve one lower-reader diagnostic and catch adapter exceptions silently on cancellation',async()=>{
 for(const [create,kind] of [[createDevelopmentPublicIssueHandler,'public-issue'],[createCurrentIssueStatusHandler,'current-issue-status']]){
  const calls=[],record=async(...args)=>{calls.push(args);return 'saved';};
  const read=createPublicIssueReader(async()=>{throw Error('PRIVATE_PROVIDER_CANARY');},undefined,record);
  const handler=create(read,record),response=await handler(request(kind),context(),'development');assert.equal(response.status,503);await turn();assert.deepEqual(calls,[[code]]);
  const direct=[];assert.equal((await create(async()=>{throw Error('PRIVATE_ADAPTER_CANARY');},async(...args)=>{direct.push(args);return 'saved';})(request(kind),context(),'development')).status,503);await turn();assert.deepEqual(direct,[[code]]);
  const parent=new AbortController();const cancelled=create(async()=>{parent.abort();throw Error('PRIVATE_CANCEL_CANARY');},()=>assert.fail('cancellation logged'));
  assert.equal((await cancelled(request(kind,parent.signal),context(),'development')).status,503);await turn();
  assert.equal((await handler(new Proxy({}, {get(){assert.fail('production request accessed');}}),new Proxy({}, {get(){assert.fail('production params accessed');}}),'production')).status,404);
 }
});

test('exact historical v1-v5 exports remain unchanged; report v8 rejects mixed, partial and future contracts',()=>{
 const fixed=new Date('2026-10-05T18:49:00.000Z'),event=makeDiagnosticEvent(code,'00000000-0000-4000-8000-000000000001',fixed);
 assert.equal(Object.keys(diagnosticCodesV5).length,23);assert.equal(Object.keys(diagnosticCodes).length,33);
 for(let version=1;version<=5;version++){
  const path=new URL(`../fixtures/diagnostics/report-v${version}.sample.json`,import.meta.url),original=readFileSync(path),old=JSON.parse(original),value=parseDiagnosticReport(old);
  assert.equal(value.schemaVersion,8);assert.equal(value.counts[code],0);assert.deepEqual(value.events,old.events);assert.equal(value.captureCompleteness,'unknown');assert.equal(value.buildBinding,'not_bound_to_a_deployed_build');
  assert.deepEqual(readFileSync(path),original);assert.throws(()=>parseDiagnosticReport({...old,events:[event],filesObserved:1}));
  assert.throws(()=>parseDiagnosticReport({...old,schemaVersion:6}));
  if(version===5)assert.equal(createHash('sha256').update(original).digest('hex'),'c3cd8670d3aad9e87adac05943d82a8cdbe68af3286ee9e542f275f8d1825ca9');
 }
 const report=buildDiagnosticReport({events:[event],filesObserved:1,unreadable:0,stable:true,locked:false},fixed);
 assert.deepEqual(parseDiagnosticReport(report),report);
 const noCount=structuredClone(report);delete noCount.counts[code];const noLocation=structuredClone(report);delete noLocation.locations[code];
 const wrongLabel=structuredClone(report);wrongLabel.locations[code].location='PRIVATE_LABEL_CANARY';
 for(const bad of [noCount,noLocation,wrongLabel,{...report,schemaVersion:5},{...report,schemaVersion:9}])assert.throws(()=>parseDiagnosticReport(bad));
 for(const changes of [{locked:true,inspectionComplete:false},{unreadableFiles:1,filesObserved:2,inspectionComplete:false},{archiveState:'missing',events:[],counts:Object.fromEntries(Object.keys(report.counts).map(key=>[key,0])),filesObserved:0,inspectionComplete:false}]){
  const value=parseDiagnosticReport({...report,...changes});for(const key of Object.keys(changes))assert.deepEqual(value[key],changes[key]);assert.equal(value.captureCompleteness,'unknown');
 }
});

test('the server-only fixed code is refused by browser intake, client reporting and production persistence',async()=>{
 let writes=0,sends=0;const intake=createDiagnosticIntake(async()=>{writes++;return 'saved';});
 const event=makeDiagnosticEvent(code,'00000000-0000-4000-8000-000000000001');
 for(const bad of [{...event,origin:'browser'},{...event,origin:'worker'},{...event,stack:'PRIVATE_CANARY'}])assert.equal(diagnosticEventSchema.safeParse(bad).success,false);
 const req=new Request('http://127.0.0.1:3000/api/dev/error-log',{method:'POST',headers:{origin:'http://127.0.0.1:3000','sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({eventId:event.eventId,code})});
 assert.equal((await intake(req,'development')).status,400);assert.equal(writes,0);
 assert.equal(await createClientErrorReporter('development',async()=>{sends++;return new Response(null,{status:204});})(code),null);assert.equal(sends,0);
 assert.equal(await createDevelopmentErrorRecorder(()=>assert.fail('production sink accessed'),()=> 'production')(code),'unavailable');
});

test('actual current-status read persists its fixed identity through private export, import, filtering and React view', {timeout:3000},async t=>{
 const parent=await mkdtemp('/tmp/terrafracta-public-reader-diagnostic-'),directory=join(parent,'log'),store=new ErrorLogStore(directory);
 const wait=deferred(),record=createDevelopmentErrorRecorder(event=>store.append(event),()=> 'development');
 const save=async value=>{const result=await record(value);wait.resolve(result);return result;};
 const handler=createCurrentIssueStatusHandler(createPublicIssueReader(async()=>{throw Error('PRIVATE_SQL_PATH_CANARY');},undefined,save),save);
 const response=await handler(request('current-issue-status'),context(),'development');assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(await wait.promise,'saved');
 const output=join(parent,'export.json');await exportErrorLog(directory,output);const raw=await readFile(output),report=readDiagnosticExport(new Uint8Array(raw).buffer);
 assert.equal(report.schemaVersion,8);assert.equal(report.events.length,1);assert.equal(report.counts[code],1);assert.doesNotMatch(raw.toString(),/PRIVATE_|password|stack|sample-issue/);
 assert.deepEqual(Object.keys(report.events[0]).sort(),['code','eventId','occurredAt','origin','schemaVersion']);
 const selection=diagnosticSelection({code,origin:'server'}),selected=selectDiagnosticEvents(report,selection);assert.equal(selected.total,1);assert.equal(selected.groups[0].location,'current issue / read checked publication');
 const source=new URL('../src/diagnostic-records-view.tsx',import.meta.url),native=createRequire(source),exports={};
 const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',compiled)(native,exports);
 const html=renderToStaticMarkup(createElement(exports.DiagnosticRecords,{events:selected.events,page:selected.page}));assert.ok(html.includes(selected.groups[0].location));assert.ok(html.includes(report.events[0].eventId));
 assert.equal((await lstat(directory)).mode&0o777,0o700);assert.equal((await lstat(output)).mode&0o777,0o600);
 t.diagnostic(JSON.stringify({ownedTemporaryDirectory:parent,privateExport:output,events:1}));
});
