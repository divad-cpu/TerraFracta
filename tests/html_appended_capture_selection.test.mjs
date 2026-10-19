import assert from 'node:assert/strict';import test from 'node:test';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {createSelectedHtmlAppendedCaptureReader,readSelectedHtmlAppendedCapture} from '../src/server/html-appended-capture-selection.ts';
import {HTML_APPENDED_CAPTURE_READ_SQL} from '../src/server/html-appended-issue-capture.ts';
import {htmlCaptureFixture as fixture,hash} from './helpers/html_capture_transport_fixture.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('explicit HTML selection reads one fixed full capture and joins the exact historical preparation',async()=>{
 const f=fixture(),calls=[];const result=await createSelectedHtmlAppendedCaptureReader(async c=>{calls.push(c);return f.raw;},()=>0,async()=>assert.fail('No diagnostic'))(f.selection);
 assert.equal(result.kind,'ok');assert.equal(result.selected.captureId,f.native.capture_id);assert.equal(result.stored.receiptSha256,hash(f.raw));assert.deepEqual(calls,[{sql:HTML_APPENDED_CAPTURE_READ_SQL,values:[f.native.capture_id]}]);assert.match(result.evidenceState,/not_current_work_or_publication/);
 assert.deepEqual(await readSelectedHtmlAppendedCapture(f.selection),{kind:'unconfigured'});
});
test('HTML selection never chooses a candidate or manufactures independent intent from lookup metadata',async()=>{
 const f=fixture();let calls=0;const read=createSelectedHtmlAppendedCaptureReader(()=>{calls++;assert.fail('No provider');},()=>0);
 for(const input of [null,{},Object.create(f.selection),{...f.selection,captureId:undefined},{...f.selection,captureIntentJson:undefined},{...f.selection,extra:true},{...f.selection,[Symbol('extra')]:true},{...f.selection,captureId:'00000000-0000-4000-8000-000000000999'},{...f.selection,preparationIntentJson:'{}'}])assert.deepEqual(await read(input),{kind:'invalid_scope'});
 const changing={...f.selection};Object.defineProperty(changing,'captureId',{enumerable:true,get(){changing.extra=true;return f.native.capture_id;}});assert.deepEqual(await read(changing),{kind:'invalid_scope'});assert.equal(calls,0);
});
test('a legitimate empty lookup is not_found and never triggers the full reader',async()=>{
 const f=fixture();f.lookup.matches=[];f.selection.lookupRaw=Buffer.from(JSON.stringify(f.lookup));assert.deepEqual(await createSelectedHtmlAppendedCaptureReader(()=>assert.fail('No provider'),()=>0)(f.selection),{kind:'not_found'});
});
test('same capture with a changed metadata store timestamp is withheld after complete read',async()=>{
 const f=fixture();f.lookup.matches[0].stored_at='2026-10-18T02:00:19.000001Z';f.selection.lookupRaw=Buffer.from(JSON.stringify(f.lookup));let calls=0;
 assert.deepEqual(await createSelectedHtmlAppendedCaptureReader(async()=>{calls++;return f.raw;},()=>0,async()=> 'saved')(f.selection),{kind:'changed'});assert.equal(calls,1);
});
test('independent preparation full-receipt mismatch remains changed even when operation artifact and intent match',async()=>{
 const f=fixture(),report=structuredClone(f.report);report.preparation.receipt_sha256='0'.repeat(64);
 const raw=canonical(report);f.selection.preparationReportJson=raw;f.selection.preparationReportSha256=hash(raw);
 assert.deepEqual(await createSelectedHtmlAppendedCaptureReader(async()=>f.raw,()=>0,async()=> 'saved')(f.selection),{kind:'changed'});
});
test('selected scalar inputs and native lookup bytes cannot be replaced after async dispatch',async()=>{
 const f=fixture();let release;const pending=createSelectedHtmlAppendedCaptureReader(()=>new Promise(r=>{release=r;}),()=>0,async()=> 'saved')(f.selection);
 await tick();f.selection.lookupRaw.fill(0);f.selection.captureId='00000000-0000-4000-8000-000000000999';f.selection.captureIntentJson='{}';release(f.raw);
 assert.equal((await pending).kind,'ok');
});
test('cancellation during inner cleanup and final original-interval expiry withhold selected private material',async()=>{
 const f=fixture(),parent=new AbortController();const read=createSelectedHtmlAppendedCaptureReader(async()=>f.raw,()=>0,async()=> 'saved');
 const remove=parent.signal.removeEventListener.bind(parent.signal);parent.signal.removeEventListener=(...args)=>{remove(...args);parent.abort();};assert.deepEqual(await read(f.selection,parent.signal),{kind:'unavailable'});
 let at=0;const boundary=new AbortController(),detach=boundary.signal.removeEventListener.bind(boundary.signal);boundary.signal.removeEventListener=(...args)=>{detach(...args);at=3000;};
 const timed=createSelectedHtmlAppendedCaptureReader(async()=>f.raw,()=>at,async()=> 'saved');assert.deepEqual(await timed(f.selection,boundary.signal),{kind:'unavailable'});
});
