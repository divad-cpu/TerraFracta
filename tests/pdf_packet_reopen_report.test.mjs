import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pdfPacketReopenReport as parse } from '../src/server/pdf-packet-reopen-report.ts';
import { manualPdfPacketReopenReport as fixture, inspectionWireSha, pythonWireVectors } from './helpers/pdf_packet_reopen_fixture.mjs';
import { textPage, textSha } from './helpers/pdf_inspection_fixture.mjs';

test('manual supplied reopening report returns a deep checked snapshot with distinct recorded and reopening dates',()=>{
 const input=fixture(),result=parse(input);assert.ok(result);assert.deepEqual(result,input);
 input.inspection_report.pages[0].text='PRIVATE_LATER';input.packet_sha256='f'.repeat(64);
 assert.equal(result.inspection_report.pages[0].text,'Manual invented derived text.\n');assert.equal(result.packet_sha256,'b'.repeat(64));
});
test('outer metadata is closed enumerable JSON data, with no accessors, symbols or reflection escape',()=>{
 for(const change of [r=>r.private_raw='PRIVATE',r=>Object.defineProperty(r,'private',{value:'PRIVATE'}),r=>r[Symbol('private')]='PRIVATE',
  r=>Object.defineProperty(r,'packet_sha256',{value:r.packet_sha256,enumerable:false})]){
  const r=fixture();change(r);assert.equal(parse(r),null);
 }
 let calls=0;const r=fixture();Object.defineProperty(r,'inspection_report',{enumerable:true,get(){calls++;throw Error('PRIVATE');}});
 assert.equal(parse(r),null);assert.equal(calls,0);
 for(const bad of [Object.create(fixture()),[],null,'{}',new Date(),new Proxy(fixture(),{ownKeys(){throw Error('PRIVATE');}})])assert.equal(parse(bad),null);
});
test('inner accessors, exotic prototypes and hidden keys refuse before any private getter is called',()=>{
 let calls=0;const r=fixture();Object.defineProperty(r.inspection_report.pages[0],'text',{enumerable:true,get(){calls++;return 'PRIVATE';}});
 assert.equal(parse(r),null);assert.equal(calls,0);
 for(const mutate of [r=>r.inspection_report.document.private='PRIVATE',r=>r.inspection_report.pages.extra='PRIVATE',
  r=>r.inspection_report.pages[Symbol('PRIVATE')]='PRIVATE',r=>delete r.inspection_report.pages[0],
  r=>r.inspection_report=Object.create(r.inspection_report)]){
  const x=fixture();mutate(x);assert.equal(parse(x),null);
 }
});
test('fixed outer kind scope and lowercase component references remain distinct from omitted byte verification',()=>{
 for(const [key,value] of [['schema_version',true],['kind','stored_authenticated_pdf'],['scope','current_verified_source'],
  ['packet_sha256','A'.repeat(64)],['inspection_sha256','a'.repeat(63)],['derivation_sha256',true]]){
  const r=fixture();r[key]=value;assert.equal(parse(r),null);
 }
 const r=fixture();r.packet_sha256='1'.repeat(64);r.derivation_sha256='2'.repeat(64);assert.ok(parse(r));
});
test('inspection digest uses the fixed compact field profile including LF, independent of supplied property order',()=>{
 const r=fixture();r.inspection_report=Object.fromEntries(Object.entries(r.inspection_report).reverse());
 r.inspection_report.document=Object.fromEntries(Object.entries(r.inspection_report.document).reverse());assert.ok(parse(r));
 r.inspection_sha256=createHash('sha256').update(JSON.stringify(fixture().inspection_report)).digest('hex');assert.equal(parse(r),null);
});
test('real microsecond UTC dates retain the original observation and reject inversions or implicit retiming',()=>{
 for(const [key,value] of [['recorded_observed_at','2026-10-17T08:00:01.000002Z'],['reopened_at','2026-10-17T08:00:01.000000Z'],
  ['reopened_at','2026-02-30T08:00:01.000001Z'],['reopened_at','0000-10-18T08:00:01.000001Z'],
  ['reopened_at','2026-10-18T08:00:01Z'],['reopened_at','2026-10-18T08:00:01.000001+00:00']]){
  const r=fixture();r[key]=value;assert.equal(parse(r),null);
 }
 const r=fixture();r.reopened_at=r.recorded_observed_at;assert.ok(parse(r));
 r.inspection_report.document.retrieved_at=r.inspection_report.observed_at=r.recorded_observed_at=r.reopened_at='0001-01-01T00:00:00.000000Z';
 r.inspection_sha256=inspectionWireSha(r.inspection_report);assert.ok(parse(r));
});
test('the full inner report is checked but matching supplied hashes cannot authenticate omitted packet linkage',()=>{
 const r=fixture();r.inspection_report.pages[0].text='PRIVATE_TAMPER';assert.equal(parse(r),null);
 r.inspection_sha256=inspectionWireSha(r.inspection_report);assert.equal(parse(r),null,'Page text SHA still wrong');
 r.inspection_report.pages[0]=textPage(1,'Different supplied assertion.');r.inspection_sha256=inspectionWireSha(r.inspection_report);
 assert.ok(parse(r),'Packet and manifest are omitted references, not rederived/authenticated here');
});
test('whole held reports cannot claim packet reopening; unresolved per-page states remain explicit',()=>{
 const r=fixture();Object.assign(r.inspection_report,{state:'held',reason_code:'pdf_parse_unavailable',page_count:null,pages:[]});
 r.inspection_sha256=inspectionWireSha(r.inspection_report);assert.equal(parse(r),null);
 const p=fixture();p.inspection_report.pages[0]={page_number:1,state:'held',text:null,text_sha256:null,reason_code:'page_text_limit'};
 p.inspection_sha256=inspectionWireSha(p.inspection_report);assert.ok(parse(p));
});
test('fixed Python UTF8 serialization and the retained actual invented worker output agree without producer replay',()=>{
 const baseline=JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-inspection.json',import.meta.url),'utf8'));
 for(const row of pythonWireVectors){
  const report=structuredClone(baseline);report.document.item_key=row.item_key;report.pages[0]=textPage(1,row.text);
  const r=fixture(report);r.inspection_sha256=row.sha256;assert.ok(parse(r),row.label);
 }
});
test('outer framing admits a maximum inner report without dropping the producer newline quota',()=>{
 const r=fixture(),inner=r.inspection_report;inner.pages=Array.from({length:8},(_,i)=>textPage(i+1,'x'.repeat(8192)));inner.page_count=8;
 const base=Buffer.byteLength(JSON.stringify(inner),'utf8');
 const setEscapes=n=>{for(let i=0;i<8;i++){const k=Math.min(n,8191);n-=k;inner.pages[i]=textPage(i+1,'\t'.repeat(k)+'x'.repeat(8192-k));}assert.equal(n,0);};
 setEscapes(131071-base);r.inspection_sha256=inspectionWireSha(inner);assert.ok(parse(r));
 setEscapes(131072-base);r.inspection_sha256=inspectionWireSha(inner);assert.equal(parse(r),null);
});
