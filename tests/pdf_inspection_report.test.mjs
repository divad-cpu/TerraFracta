import assert from 'node:assert/strict';
import test from 'node:test';
import { pdfInspectionReport as parse } from '../src/server/pdf-inspection-report.ts';
import { manualPdfReport as fixture, textPage, textSha } from './helpers/pdf_inspection_fixture.mjs';

test('manual supplied report admits exact text receipts without claiming original PDF verification',()=>{
 const input=fixture(),r=parse(input);assert.ok(r);assert.deepEqual(r,input);
 input.pages[0].text='Changed after parsing';assert.equal(r.pages[0].text,'Manual invented derived text.\n');
});
test('closed keys reject extra source/private/page/limit fields and symbols',()=>{
 for(const path of [[],['document'],['pages',0],['limits']]){
  for(const hidden of [false,true]){
   const r=fixture();let target=r;for(const key of path)target=target[key];
   if(hidden)Object.defineProperty(target,'private_raw',{value:'PRIVATE',enumerable:false});else target.private_raw='PRIVATE';
   assert.equal(parse(r),null);
  }
 }
 const r=fixture();r.pages[Symbol('PRIVATE')]='PRIVATE';assert.equal(parse(r),null);
});
test('report requires bounded JSON data properties and contains observation faults',()=>{
 let calls=0;const r=fixture();Object.defineProperty(r.document,'item_key',{enumerable:true,get(){calls++;return 'PRIVATE';}});
 assert.equal(parse(r),null);assert.equal(calls,0);
 assert.equal(parse(new Proxy(fixture(),{ownKeys(){throw Error('PRIVATE');}})),null);
 for(const bad of [null,'{}',new Date(),[],Object.create(fixture())])assert.equal(parse(bad),null);
 const holes=fixture();delete holes.pages[0];assert.equal(parse(holes),null);
 const extra=fixture();extra.pages.extra='PRIVATE';assert.equal(parse(extra),null);
});
test('fixed parser/source/media/byte-limit identity cannot be widened',()=>{
 for(const mutate of [r=>r.kind='public_pdf',r=>r.scope='full_visual_document',r=>r.parser_identity='pypdf/latest',
  r=>r.document.media_type='text/plain',r=>r.document.source_key='../private',r=>r.document.source_version_id='A0000000-0000-4000-8000-000000000001',
  r=>r.document.source_version_id='10000000-0000-9000-8000-000000000001',r=>r.document.content_sha256='A'.repeat(64),
  r=>r.document.source_url='https://example.org/?token=PRIVATE',r=>r.document.source_url='file:///PRIVATE',
  r=>r.original_bytes=0,r=>r.original_bytes=65537,r=>r.original_bytes=1.5,
  r=>r.limits.max_pages=9,r=>r.limits.wall_seconds=30,r=>r.limits.file_bytes=1]){
  const r=fixture();mutate(r);assert.equal(parse(r),null);
 }
 const r=fixture();r.original_bytes=65536;assert.ok(parse(r));
});
test('real UTC dates and microsecond chronology remain independently scoped',()=>{
 for(const mutate of [r=>r.observed_at='2026-02-30T08:00:01.000001Z',r=>r.observed_at='0000-10-17T08:00:01.000001Z',
  r=>r.observed_at='2026-10-17T08:00:00.000000Z',r=>r.document.retrieved_at='2026-10-17T08:00:01.000002Z',
  r=>r.observed_at='2026-10-17T08:00:01Z',r=>r.document.retrieved_at='2026-10-17T08:00:00.000001+00:00']){
  const r=fixture();mutate(r);assert.equal(parse(r),null);
 }
 const r=fixture();r.document.retrieved_at=r.observed_at='2024-02-29T00:00:00.000001Z';assert.ok(parse(r));
});
test('physical page indices are exact contiguous positions with one complete page count',()=>{
 for(const mutate of [r=>r.page_count=1,r=>r.pages.reverse(),r=>r.pages[0].page_number=0,
  r=>r.pages[1].page_number=1,r=>r.pages[1].page_number=3,r=>r.pages=[],r=>r.page_count=null,
  r=>r.pages=Array.from({length:9},(_,i)=>textPage(i+1))]){
  const r=fixture();mutate(r);assert.equal(parse(r),null);
 }
});
test('whole document holds carry only an allowed reason and no partial page state',()=>{
 for(const reason of ['pdf_encrypted','pdf_parse_unavailable','pdf_page_limit','pdf_output_limit']){
  const r=fixture();Object.assign(r,{state:'held',reason_code:reason,page_count:null,pages:[]});assert.ok(parse(r));
  r.pages=[textPage(1)];assert.equal(parse(r),null);r.pages=[];r.page_count=1;assert.equal(parse(r),null);
 }
 for(const reason of [null,'PRIVATE_ERROR','page_text_limit']){
  const r=fixture();Object.assign(r,{state:'held',reason_code:reason,page_count:null,pages:[]});assert.equal(parse(r),null);
 }
 const r=fixture();r.reason_code='pdf_parse_unavailable';assert.equal(parse(r),null);
});
test('held and no-native-text pages have no text/hash or invented reasons',()=>{
 for(const reason of ['page_content_limit','page_text_limit','page_text_unusable','page_extraction_unavailable']){
  const r=fixture();r.pages[1]={page_number:2,state:'held',text:null,text_sha256:null,reason_code:reason};assert.ok(parse(r));
  r.pages[1].text='PRIVATE';assert.equal(parse(r),null);
 }
 for(const mutate of [r=>r.pages[1].text='',r=>r.pages[1].text_sha256=textSha(''),r=>r.pages[1].reason_code='page_text_unusable',
  r=>r.pages[0].reason_code='page_text_limit',r=>r.pages[0].text_sha256=null]){
  const r=fixture();mutate(r);assert.equal(parse(r),null);
 }
});
test('exact unnormalized UTF8 text is hashed rather than normalized or trimmed',()=>{
 const r=fixture(),s='  Å e\u0301 😀\t\n\r\ufeff  ';r.pages[0]=textPage(1,s);assert.equal(parse(r)?.pages[0].text,s);
 r.pages[0].text=s.normalize('NFC');assert.equal(parse(r),null);
 r.pages[0]=textPage(1,'Same text');r.pages[0].text_sha256='0'.repeat(64);assert.equal(parse(r),null);
});
test('Python nonblank semantics and allowed native text controls are preserved',()=>{
 for(const value of ['\ufeff','\u0085\ufeff\u0085','\ttext\n\r','\u007f\u009f']){
  const r=fixture();r.pages[0]=textPage(1,value);assert.equal(parse(r)?.pages[0].text,value);
 }
 for(const value of ['', ' \t\n\r ', '\u0085','x\u0000y','x\u000by','x\u000cy','x\u001fy','\ud800','x\udfff']){
  const r=fixture();r.pages[0]=textPage(1,value);assert.equal(parse(r),null,JSON.stringify(value));
 }
});
test('UTF8 page and total/report quotas retain their exact fixed bounds',()=>{
 const r=fixture();r.pages=[textPage(1,'x'.repeat(8192))];r.page_count=1;assert.ok(parse(r));
 r.pages[0]=textPage(1,'x'.repeat(8193));assert.equal(parse(r),null);
 r.pages[0]=textPage(1,'😀'.repeat(2048));assert.ok(parse(r));r.pages[0]=textPage(1,'😀'.repeat(2049));assert.equal(parse(r),null);
 r.pages=Array.from({length:8},(_,i)=>textPage(i+1,'x'.repeat(8192)));r.page_count=8;assert.ok(parse(r));
 // Per-page bytes still fit; JSON control escaping exceeds the whole-report ceiling.
 r.pages=Array.from({length:8},(_,i)=>textPage(i+1,'x'+'\t'.repeat(8191)));assert.equal(parse(r),null);
});
test('item identity uses scalar capacity and exact Python-stripped spelling',()=>{
 const r=fixture();r.document.item_key='😀'.repeat(120);assert.ok(parse(r));r.document.item_key+='x';assert.equal(parse(r),null);
 for(const value of [' item','item ','\u0085item','item\u0085','\ud800','x\u0000y']){
  r.document.item_key=value;assert.equal(parse(r),null);
 }
 r.document.item_key='\ufeff';assert.ok(parse(r));
});

test('whole report output ceiling includes the fixed producer trailing newline',()=>{
 const r=fixture();r.pages=Array.from({length:8},(_,i)=>textPage(i+1,'x'.repeat(8192)));r.page_count=8;
 const initialBytes=Buffer.byteLength(JSON.stringify(r),'utf8');
 const setEscapes=count=>{
  for(let i=0;i<8;i++){const n=Math.min(count,8191);count-=n;r.pages[i]=textPage(i+1,'\t'.repeat(n)+'x'.repeat(8192-n));}
  assert.equal(count,0);
 };
 setEscapes(131072-initialBytes);assert.equal(Buffer.byteLength(JSON.stringify(r),'utf8'),131072);
 assert.equal(parse(r),null,'The actual producer adds one LF byte');
 setEscapes(131071-initialBytes);assert.equal(Buffer.byteLength(JSON.stringify(r),'utf8'),131071);assert.ok(parse(r));
});
