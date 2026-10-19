import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSelectedAppendedCaptureReader as plain} from '../src/server/appended-capture-selection.ts';
import {createSelectedHtmlAppendedCaptureReader as html} from '../src/server/html-appended-capture-selection.ts';
import {createSelectedPdfAppendedCaptureReader as pdf} from '../src/server/pdf-appended-capture-selection.ts';
import {createSelectedInitialCandidateCaptureReader as initial} from '../src/server/initial-candidate-capture-selection.ts';
import {prepareAppendedCaptureLookup} from '../src/server/appended-capture-lookup.ts';
import {prepareInitialCandidateLookup} from '../src/server/initial-candidate-lookup.ts';
import {htmlCaptureFixture} from './helpers/html_capture_transport_fixture.mjs';
import {pdfLookupFixture} from './helpers/pdf_owner_fixture.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
function plainFixture(){
 const f=JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-capture.json',import.meta.url),'utf8')),n=JSON.parse(f.rawReceiptJson),raw=Buffer.from(n.parts_base64[0],'base64').toString('utf8'),report=JSON.parse(raw),expected={reportSha256:sha(raw),preparationIntentJson:report.intent_json},c=prepareAppendedCaptureLookup(raw,expected,f.observedAt);
 const meta={schema_version:1,kind:'invented_appended_capture_lookup',scope:c.scope,principal:'postgres',session_principal:'postgres',transaction_isolation:'repeatable read',transaction_read_only:true,preparation_matched:true,observed_at:f.observedAt,matches:[{capture_id:n.capture_id,preparation_operation_id:n.preparation_operation_id,stored_at:n.stored_at,intent_sha256:sha(f.retainedIntentJson)}]};
 return {raw:Buffer.from(f.rawReceiptJson),selection:{preparationReportJson:raw,preparationReportSha256:sha(raw),preparationIntentJson:report.intent_json,lookupRaw:Buffer.from(JSON.stringify(meta)),captureId:n.capture_id,captureIntentJson:f.retainedIntentJson,observedAt:f.observedAt}};
}
function initialFixture(){
 const f=JSON.parse(readFileSync(new URL('../fixtures/fictional-initial-candidate-capture.json',import.meta.url),'utf8')),n=JSON.parse(f.rawReceiptJson),raw=Buffer.from(n.report_base64,'base64').toString('utf8'),expected={...f.preparationExpected},at='2026-10-16T11:16:21.000000Z',c=prepareInitialCandidateLookup(raw,expected,at);
 const meta={schema_version:1,kind:'invented_initial_candidate_lookup',scope:c.scope,principal:'postgres',session_principal:'postgres',transaction_isolation:'repeatable read',transaction_read_only:true,preparation_matched:true,observed_at:at,matches:[{capture_id:f.id,preparation_operation_id:n.preparation_operation_id,stored_at:n.stored_at,intent_sha256:sha(f.retainedIntentJson)}]};
 return {raw:Buffer.from(f.rawReceiptJson),selection:{preparationReportJson:raw,preparationExpected:expected,lookupRaw:Buffer.from(JSON.stringify(meta)),lookupObservedAt:at,captureId:f.id,captureIntentJson:f.retainedIntentJson,captureObservedAt:'2026-10-16T11:16:21.000001Z'}};
}
const families=[['plain appended',plain,plainFixture],['HTML appended',html,htmlCaptureFixture],['PDF appended',pdf,pdfLookupFixture],['plain initial',initial,initialFixture]];
for(const [name,create,fixture]of families){
 for(const age of [3000,-1])test(name+' descriptor elapsed '+age+' cannot reset original entry clock',async()=>{
  const f=fixture();let clock=0,reads=0,traps=0;
  const input=new Proxy(f.selection,{getOwnPropertyDescriptor(target,key){traps++;clock=age;return Reflect.getOwnPropertyDescriptor(target,key);}});
  const result=await create(async()=>{reads++;return f.raw;},()=>clock,async()=> 'saved')(input);
  assert.ok(traps>0);assert.equal(result.kind,'unavailable');assert.equal(reads,0);
 });
 test(name+' pre-aborted entry never touches caller descriptor traps',async()=>{
  const f=fixture(),parent=new AbortController();parent.abort();let traps=0,clocks=0,reads=0;
  const input=new Proxy(f.selection,{getOwnPropertyDescriptor(target,key){traps++;return Reflect.getOwnPropertyDescriptor(target,key);}});
  assert.deepEqual(await create(async()=>{reads++;return f.raw;},()=>{clocks++;return 0;},async()=> 'saved')(input,parent.signal),{kind:'unavailable'});
  assert.equal(traps,0);assert.equal(clocks,0);assert.equal(reads,0);
 });
 test(name+' original in-budget descriptor work remains permitted',async()=>{
  const f=fixture();let clock=0,reads=0;
  const input=new Proxy(f.selection,{getOwnPropertyDescriptor(target,key){clock=1;return Reflect.getOwnPropertyDescriptor(target,key);}});
  const result=await create(async()=>{reads++;return f.raw;},()=>clock,async()=> 'saved')(input);
  assert.equal(result.kind,'ok');assert.equal(reads,1);
 });
}
