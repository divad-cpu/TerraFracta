import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSelectedAppendedCaptureReader as plain} from '../src/server/appended-capture-selection.ts';
import {createSelectedHtmlAppendedCaptureReader as html} from '../src/server/html-appended-capture-selection.ts';
import {prepareAppendedCaptureLookup} from '../src/server/appended-capture-lookup.ts';
import {htmlCaptureFixture} from './helpers/html_capture_transport_fixture.mjs';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
function plainFixture(){
 const f=JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-capture.json',import.meta.url),'utf8'));
 const native=JSON.parse(f.rawReceiptJson),report=Buffer.from(native.parts_base64[0],'base64').toString('utf8'),r=JSON.parse(report);
 const expected={reportSha256:sha(report),preparationIntentJson:r.intent_json},c=prepareAppendedCaptureLookup(report,expected,f.observedAt);
 const meta={schema_version:1,kind:'invented_appended_capture_lookup',scope:{...c.scope},principal:'postgres',session_principal:'postgres',transaction_isolation:'repeatable read',transaction_read_only:true,preparation_matched:true,observed_at:f.observedAt,matches:[{capture_id:native.capture_id,preparation_operation_id:native.preparation_operation_id,stored_at:native.stored_at,intent_sha256:sha(f.retainedIntentJson)}]};
 const input={preparationReportJson:report,preparationReportSha256:sha(report),preparationIntentJson:r.intent_json,lookupRaw:Buffer.from(JSON.stringify(meta)),captureId:native.capture_id,captureIntentJson:f.retainedIntentJson,observedAt:f.observedAt};
 return {selection:input,raw:Buffer.from(f.rawReceiptJson)};
}
for(const [name,create,fixture]of[['plain',plain,plainFixture],['HTML',html,htmlCaptureFixture]]){
 test(name+' appended physical read inherits original remaining selector interval',async t=>{
  const f=fixture();let clock=0,reads=0;const delays=[],original=setTimeout;
  t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>{delays.push(delay);return original(fn,delay,...args);});
  const input=new Proxy(f.selection,{getOwnPropertyDescriptor(target,key){clock=750;return Reflect.getOwnPropertyDescriptor(target,key);}});
  const result=await create(async()=>{reads++;return f.raw;},()=>clock,async()=>assert.fail('No diagnostic'))(input);
  assert.equal(result.kind,'ok');assert.equal(reads,1);assert.deepEqual(delays,[2250]);
 });
}
