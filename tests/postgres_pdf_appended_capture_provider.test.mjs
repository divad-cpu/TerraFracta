import assert from 'node:assert/strict';
import test from 'node:test';
import {createPostgresPdfAppendedCaptureTransport as transport,POSTGRES_PDF_APPENDED_OWNER_GUARD_SQL as GUARD} from '../src/server/postgres-pdf-appended-capture-provider.ts';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
import {preparePdfAppendedIssueCaptureRead as prepare,PDF_APPENDED_CAPTURE_READ_SQL as READ} from '../src/server/pdf-appended-issue-capture.ts';
import {preparePdfAppendedCaptureLookup,parsePdfAppendedCaptureLookup,PDF_APPENDED_CAPTURE_LOOKUP_SQL as LOOKUP} from '../src/server/pdf-appended-capture-lookup.ts';
import {createSelectedPdfAppendedCaptureReader} from '../src/server/pdf-appended-capture-selection.ts';
import {createPdfAppendedCaptureReader} from '../src/server/pdf-appended-capture-reader.ts';
import {pdfLookupFixture as fixture} from './helpers/pdf_owner_fixture.mjs';
const BEGIN='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',signal=()=>new AbortController().signal,tick=()=>new Promise(r=>setImmediate(r));
const ack=command=>({command,rowCount:null,fields:[],rows:[]}),cell=(name,value,oid=25)=>({command:'SELECT',rowCount:1,fields:[{name,dataTypeID:oid}],rows:[[value]]});
class Client{
 constructor(f){this.f=f;this.queries=[];this.closed=0;}async connect(){}on(){}async end(){this.closed++;}
 async query(q){this.queries.push(q);if(q.text===BEGIN)return ack('BEGIN');if(q.text==='ROLLBACK')return ack('ROLLBACK');if(q.text===GUARD)return cell('admitted',true,16);if(q.text===LOOKUP)return cell('lookup',JSON.stringify(this.f.lookup));assert.equal(q.text,READ);return cell('capture',this.f.raw.toString('utf8'));}
}
function harness(change,now=()=>0){const f=fixture(),clients=[];const owner=createPostgresReadOwner({host:'db.example.invalid',port:5432,database:'fictional',user:'postgres',password:'INVENTED_NONSECRET_PASSWORD',transport:{kind:'verified-tls'}},'terrafracta.operator-audit',true,async()=>{const c=new Client(f);change?.(c);clients.push(c);return c;},now);return {f,clients,owner,t:transport(owner)};}
const read=h=>h.t.readCapture(prepare(h.f.f.intentJson),signal());
test('one complete PDF read uses fixed repeatable read guard rollback and same-client acknowledged closure',async()=>{
 const h=harness(),out=await createPdfAppendedCaptureReader(h.t.readCapture,()=>0,async()=>assert.fail('No diagnostic'))(h.f.scope);
 assert.equal(out.kind,'ok');assert.deepEqual(out.stored.bundle,h.f.bundle);assert.deepEqual(out.stored.expected,h.f.expected);
 assert.equal(h.clients.length,1);const c=h.clients[0];assert.deepEqual(c.queries.map(q=>q.text),[BEGIN,GUARD,READ,'ROLLBACK']);assert.deepEqual(c.queries[2].values,[h.f.intent.capture_id]);assert.ok(c.queries.every(q=>q.rowMode==='array'));assert.equal(c.closed,1);assert.equal(await h.owner.shutdown(),true);
});
test('fixed getter refuses arbitrary SQL foreign owner symbols hidden keys sparse arrays and wrong UUID before acquisition',async()=>{
 const h=harness(),command=prepare(h.f.f.intentJson),id=h.f.intent.capture_id;
 const values=[id];values[Symbol('extra')]=true;const hidden=[id];Object.defineProperty(hidden,'extra',{value:true});
 for(const c of [{sql:'SELECT 1',values:[id]},{sql:READ,values:[]},{sql:READ,values},{sql:READ,values:hidden},{...command,[Symbol('extra')]:true},{sql:READ,values:['bad']},{sql:READ,values:[id.replace('-445c-','-145c-')]},{sql:READ,values:new Array(1)}])await assert.rejects(h.t.readCapture(c,signal()),/^Error: read_unavailable$/);
 assert.equal(h.clients.length,0);
 for(const input of [{...h.owner,user:'terra_reviewer'},{...h.owner,[Symbol('extra')]:true},Object.defineProperty({...h.owner},'hidden',{value:true}),Object.create(h.owner)])assert.throws(()=>transport(input),/^Error: read_unavailable$/);
 assert.equal(await h.owner.shutdown(),true);
});
test('principal guard malformed boolean OID field name or count refuses before private getter',async()=>{
 for(const value of [cell('admitted',false,16),cell('admitted',true,25),cell('other',true,16),{...cell('admitted',true,16),rowCount:2}]){
  const h=harness(c=>{const query=c.query.bind(c);c.query=async q=>q.text===GUARD?(c.queries.push(q),value):query(q);});await assert.rejects(read(h),/^Error: read_unavailable$/);assert.deepEqual(h.clients[0].queries.map(q=>q.text),[BEGIN,GUARD]);assert.equal(h.clients[0].closed,1);assert.equal(await h.owner.shutdown(),true);
 }
});
test('malformed BEGIN and ROLLBACK acknowledgements never release otherwise valid bytes',async()=>{
 for(const phase of [BEGIN,'ROLLBACK'])for(const change of [v=>v.command='OTHER',v=>v.rowCount=0,v=>v.rows=[[]],v=>v.fields=[{name:'PRIVATE'}]]){
  const h=harness(c=>{const query=c.query.bind(c);c.query=async q=>{const v=await query(q);if(q.text===phase)change(v);return v;};});await assert.rejects(read(h),/^Error: read_unavailable$/);assert.equal(h.clients[0].closed,1);assert.equal(await h.owner.shutdown(),true);
 }
});
test('single primitive text OID and exact UTF8 receipt ceiling are required',async()=>{
 for(const change of [v=>v.fields[0].dataTypeID=3802,v=>v.fields[0].name='OTHER',v=>v.rowCount=0,v=>v.command='OTHER',v=>v.rows=[[null]],v=>v.rows=[['\ud800']],v=>v.rows=[['é'.repeat(65537)]],v=>v.rows=[[Buffer.from('{}')]],v=>v.rows.push(v.rows[0]),v=>v.rows[0].push('PRIVATE')]){
  const h=harness(c=>{const query=c.query.bind(c);c.query=async q=>{const v=await query(q);if(q.text===READ)change(v);return v;};});await assert.rejects(read(h),/^Error: read_unavailable$/);assert.equal(await h.owner.shutdown(),true);
 }
});
test('owned scalar bytes survive driver-result mutation during rollback and command mutation during acquisition',async()=>{
 let native,release;const f=fixture(),command=structuredClone(prepare(f.f.intentJson)),client=new Client(f),query=client.query.bind(client);
 client.query=async q=>{if(q.text==='ROLLBACK')native.rows[0][0]='PRIVATE_REPLACED';const value=await query(q);if(q.text===READ)native=value;return value;};
 const actual={user:'postgres',shutdown:async()=>true,run:async function(s,execute){assert.equal(this,actual);await new Promise(r=>release=r);return execute(client,()=>{assert.equal(s.aborted,false);});}};
 const t=transport(actual),pending=t.readCapture(command,signal());command.values[0]='PRIVATE_CHANGED';command.sql='PRIVATE_CHANGED';actual.run=()=>assert.fail('No replacement');release();const raw=await pending;assert.ok(Buffer.from(raw).equals(f.raw));assert.deepEqual(client.queries[2].values,[f.intent.capture_id]);
});
test('cancel or owner deadline after getter cannot disclose bytes even after rollback acknowledgement',async()=>{
 for(const phase of [BEGIN,GUARD,READ,'ROLLBACK'])for(const mode of ['abort','deadline']){
  const parent=new AbortController();let now=0;const h=harness(c=>{const query=c.query.bind(c);c.query=async q=>{const value=await query(q);if(q.text===phase){if(mode==='abort')parent.abort();else now=2500;}return value;};},()=>now);
  await assert.rejects(h.t.readCapture(prepare(h.f.f.intentJson),parent.signal),/^Error: read_unavailable$/);assert.equal(h.clients[0].closed,1);assert.equal(await h.owner.shutdown(),true);
 }
});
test('unacknowledged physical close withholds full receipt and keeps both slots until actual acknowledgement',async()=>{
 let resolve;const close=new Promise(r=>resolve=r),h=harness(c=>{c.end=async()=>{c.closed++;await close;};});
 await assert.rejects(read(h),/^Error: read_unavailable$/);await assert.rejects(read(h),/^Error: read_unavailable$/);await assert.rejects(read(h),/^Error: read_unavailable$/);assert.equal(h.clients.length,2);resolve();await tick();assert.equal(await h.owner.shutdown(),true);assert.ok(h.clients.every(c=>c.closed===1));
});

test('explicit PDF lookup then selected full read share the fixed owner without coupling separate snapshots',async()=>{
 const h=harness(),f=h.f,command=preparePdfAppendedCaptureLookup(f.bundle.candidateReportJson,f.reportExpected,f.f.observedAt);
 const raw=await h.t.readLookup(f.bundle.candidateReportJson,f.reportExpected,f.f.observedAt,signal());
 assert.equal(parsePdfAppendedCaptureLookup(raw,f.bundle.candidateReportJson,f.reportExpected,f.f.observedAt).matches[0].captureId,f.intent.capture_id);
 const selected=await createSelectedPdfAppendedCaptureReader(h.t.readCapture,()=>0,async()=>assert.fail('No diagnostic'))({...f.selection,lookupRaw:raw});assert.equal(selected.kind,'ok');assert.deepEqual(selected.stored.expected,f.expected);assert.equal(h.clients.length,2);
 for(const [index,c]of h.clients.entries()){assert.deepEqual(c.queries.map(q=>q.text),[BEGIN,GUARD,index===0?LOOKUP:READ,'ROLLBACK']);assert.equal(c.closed,1);}
 assert.deepEqual(h.clients[0].queries[2].values,[...command.values]);assert.equal(await h.owner.shutdown(),true);
});
test('lookup requires independently retained complete preparation before acquiring a physical client',async()=>{
 const h=harness(),f=h.f;
 for(const key of Object.keys(f.reportExpected)){const e={...f.reportExpected};delete e[key];await assert.rejects(h.t.readLookup(f.bundle.candidateReportJson,e,f.f.observedAt,signal()),/^Error: read_unavailable$/);}
 await assert.rejects(h.t.readLookup('{}',f.reportExpected,f.f.observedAt,signal()),/^Error: read_unavailable$/);assert.equal(h.clients.length,0);assert.equal(await h.owner.shutdown(),true);
});
test('lookup scalar UTF8 cap and OID refuse before any metadata is exposed',async()=>{
 for(const change of [v=>v.fields[0].dataTypeID=3802,v=>v.fields[0].name='capture',v=>v.rows=[['é'.repeat(2049)]],v=>v.rows=[['\ud800']]]){
  const h=harness(c=>{const query=c.query.bind(c);c.query=async q=>{const value=await query(q);if(q.text===LOOKUP)change(value);return value;};});
  await assert.rejects(h.t.readLookup(h.f.bundle.candidateReportJson,h.f.reportExpected,h.f.f.observedAt,signal()),/^Error: read_unavailable$/);assert.equal(h.clients[0].closed,1);assert.equal(await h.owner.shutdown(),true);
 }
});
