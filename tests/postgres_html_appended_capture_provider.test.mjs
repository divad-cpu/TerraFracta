import assert from 'node:assert/strict';import test from 'node:test';
import {createPostgresHtmlAppendedCaptureTransport as transport,POSTGRES_HTML_APPENDED_OWNER_GUARD_SQL as GUARD} from '../src/server/postgres-html-appended-capture-provider.ts';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
import {prepareHtmlAppendedIssueCaptureRead,HTML_APPENDED_CAPTURE_READ_SQL as READ} from '../src/server/html-appended-issue-capture.ts';
import {prepareHtmlAppendedCaptureLookup,parseHtmlAppendedCaptureLookup} from '../src/server/html-appended-capture-lookup.ts';
import {createSelectedHtmlAppendedCaptureReader} from '../src/server/html-appended-capture-selection.ts';
import {htmlCaptureFixture as fixture} from './helpers/html_capture_transport_fixture.mjs';
const BEGIN='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',signal=()=>new AbortController().signal;
const ack=command=>({command,rowCount:null,fields:[],rows:[]});const cell=(name,v,oid=25)=>({command:'SELECT',rowCount:1,fields:[{name,dataTypeID:oid}],rows:[[v]]});
class Client{
 constructor(f){this.f=f;this.queries=[];this.closed=0;}async connect(){}on(){}async end(){this.closed++;}
 async query(q){this.queries.push(q);if(q.text===BEGIN)return ack('BEGIN');if(q.text==='ROLLBACK')return ack('ROLLBACK');if(q.text===GUARD)return cell('admitted',true,16);return q.text===READ?cell('capture',this.f.raw.toString('utf8')):cell('lookup',JSON.stringify(this.f.lookup));}
}
function harness(change){const f=fixture(),clients=[];const owner=createPostgresReadOwner({host:'db.example.invalid',port:5432,database:'fictional',user:'postgres',password:'INVENTED_NONSECRET_PASSWORD',transport:{kind:'verified-tls'}},'terrafracta.operator-audit',true,async()=>{const c=new Client(f);change?.(c);clients.push(c);return c;},()=>0);return {f,clients,owner,t:transport(owner)};}
test('fixed HTML lookup and selected complete read use same shared owner with RR guard rollback and acknowledged close',async()=>{
 const h=harness(),f=h.f,raw=await h.t.readLookup(f.bundle.candidateReportJson,f.expected,f.f.observedAt,signal());assert.equal(parseHtmlAppendedCaptureLookup(raw,f.bundle.candidateReportJson,f.expected,f.f.observedAt).matches[0].captureId,f.native.capture_id);
 const result=await createSelectedHtmlAppendedCaptureReader(h.t.readCapture,()=>0,async()=>assert.fail('No diagnostic'))({...f.selection,lookupRaw:raw});assert.equal(result.kind,'ok');assert.equal(h.clients.length,2);
 const lookup=prepareHtmlAppendedCaptureLookup(f.bundle.candidateReportJson,f.expected,f.f.observedAt);
 for(const c of h.clients){assert.deepEqual(c.queries.map(q=>q.text),[BEGIN,GUARD,c===h.clients[0]?lookup.sql:READ,'ROLLBACK']);assert.equal(c.closed,1);assert.ok(c.queries.every(q=>q.rowMode==='array'));}assert.equal(await h.owner.shutdown(),true);
});
test('HTML provider refuses arbitrary SQL plain getter foreign owner symbols malformed arrays and changed selector shape before admission',async()=>{
 const h=harness(),command=prepareHtmlAppendedIssueCaptureRead(h.f.f.retainedIntentJson),values=[h.f.native.capture_id];values[Symbol('extra')]=true;
 for(const c of [{sql:'SELECT 1',values:[h.f.native.capture_id]},{sql:READ,values:[]},{sql:READ,values},{...command,[Symbol('extra')]:true},{sql:READ,values:['bad']}])await assert.rejects(h.t.readCapture(c,signal()),/^Error: read_unavailable$/);
 assert.equal(h.clients.length,0);assert.throws(()=>transport({...h.owner,user:'terra_reviewer'}),/^Error: read_unavailable$/);assert.equal(await h.owner.shutdown(),true);
});
test('owner guard rejects wrong boolean OID principal and transaction before private data query',async()=>{
 for(const value of [cell('admitted',false,16),cell('admitted',true,25),cell('other',true,16),{...cell('admitted',true,16),rowCount:2}]){
  const h=harness(c=>{const query=c.query.bind(c);c.query=async q=>q.text===GUARD?(c.queries.push(q),value):query(q);});await assert.rejects(h.t.readCapture(prepareHtmlAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),/^Error: read_unavailable$/);assert.deepEqual(h.clients[0].queries.map(q=>q.text),[BEGIN,GUARD]);assert.equal(h.clients[0].closed,1);assert.equal(await h.owner.shutdown(),true);
 }
});
test('malformed BEGIN or ROLLBACK never releases even otherwise valid private receipt',async()=>{
 for(const phase of [BEGIN,'ROLLBACK']){const h=harness(c=>{const query=c.query.bind(c);c.query=async q=>q.text===phase?(c.queries.push(q),ack('OTHER')):query(q);});await assert.rejects(h.t.readCapture(prepareHtmlAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),/^Error: read_unavailable$/);assert.equal(h.clients[0].closed,1);assert.equal(await h.owner.shutdown(),true);}
});
test('one scalar text cell correct OID and exact UTF8 byte ceilings are required on each route',async()=>{
 for(const route of ['lookup','capture'])for(const change of [v=>v.fields[0].dataTypeID=3802,v=>v.rows=[[null]],v=>v.rows=[['\ud800']],v=>v.rows=[['é'.repeat((route==='lookup'?4096:131072)/2+1)]],v=>v.rows.push(v.rows[0])]){
  const h=harness(c=>{const query=c.query.bind(c);c.query=async q=>{const v=await query(q);if(q.text!==BEGIN&&q.text!==GUARD&&q.text!=='ROLLBACK')change(v);return v;};});await assert.rejects(route==='lookup'?h.t.readLookup(h.f.bundle.candidateReportJson,h.f.expected,h.f.f.observedAt,signal()):h.t.readCapture(prepareHtmlAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),/^Error: read_unavailable$/);assert.equal(await h.owner.shutdown(),true);
 }
});
test('owned receipt bytes survive mutation of driver result during rollback suspension',async()=>{
 let native;const h=harness(c=>{const query=c.query.bind(c);c.query=async q=>{if(q.text==='ROLLBACK')native.rows[0][0]='INVENTED_REPLACEMENT';const result=await query(q);if(q.text===READ)native=result;return result;};});
 const raw=await h.t.readCapture(prepareHtmlAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal());assert.deepEqual(raw,new Uint8Array(h.f.raw));assert.equal(await h.owner.shutdown(),true);
});
