import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {prepareIssuePreparationContextRead as prepare,parseStoredIssuePreparationContext as parse,createPostgresIssuePreparationContextReader as create,ISSUE_PREPARATION_CONTEXT_SQL as SQL} from '../src/server/issue-preparation-context.ts';
import {POSTGRES_APPENDED_OWNER_GUARD_SQL as GUARD} from '../src/server/postgres-appended-capture-provider.ts';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
const BEGIN='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',turn=()=>new Promise(r=>setImmediate(r)),signal=()=>new AbortController().signal;
const sha=s=>createHash('sha256').update(s).digest('hex'),ack=command=>({command,rowCount:null,fields:[],rows:[]}),cell=(name,value,oid=25)=>({command:'SELECT',rowCount:1,fields:[{name,dataTypeID:oid}],rows:[[value]]});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bad=error=>error instanceof Error&&error.message==='issue_preparation_context_unavailable';
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(){
 const f=JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-capture.json',import.meta.url),'utf8')),n=JSON.parse(f.rawReceiptJson),report=JSON.parse(Buffer.from(n.parts_base64[0],'base64')),context=JSON.parse(report.parts.context_json),held=context.held,issue=context.issue,baselineJson=Buffer.from(n.parts_base64[1],'base64').toString('utf8');
 const scope={runId:held.run_id,decisionId:held.decision_id,issueId:issue.issue_id,basePublicationId:issue.head.publication_id};
 const expected={source:{sourceVersionId:held.source_version_id,contentSha256:held.content_sha256,itemKey:held.item_key,locator:held.locator,jurisdictionId:held.jurisdiction_id},head:{contentSha256:issue.head.content_sha256,changedAt:issue.head.changed_at}};
 const row={held,issue,baselineJson,runCreatedAt:'2026-01-01T00:00:00.000000Z',qualificationDecidedAt:'2026-01-01T00:00:00.000000Z',sourceRetrievedAt:'2026-01-01T00:00:00.000000Z',publicationCreatedAt:issue.head.changed_at};
 const envelope={schemaVersion:1,kind:'stored_issue_preparation_context',requested:scope,observedAt:issue.observed_at,matches:[row]};
 return {f,scope,expected,row,envelope,wire:()=>Buffer.from(JSON.stringify(envelope)),parse(){return parse(this.wire(),scope,expected,f.observedAt);}};
}
class Client extends EventEmitter{
 constructor(f){super();this.f=f;this.queries=[];this.ended=0;this.connected=0;this.response=cell('context',f.wire().toString());}
 async connect(){this.connected++;}
 async query(q){this.queries.push(q);return q.text===GUARD?cell('admitted',true,16):q.text===SQL?this.response:ack(q.text===BEGIN?'BEGIN':'ROLLBACK');}
 async end(){this.ended++;}
}
const config={host:'db.example.invalid',port:5432,database:'fictional',user:'postgres',password:'INVENTED_NONSECRET_PLACEHOLDER',transport:{kind:'verified-tls'}};
function harness(make,clock=()=>0,observe){const f=fixture(),clients=[],codes=[];let observations=0;const owner=createPostgresReadOwner(config,'terrafracta.operator-audit',true,async options=>{const c=make?await make(f,options):new Client(f);clients.push(c);return c;},clock);const read=create(owner,async()=>{observations++;return observe?observe(f):f.f.observedAt;},async code=>{codes.push(code);return 'saved';});return {f,owner,read,clients,codes,observations:()=>observations,run(s=f.scope,e=f.expected,a=signal()){return read(s,e,a);}};}
async function close(h){assert.equal(await h.owner.shutdown(),true);await turn();assert.ok(h.clients.every(c=>c.ended===1));}

test('fixed explicit four-ID command never reads captures, chooses a replacement or writes',()=>{
 const f=fixture(),c=prepare(f.scope);assert.equal(c.sql,SQL);assert.deepEqual(c.values,Object.values(f.scope));assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.values));assert.ok(!/proposal_captures|\b(insert|update|delete|for update|grant)\b/i.test(SQL));assert.ok(SQL.includes('h.current_publication_id=$4::uuid'));
 for(const changed of [{...f.scope,extra:'private'},[f.scope],{},null,{...f.scope,basePublicationId:null},{...f.scope,runId:f.scope.runId.toUpperCase()}])assert.throws(()=>prepare(changed),bad);
});
test('complete context preserves exact raw baseline and independent held/source/head correspondence',()=>{
 const f=fixture(),r=f.parse();assert.equal(r.kind,'ok');assert.equal(r.context.baselineJson,f.row.baselineJson);assert.equal(r.context.baselineSha256,sha(f.row.baselineJson));assert.deepEqual(r.context.held,f.row.held);assert.deepEqual(r.context.issue,f.row.issue);assert.equal(r.context.headComparison,'matched');assert.equal(r.context.evidenceState,'observed_stored_correspondence_not_assignment_approval_or_publication');assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.context)&&Object.isFrozen(r.context.held)&&Object.isFrozen(r.context.issue.head));assert.deepEqual(JSON.parse(r.context.canonicalBaselineJson),JSON.parse(f.row.baselineJson));
});
test('explicit unbound head observation is disclosed and never inferred to be independently matched',()=>{
 const f=fixture(),r=parse(f.wire(),f.scope,{...f.expected,head:null},f.f.observedAt);assert.equal(r.kind,'ok');assert.equal(r.context.headComparison,'not_supplied');assert.ok(!Object.hasOwn(r.context,'approved'));
});
test('zero matches exposes no private context and is distinct from malformed or failed observation',()=>{
 const f=fixture();f.envelope.matches=[];const r=f.parse();assert.equal(r.kind,'no_match');assert.deepEqual(Object.keys(r).sort(),['kind','observedAt','scope']);f.envelope.matches=[f.row,f.row];assert.throws(()=>f.parse(),bad);f.envelope.matches=null;assert.throws(()=>f.parse(),bad);
});
test('each independent source and optional head mismatch refuses the entire payload',()=>{
 const f=fixture();for(const key of Object.keys(f.expected.source)){const e=clone(f.expected);e.source[key]=key==='sourceVersionId'?'00000000-0000-4000-8000-000000000999':key==='contentSha256'?'f'.repeat(64):'different';assert.throws(()=>parse(f.wire(),f.scope,e,f.f.observedAt),bad,key);}
 for(const head of [{contentSha256:'f'.repeat(64),changedAt:f.expected.head.changedAt},{...f.expected.head,changedAt:'2026-01-01T00:00:00.000000Z'}])assert.throws(()=>parse(f.wire(),f.scope,{...f.expected,head},f.f.observedAt),bad);
});
test('all explicit requested identities and baseline/issue/jurisdiction bindings remain exact',()=>{
 for(const key of ['runId','decisionId','issueId','basePublicationId']){const f=fixture();f.envelope.requested={...f.scope,[key]:'00000000-0000-4000-8000-000000000999'};assert.throws(()=>f.parse(),bad,key);}
 for(const change of [f=>f.row.held.run_id='00000000-0000-4000-8000-000000000999',f=>f.row.held.decision_id='00000000-0000-4000-8000-000000000999',f=>f.row.issue.jurisdiction_id='different',f=>f.row.issue.head.publication_id='00000000-0000-4000-8000-000000000999',f=>f.row.issue.issue_slug='different']){const f=fixture();change(f);assert.throws(()=>f.parse(),bad);}
});
test('raw baseline hash, closed schema, manifest, original normalization and date invariants refuse corruption',()=>{
 for(const change of [b=>b.dependencyManifest.sourceVersionIds=[],b=>b.snapshot.title=' padded ',b=>b.snapshot.lastEvidenceReviewOn='2099-01-01',b=>b.issueId='00000000-0000-4000-8000-000000000999',b=>b.extra='private']){const f=fixture(),b=JSON.parse(f.row.baselineJson);change(b);f.row.baselineJson=JSON.stringify(b);f.row.issue.head.content_sha256=sha(f.row.baselineJson);f.expected.head=null;assert.throws(()=>f.parse(),bad);}
 const f=fixture();f.row.baselineJson+=' ';assert.throws(()=>f.parse(),bad);
});
test('UTC6 microsecond chronology and actual observation forbid later or invalid historical fields',()=>{
 const f=fixture();assert.throws(()=>parse(f.wire(),f.scope,f.expected,'2020-01-01T00:00:00.000000Z'),bad);
 for(const change of [f=>f.row.held.decided_at='2099-01-01T00:00:00.000000Z',f=>f.row.runCreatedAt='2099-01-01T00:00:00.000000Z',f=>f.row.sourceRetrievedAt='2099-01-01T00:00:00.000000Z',f=>f.row.qualificationDecidedAt='2099-01-01T00:00:00.000000Z',f=>f.row.publicationCreatedAt='2099-01-01T00:00:00.000000Z',f=>f.row.issue.created_at='2099-01-01T00:00:00.000000Z',f=>f.row.issue.observed_at='2020-01-01T00:00:00.000000Z',f=>f.envelope.observedAt='2026-02-30T00:00:00.000000Z']){const f=fixture();change(f);assert.throws(()=>f.parse(),bad);}
 const later=fixture();later.row.held.decided_at=later.envelope.observedAt.replace(/(\d{6})Z$/,(_,n)=>String(Number(n)+1).padStart(6,'0')+'Z');assert.throws(()=>later.parse(),bad);
});
test('native byte capacity ignores shadowed lengths and refuses bad UTF8/BOM/surrogates and oversized envelopes',()=>{
 const f=fixture(),raw=f.wire();Object.defineProperty(raw,'byteLength',{value:1});assert.equal(parse(raw,f.scope,f.expected,f.f.observedAt).kind,'ok');
 for(const value of [new Uint8Array(65537),Buffer.from([0xff]),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),f.wire()]),new Proxy(f.wire(),{}),{byteLength:2},Buffer.from('{"schemaVersion":1,"kind":"\\ud800"}')])assert.throws(()=>parse(value,f.scope,f.expected,f.f.observedAt),bad);
});
test('multilingual stored field limits use existing producer codepoints while baseline/native limits remain actual bytes',()=>{
 for(const token of ['界','🧭']){const f=fixture();f.row.held.item_key=token.repeat(120);f.expected.source.itemKey=f.row.held.item_key;f.row.held.locator=token.repeat(400);f.expected.source.locator=f.row.held.locator;assert.equal(f.parse().kind,'ok');f.row.held.item_key+=token;f.expected.source.itemKey=f.row.held.item_key;assert.throws(()=>f.parse(),bad);}
 const bom=fixture();bom.row.held.item_key='\ufeffexact-key';bom.expected.source.itemKey=bom.row.held.item_key;assert.equal(bom.parse().kind,'ok');
 const nel=fixture();nel.row.held.item_key='\u0085trimmed-by-python';nel.expected.source.itemKey=nel.row.held.item_key;assert.throws(()=>nel.parse(),bad);
 for(const field of ['itemKey','locator','jurisdictionId']){const f=fixture(),e=clone(f.expected);e.source[field]='bad\u0000field';assert.throws(()=>parse(f.wire(),f.scope,e,f.f.observedAt),bad);}
});
test('constructor accepts only explicit unchanged owner-only association and required UTC observer',()=>{
 const good={user:'postgres',run:async()=>assert.fail('acquisition'),shutdown:async()=>true};for(const value of [null,{...good,user:'terra_reviewer'},{...good,extra:true},{...good,run:null}])assert.throws(()=>create(value,()=>''),bad);assert.throws(()=>create(good),bad);
});
test('physical read checks actual guard/result OIDs and fixed transaction rollback before close',async()=>{
 const h=harness(),r=await h.run();assert.equal(r.kind,'ok');assert.deepEqual(h.clients[0].queries.map(q=>q.text),[BEGIN,GUARD,SQL,'ROLLBACK']);assert.deepEqual(h.clients[0].queries[2].values,Object.values(h.f.scope));assert.equal(h.observations(),1);assert.equal(h.clients[0].ended,1);assert.deepEqual(h.codes,[]);await close(h);
});
test('invalid or preaborted requests acquire nothing and selection/expectations are snapshotted before awaits',async()=>{
 const h=harness(),a=new AbortController();a.abort();assert.equal((await h.run(h.f.scope,h.f.expected,a.signal)).kind,'unavailable');assert.equal((await h.run({},h.f.expected)).kind,'invalid_scope');assert.equal((await h.run(h.f.scope,{...h.f.expected,extra:true})).kind,'invalid_scope');assert.equal(h.clients.length,0);assert.equal(h.observations(),0);await close(h);
 const gate=deferred(),m=harness(async f=>{await gate.promise;return new Client(f);}),s=clone(m.f.scope),e=clone(m.f.expected),pending=m.run(s,e);s.issueId='PRIVATE_MUTATED';e.source.locator='PRIVATE_MUTATED';e.head.changedAt='PRIVATE_MUTATED';gate.resolve();assert.equal((await pending).kind,'ok');await close(m);
});
test('guard refusals and malformed native acknowledgement/result shapes never return context',async()=>{
 for(const mutate of [c=>{const q=c.query.bind(c);c.query=async v=>v.text===GUARD?cell('admitted',false,16):q(v);},c=>c.response.fields[0].dataTypeID=1043,c=>c.response.fields[0].name='different',c=>c.response.rowCount=2,c=>c.response.rows.push(c.response.rows[0]),c=>c.response.rows[0][0]='é'.repeat(32769),c=>c.response.rows[0][0]='\ud800',c=>{const q=c.query.bind(c);c.query=async v=>v.text==='ROLLBACK'?{...ack('ROLLBACK'),rowCount:0}:q(v);}]){const h=harness(f=>{const c=new Client(f);mutate(c);return c;});assert.equal((await h.run()).kind,'unavailable');await close(h);assert.deepEqual(h.codes,['operator_audit_read']);}
});
test('bytes remain owned across observer and rollback; a later producer change cannot substitute context',async()=>{
 const h=harness(f=>{const c=new Client(f),q=c.query.bind(c);c.query=async v=>{const out=await q(v);if(v.text==='ROLLBACK')c.response.rows[0][0]='PRIVATE_CHANGED';return out;};return c;});assert.equal((await h.run()).kind,'ok');await close(h);
});
test('required independent observation errors and parent cancellation refuse without leaking content',async()=>{
 for(const observe of [()=>undefined,()=>{throw Error('PRIVATE_BODY');},()=>Promise.reject(Error('PRIVATE_BODY'))]){const h=harness(undefined,()=>0,observe);assert.equal((await h.run()).kind,'unavailable');await close(h);assert.deepEqual(h.codes,['operator_audit_read']);}
 const a=new AbortController(),h=harness(undefined,()=>0,()=>{a.abort();return fixture().f.observedAt;});assert.equal((await h.run(h.f.scope,h.f.expected,a.signal)).kind,'unavailable');await close(h);assert.deepEqual(h.codes,[]);
});
test('unacknowledged close retains both physical slots and refuses a third request until actual settlement',async()=>{
 const gate=deferred(),h=harness(f=>{const c=new Client(f);c.end=async()=>{c.ended++;await gate.promise;};return c;});assert.equal((await h.run()).kind,'unavailable');assert.equal((await h.run()).kind,'unavailable');assert.equal(h.clients.length,2);assert.equal((await h.run()).kind,'unavailable');assert.equal(h.clients.length,2);gate.resolve();await turn();await close(h);
});
test('elapsed clock and post-close cancellation keep complete parsed data from escaping after retirement',async()=>{
 let now=0;const h=harness(f=>{const c=new Client(f),q=c.query.bind(c);c.query=async v=>{const out=await q(v);if(v.text==='ROLLBACK')now=2500;return out;};return c;},()=>now);assert.equal((await h.run()).kind,'unavailable');await close(h);
 const a=new AbortController(),m=harness(f=>{const c=new Client(f);c.end=async()=>{c.ended++;a.abort();};return c;});assert.equal((await m.run(m.f.scope,m.f.expected,a.signal)).kind,'unavailable');await close(m);assert.deepEqual(m.codes,[]);
});
