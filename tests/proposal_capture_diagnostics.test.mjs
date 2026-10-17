import assert from 'node:assert/strict';import test from 'node:test';
import {readFileSync} from 'node:fs';import {mkdtemp,readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';import {createRequire} from 'node:module';
import ts from 'typescript';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {diagnosticCodes,diagnosticCodesV6,makeDiagnosticEvent,diagnosticEventSchema} from '../src/error-diagnostics.ts';
import {buildDiagnosticReport,parseDiagnosticReport,diagnosticSelection,selectDiagnosticEvents} from '../src/diagnostic-report.ts';
import {readDiagnosticExport} from '../src/diagnostic-import.ts';import {createDiagnosticIntake} from '../src/server/error-log-intake.ts';
import {createClientErrorReporter} from '../src/client-error-diagnostics.ts';import {createDevelopmentErrorRecorder} from '../src/server/error-diagnostics.ts';
import {ErrorLogStore} from '../src/server/error-log-store.ts';import {exportErrorLog} from '../scripts/export_error_log.mjs';
import {createPostgresWorkProposalTransport} from '../src/server/postgres-work-proposal-transport.ts';
import {proposalId,proposalReport} from './helpers/proposal_fixture.mjs';
const code='proposal_capture_write',fixed=new Date('2026-10-06T09:00:00.000Z');
const event=()=>makeDiagnosticEvent(code,proposalId(90),fixed),decode=x=>readDiagnosticExport(new TextEncoder().encode(JSON.stringify(x)).buffer);
test('genuine prior-emitter fictional v6 report and exact v1-v5 archives normalize without rewriting or reattributing',()=>{
 assert.equal(Object.keys(diagnosticCodesV6).length,24);assert.equal(Object.keys(diagnosticCodes).length,34);
 for(let v=1;v<=6;v++){
  const path=new URL(`../fixtures/diagnostics/report-v${v}.sample.json`,import.meta.url),raw=readFileSync(path),old=JSON.parse(raw),current=decode(old);
  assert.equal(current.schemaVersion,9);assert.equal(current.exportedAt,old.exportedAt);assert.deepEqual(current.events,old.events);assert.equal(current.counts[code],0);
  for(const [key,value] of Object.entries(old.counts))assert.equal(current.counts[key],value);
  assert.equal(current.captureCompleteness,'unknown');assert.equal(current.buildBinding,'not_bound_to_a_deployed_build');assert.deepEqual(readFileSync(path),raw);
  if(v===6){assert.deepEqual(old.locations,diagnosticCodesV6);assert.equal(old.events[0].code,'public_issue_read');assert.equal(old.events[0].eventId,'89000000-0000-4000-8000-000000000001');}
  assert.throws(()=>decode({...old,events:[event()],filesObserved:1}));assert.throws(()=>decode({...old,schemaVersion:7}));
 }
});
test('v8 exact catalogue, counts, privacy and uncertainty are checked by parser and import seam',()=>{
 const report=buildDiagnosticReport({events:[event()],filesObserved:1,unreadable:0,stable:true,locked:false},fixed);assert.deepEqual(decode(report),report);
 const missingCount=structuredClone(report);delete missingCount.counts[code];const missingLocation=structuredClone(report);delete missingLocation.locations[code];
 for(const bad of [missingCount,missingLocation,{...report,schemaVersion:6},{...report,schemaVersion:10},{...report,private:'PRIVATE_CANARY'},
  {...report,events:[{...event(),message:'PRIVATE_BODY'}]},{...report,counts:{...report.counts,[code]:0}},{...report,locations:{...report.locations,[code]:{origin:'server',location:'PRIVATE_PATH'}}}])for(const fn of [parseDiagnosticReport,decode])assert.throws(()=>fn(bad));
 for(const patch of [{locked:true,inspectionComplete:false},{filesObserved:2,unreadableFiles:1,inspectionComplete:false}]){const current=decode({...report,...patch});for(const [k,v]of Object.entries(patch))assert.equal(current[k],v);assert.equal(current.captureCompleteness,'unknown');}
 const missing=decode(buildDiagnosticReport(null,fixed));assert.equal(missing.archiveState,'missing');assert.equal(missing.inspectionComplete,false);assert.equal(missing.counts[code],0);
});
test('new fixed event is server-only, retains five fields and cannot be persisted by browser intake or production logging',async()=>{
 const value=event();assert.deepEqual(Object.keys(value).sort(),['code','eventId','occurredAt','origin','schemaVersion']);assert.equal(value.origin,'server');assert.equal(value.schemaVersion,1);
 for(const patch of [{origin:'browser'},{origin:'worker'},{stack:'PRIVATE_STACK'},{runId:proposalId(1)}])assert.equal(diagnosticEventSchema.safeParse({...value,...patch}).success,false);
 const intake=createDiagnosticIntake(()=>assert.fail('browser persisted server event'));
 const req=new Request('http://127.0.0.1:3000/api/dev/error-log',{method:'POST',headers:{origin:'http://127.0.0.1:3000','sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({code,eventId:value.eventId})});assert.equal((await intake(req,'development')).status,400);
 assert.equal(await createClientErrorReporter('development',()=>assert.fail('browser dispatch'))(code),null);
 assert.equal(await createDevelopmentErrorRecorder(()=>assert.fail('production sink'),()=> 'production')(code),'unavailable');
});
test('actual failed transport flows through private store, export, import, filtering and rendered records without raw error data',async t=>{
 const parent=await mkdtemp('/tmp/terrafracta-proposal-diagnostic-'),directory=join(parent,'log'),store=new ErrorLogStore(directory);let done;
 const saved=new Promise(resolve=>{done=resolve;}),recorder=createDevelopmentErrorRecorder(e=>store.append(e),()=> 'development');
 const transport=createPostgresWorkProposalTransport({host:'db.example.org',port:5432,database:'terra_private',user:'fictional_worker',password:'PRIVATE_PASSWORD',transport:{kind:'verified-tls'}},async()=>{throw Error('PRIVATE_SQL_BODY');},undefined,async c=>{const value=await recorder(c);done(value);return value;});
 assert.deepEqual(await transport.capture({runId:proposalId(1),requestFingerprint:'a'.repeat(64),workClaimId:proposalId(51)},
  {captureId:proposalId(8),runId:proposalId(1),decisionId:proposalId(2),issueId:proposalId(7),basePublicationId:proposalId(6)},JSON.parse(proposalReport().capture.proposalJson),new AbortController().signal),{kind:'not_dispatched'});
 assert.equal(await saved,'saved');assert.equal(await transport.shutdown(),true);const output=join(parent,'export.json');await exportErrorLog(directory,output);
 const raw=await readFile(output),report=readDiagnosticExport(new Uint8Array(raw).buffer);assert.equal(report.schemaVersion,9);assert.equal(report.counts[code],1);assert.equal(report.events.length,1);assert.doesNotMatch(raw.toString(),/PRIVATE_|fictional_worker|invented-country|87000000|stack|sha256/);
 const selected=selectDiagnosticEvents(report,diagnosticSelection({code,origin:'server',ref:report.events[0].eventId}));assert.equal(selected.total,1);assert.equal(selected.groups[0].location,'private proposals / capture work-bound content');
 const source=new URL('../src/diagnostic-records-view.tsx',import.meta.url),native=createRequire(source),exports={};const compiled=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','exports',compiled)(native,exports);
 const html=renderToStaticMarkup(createElement(exports.DiagnosticRecords,{events:selected.events,page:selected.page}));assert.ok(html.includes(selected.groups[0].location));assert.ok(html.includes(report.events[0].eventId));assert.equal((await lstat(directory)).mode&0o777,0o700);assert.equal((await lstat(output)).mode&0o777,0o600);
 t.diagnostic(JSON.stringify({ownedTemporaryDirectory:parent,privateExport:output,events:1}));
});
