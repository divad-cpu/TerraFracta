import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {pdfOwnerFixture} from './helpers/pdf_owner_fixture.mjs';
import {createHash} from 'node:crypto';
import {createPostgresPdfAppendedWorkTransport,POSTGRES_PDF_APPENDED_WORK_SQL as WRITE} from '../src/server/postgres-pdf-appended-work-transport.ts';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
import {preparePdfAppendedCaptureForWork,recoverPdfAppendedCaptureForWork,PDF_APPENDED_WORK_CAPTURE_SQL} from '../src/server/pdf-appended-capture-work.ts';
const SETS=['SET default_transaction_read_only = off',"SET default_transaction_isolation = 'read committed'"];
const signal=()=>new AbortController().signal,turn=()=>new Promise(resolve=>setImmediate(resolve)),sha=raw=>createHash('sha256').update(raw).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const config={host:'db.example.invalid',port:5432,database:'fictional',user:'postgres',password:'INVENTED_NONSECRET_PASSWORD',transport:{kind:'verified-tls'}};
const ack=()=>({command:'SET',rowCount:null,fields:[],rows:[]});
const wire=text=>({command:'SELECT',rowCount:1,fields:[{name:'admitted',dataTypeID:16},{name:'capture',dataTypeID:25}],rows:[[true,text]]});
function fixture(){
 const data=pdfOwnerFixture(),f={...data.f,retainedIntentJson:data.f.intentJson,rawReceiptJson:data.raw.toString('utf8')};
 return {...data,f,i:data.intent,prepared:preparePdfAppendedCaptureForWork(data.work,data.bundle,data.expected)};
}

class Client extends EventEmitter{
 constructor(f){super();this.f=f;this.queries=[];this.connected=0;this.ended=0;this.status='I';this.result=wire(f.f.rawReceiptJson);}
 async connect(){this.connected++;}getTransactionStatus(){return this.status;}
 async query(q){this.queries.push(q);return q.text===WRITE?this.result:ack();}
 async end(){this.ended++;}
}
function harness(make,observe,clock=()=>0){
 const f=fixture(),clients=[],configs=[],codes=[];let observations=0;
 const owner=createPostgresReadOwner(config,'terrafracta.proposal-worker',true,async options=>{configs.push(options);const c=make?await make(f):new Client(f);clients.push(c);return c;},clock);
 const observer=async()=>{observations++;return observe?observe(f):f.f.observedAt;};const t=createPostgresPdfAppendedWorkTransport(owner,observer,async code=>{codes.push(code);return 'saved';});
 return {f,owner,t,clients,configs,codes,observations:()=>observations,capture:s=>t.capture(f.work,f.bundle,f.expected,s??signal()),recover:(w=f.work,raw=Buffer.from(f.f.rawReceiptJson),i=f.f.retainedIntentJson,at=f.f.observedAt,s=signal())=>t.recover(w,raw,i,f.expected,at,s)};
}
async function drained(h){assert.equal(await h.owner.shutdown(),true);await turn();}
test('constructor requires exactly supplied owner-only session association and independent observer with no default target',()=>{
 const run=async()=>assert.fail('No acquisition'),shutdown=async()=>true;
 for(const owner of [null,{}, {run,shutdown,user:'postgres',[Symbol('extra')]:true}, Object.defineProperty({run,shutdown,user:'postgres'},'extra',{value:true}), {run,shutdown,user:'terra_reviewer'},{run,shutdown,user:'postgres',extra:true},{run:null,shutdown,user:'postgres'},Object.create({run,shutdown,user:'postgres'})])assert.throws(()=>createPostgresPdfAppendedWorkTransport(owner,()=>''),/^Error: pdf_appended_capture_work_unavailable$/);
 for(const observe of [undefined,null,'2026-10-15T00:00:00.000000Z',{}])assert.throws(()=>createPostgresPdfAppendedWorkTransport({run,shutdown,user:'postgres'},observe),/^Error: pdf_appended_capture_work_unavailable$/);
 assert.deepEqual(Object.keys(createPostgresPdfAppendedWorkTransport({run,shutdown,user:'postgres'},()=>'')),['capture','recover']);
});
test('fixed autocommit whole receipt confirms only after independent postwrite observation and actual owner close acknowledgement',async()=>{
 const h=harness();const out=await h.capture();assert.equal(out.kind,'confirmed');assert.equal(out.stored.receiptSha256,sha(h.f.f.rawReceiptJson));assert.equal(out.stored.intentJson,h.f.f.retainedIntentJson);assert.deepEqual(out.work,h.f.work);assert.deepEqual(out.stored.bundle,h.f.bundle);assert.equal(out.stored.observedAt,h.f.f.observedAt);assert.ok(Object.isFrozen(out)&&Object.isFrozen(out.work)&&Object.isFrozen(out.stored));
 const c=h.clients[0];assert.deepEqual(c.queries.map(q=>q.text),[...SETS,WRITE]);assert.deepEqual(c.queries[2].values,[...h.f.prepared.values]);assert.equal(c.queries[2].values.length,10);assert.ok(c.queries.every(q=>q.rowMode==='array'));assert.equal(c.ended,1);assert.equal(h.observations(),1);assert.deepEqual(h.codes,[]);
 assert.ok(WRITE.includes(PDF_APPENDED_WORK_CAPTURE_SQL.slice(7,-'::text AS capture'.length)));assert.match(WRITE,/current_user=session_user AND session_user='postgres'/);assert.doesNotMatch(WRITE,/BEGIN|COMMIT|SET ROLE|INSERT |UPDATE |DELETE /);assert.deepEqual(WRITE.match(/\$\d+/g),Array.from({length:10},(_,i)=>'$'+(i+1)));
 const o=h.configs[0];assert.equal(o.ssl.rejectUnauthorized,true);assert.equal(o.application_name,'terrafracta.proposal-worker');assert.ok(o.options.includes('default_transaction_read_only=on'));assert.equal(o.statement_timeout,2000);assert.equal(o.lock_timeout,500);assert.equal(o.binary,false);assert.equal(o.replication,false);assert.equal(o.pipeline,false);await drained(h);
});
test('retained full recovery captures new explicit work before awaits without changing historical intent or parts',async()=>{
 const wait=deferred(),h=harness(async f=>{await wait.promise;return new Client(f);}),w={...h.f.work,workClaimId:'00000000-0000-4000-8000-000000000996'},raw=Buffer.from(h.f.f.rawReceiptJson),expected=recoverPdfAppendedCaptureForWork(w,raw,h.f.f.retainedIntentJson,h.f.expected,h.f.f.observedAt),pending=h.recover(w,raw);w.workClaimId='PRIVATE_CHANGED';raw.fill(0);wait.resolve();
 const out=await pending;assert.equal(out.kind,'confirmed');assert.deepEqual(h.clients[0].queries[2].values,[...expected.values]);assert.equal(out.work.workClaimId,'00000000-0000-4000-8000-000000000996');assert.equal(out.stored.intentJson,h.f.f.retainedIntentJson);await drained(h);
});
test('invalid incomplete foreign work preabort and retired shared owner never acquire a client or observe',async()=>{
 const h=harness(),f=h.f;
 for(const args of [[null,f.bundle,f.expected],[{...f.work,runId:'00000000-0000-4000-8000-000000000999'},f.bundle,f.expected],[f.work,{...f.bundle,proposalJson:'{}'},f.expected],[f.work,f.bundle,{...f.expected,preparationIntentJson:'{}'}],[{...f.work,extra:true},f.bundle,f.expected]])assert.deepEqual(await h.t.capture(...args,signal()),{kind:'not_dispatched'});
 assert.deepEqual(await h.recover(f.work,Buffer.from('{}')),{kind:'not_dispatched'});assert.deepEqual(await h.recover(f.work,Buffer.from(f.f.rawReceiptJson),f.f.retainedIntentJson,'2000-01-01T00:00:00.000000Z'),{kind:'not_dispatched'});
 const parent=new AbortController();parent.abort();assert.deepEqual(await h.capture(parent.signal),{kind:'not_dispatched'});assert.equal(h.clients.length,0);assert.equal(h.observations(),0);assert.deepEqual(h.codes,[]);await drained(h);assert.deepEqual(await h.capture(),{kind:'not_dispatched'});assert.equal(h.clients.length,0);
});
test('prepared values and original supplied run association survive caller mutation before physical acquisition',async()=>{
 const f=fixture(),wait=deferred(),clients=[],actual=createPostgresReadOwner(config,'terrafracta.proposal-worker',true,async()=>{await wait.promise;const c=new Client(f);clients.push(c);return c;},()=>0);let expectedReceiver;
 const supplied={run:function(...args){assert.equal(this,expectedReceiver);return actual.run(...args);},shutdown:actual.shutdown,user:'postgres'};expectedReceiver=supplied;
 const t=createPostgresPdfAppendedWorkTransport(supplied,()=>f.f.observedAt,async()=>assert.fail('No diagnostic'));const pending=t.capture(f.work,f.bundle,f.expected,signal());f.work.workClaimId='PRIVATE_CHANGED';f.bundle.proposalJson='PRIVATE_CHANGED';f.expected.compositionSha256='0'.repeat(64);supplied.run=()=>assert.fail('replacement run');supplied.shutdown=()=>assert.fail('replacement shutdown');wait.resolve();
 const out=await pending;assert.equal(out.kind,'confirmed');assert.deepEqual(clients[0].queries[2].values,[...f.prepared.values]);assert.equal(await actual.shutdown(),true);
});
test('nonidle acquisition and either malformed SET acknowledgement refuse before invocation',async()=>{
 for(const phase of ['initial',...SETS])for(const fault of ['status','ack']){
  const h=harness(f=>{const c=new Client(f),query=c.query.bind(c);if(phase==='initial'){if(fault==='status')c.status='T';else c.getTransactionStatus=undefined;}else c.query=async q=>{const r=await query(q);if(q.text===phase){if(fault==='status')c.status='T';else r.command='PRIVATE_COMMAND';}return r;};return c;});assert.deepEqual(await h.capture(),{kind:'not_dispatched'});assert.ok(!h.clients[0].queries.some(q=>q.text===WRITE));assert.equal(h.observations(),0);assert.equal(h.clients[0].ended,1);await drained(h);assert.deepEqual(h.codes,['proposal_capture_write']);
 }
});
test('admitted false with exact native null proves no invocation and stays quiet without an observer',async()=>{
 const h=harness(f=>{const c=new Client(f);c.result.rows=[[false,null]];return c;});assert.deepEqual(await h.capture(),{kind:'not_dispatched'});assert.equal(h.observations(),0);await drained(h);assert.deepEqual(h.codes,[]);
});
test('postdispatch malformed native shape OIDs UTF8 and full byte limit remain unknown without partial receipt or observation',async()=>{
 const variants=[r=>r.command='PRIVATE_COMMAND',r=>r.rowCount=0,r=>r.fields[1].dataTypeID=3802,r=>r.fields[0].dataTypeID=25,r=>r.rows=[[true,null]],r=>r.rows=[[false,'{}']],r=>r.rows=[[true,Buffer.from('{}')]],r=>r.rows=[[true,'\ud800']],r=>r.rows=[[true,'é'.repeat(65537)]],r=>r.rows=[[true,'{}','PRIVATE_EXTRA']]];
 for(const change of variants){const h=harness(f=>{const c=new Client(f);change(c.result);return c;});assert.deepEqual(await h.capture(),{kind:'outcome_unknown'});assert.equal(h.observations(),0);assert.equal(h.clients[0].ended,1);await drained(h);assert.deepEqual(h.codes,['proposal_capture_write']);}
});
test('full intent each part and native current-source identity must agree after independent observation',async()=>{
 const current=JSON.parse(JSON.parse(fixture().bundle.candidateReportJson).parts.provenance_json).current.source_version_id;
 for(const change of [r=>r.intent_base64=Buffer.from('{}').toString('base64'),r=>r.parts_base64[0]=Buffer.from('{}').toString('base64'),r=>r.parts_base64[5]=Buffer.from('{}').toString('base64'),r=>r.capture.captureId='00000000-0000-4000-8000-000000000999',r=>r.capture.sourceReceipts.find(source=>source.sourceVersionId===current).contentSha256='0'.repeat(64)]){
  const h=harness(f=>{const c=new Client(f),native=structuredClone(f.native);change(native);c.result=wire(JSON.stringify(native));return c;});assert.deepEqual(await h.capture(),{kind:'outcome_unknown'});assert.equal(h.observations(),1);await drained(h);
 }
});
test('native scalar bytes are captured before asynchronous observer can replace driver-owned result',async()=>{
 const pending=deferred();let c;const h=harness(f=>(c=new Client(f)),async()=>{c.result.rows[0][1]='PRIVATE_CHANGED';await pending.promise;return h.f.f.observedAt;});const result=h.capture();await turn();assert.equal(h.observations(),1);pending.resolve();const out=await result;assert.equal(out.kind,'confirmed');assert.equal(out.stored.receiptSha256,sha(h.f.f.rawReceiptJson));await drained(h);
});
test('required observer failures invalid times or an earlier historical observation never confirm a dispatched write',async()=>{
 for(const observe of [()=>{throw Error('PRIVATE_OBSERVER');},()=>Promise.reject(Error('PRIVATE_OBSERVER')),()=>null,()=>Date.now(),()=> '2000-01-01T00:00:00.000000Z',()=> '2026-10-15T00:00:00Z']){const h=harness(undefined,observe);assert.deepEqual(await h.capture(),{kind:'outcome_unknown'});assert.equal(h.observations(),1);await drained(h);assert.deepEqual(h.codes,['proposal_capture_write']);}
});
test('nonidle postwrite result is unknown before observing even when a valid receipt is supplied',async()=>{
 const h=harness(f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>{const r=await query(q);if(q.text===WRITE)c.status='T';return r;};return c;});assert.deepEqual(await h.capture(),{kind:'outcome_unknown'});assert.equal(h.observations(),0);await drained(h);
});
test('cancellation at SET write and postwrite observation keeps invocation boundary and stays silent',async()=>{
 for(const phase of [SETS[0],SETS[1],WRITE,'observer']){
  const parent=new AbortController(),h=harness(f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>{const r=await query(q);if(q.text===phase)parent.abort();return r;};return c;},f=>{if(phase==='observer')parent.abort();return f.f.observedAt;});
  assert.deepEqual(await h.capture(parent.signal),{kind:phase===WRITE||phase==='observer'?'outcome_unknown':'not_dispatched'});await drained(h);assert.deepEqual(h.codes,[]);assert.equal(h.clients[0].ended,1);
 }
});
test('parent abort during actual owner final close cannot turn a full receipt into confirmation',async()=>{
 const parent=new AbortController(),h=harness(f=>{const c=new Client(f);c.end=async()=>{c.ended++;parent.abort();};return c;});assert.deepEqual(await h.capture(parent.signal),{kind:'outcome_unknown'});await drained(h);assert.deepEqual(h.codes,[]);
});
test('original elapsed owner fence distinguishes predispatch from postdispatch and observer expiry',async()=>{
 for(const phase of [SETS[1],WRITE,'observer']){let now=0;const h=harness(f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>{const r=await query(q);if(q.text===phase)now=2500;return r;};return c;},f=>{if(phase==='observer')now=2500;return f.f.observedAt;},()=>now);assert.deepEqual(await h.capture(),{kind:phase===SETS[1]?'not_dispatched':'outcome_unknown'});await drained(h);}
});
test('two unresolved acquisitions keep physical slots after logical cancellation and overflow never queues or retries',async()=>{
 const wait=deferred(),clients=[];let acquired=0;const f=fixture(),owner=createPostgresReadOwner(config,'terrafracta.proposal-worker',true,async()=>{acquired++;const c=new Client(f);clients.push(c);await wait.promise;return c;},()=>0),t=createPostgresPdfAppendedWorkTransport(owner,()=>assert.fail('No observation'),async()=> 'saved'),a=new AbortController(),b=new AbortController();
 const one=t.capture(f.work,f.bundle,f.expected,a.signal),two=t.capture(f.work,f.bundle,f.expected,b.signal);await turn();assert.equal(acquired,2);assert.deepEqual(await t.capture(f.work,f.bundle,f.expected,signal()),{kind:'not_dispatched'});assert.equal(acquired,2);a.abort();b.abort();assert.deepEqual(await one,{kind:'not_dispatched'});assert.deepEqual(await two,{kind:'not_dispatched'});assert.deepEqual(await t.capture(f.work,f.bundle,f.expected,signal()),{kind:'not_dispatched'});assert.equal(acquired,2);wait.resolve();await turn();assert.ok(clients.every(c=>c.connected===0&&c.ended===1&&c.queries.length===0));assert.equal(await owner.shutdown(),true);
});
test('unacknowledged physical close withholds confirmed receipt and retains both slots until same-client acknowledgement',async()=>{
 const close=deferred(),h=harness(f=>{const c=new Client(f);c.end=async()=>{c.ended++;await close.promise;};return c;});assert.deepEqual(await h.capture(),{kind:'outcome_unknown'});assert.deepEqual(await h.capture(),{kind:'outcome_unknown'});assert.equal(h.clients.length,2);assert.deepEqual(await h.capture(),{kind:'not_dispatched'});assert.equal(h.clients.length,2);close.resolve();await turn();await drained(h);assert.ok(h.clients.every(c=>c.ended===1));
});
test('expected native constraint conflict fence refusals remain unknown and silent while unexpected diagnostics are closed and never include payload',async()=>{
 for(const code of ['23514','23505','40001','42P01']){
  const h=harness(f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>{if(q.text===WRITE){c.queries.push(q);throw Object.assign(Error('PRIVATE_SQL_BODY'),{code,detail:'PRIVATE_SOURCE_BODY'});}return query(q);};return c;});assert.deepEqual(await h.capture(),{kind:'outcome_unknown'});assert.equal(h.observations(),0);await drained(h);assert.deepEqual(h.codes,code==='42P01'?['proposal_capture_write']:[]);assert.equal(h.clients[0].queries.filter(q=>q.text===WRITE).length,1);
 }
});
test('failed diagnostic recorder cannot replace conservative outcome or trigger another writer',async()=>{
 const f=fixture(),codes=[];let acquisitions=0;const owner=createPostgresReadOwner(config,'terrafracta.proposal-worker',true,async()=>{acquisitions++;throw Error('PRIVATE_ACQUISITION');},()=>0),t=createPostgresPdfAppendedWorkTransport(owner,()=>assert.fail('No observation'),async code=>{codes.push(code);throw Error('PRIVATE_LOG_FAILURE');});assert.deepEqual(await t.capture(f.work,f.bundle,f.expected,signal()),{kind:'not_dispatched'});await turn();assert.deepEqual(codes,['proposal_capture_write']);assert.equal(acquisitions,1);assert.equal(await owner.shutdown(),true);
});
test('post-run parent cancellation after shared owner cleanup is refused by adapter final boundary',async()=>{
 const f=fixture(),parent=new AbortController(),clients=[],codes=[],actual=createPostgresReadOwner(config,'terrafracta.proposal-worker',true,async()=>{const c=new Client(f);clients.push(c);return c;},()=>0);
 let delivered=false;const supplied={user:'postgres',shutdown:actual.shutdown,run:async(...args)=>{const result=await actual.run(...args);assert.equal(clients[0].ended,1);delivered=true;parent.abort();return result;}};
 const t=createPostgresPdfAppendedWorkTransport(supplied,()=>f.f.observedAt,async code=>{codes.push(code);return 'saved';});assert.deepEqual(await t.capture(f.work,f.bundle,f.expected,parent.signal),{kind:'outcome_unknown'});assert.equal(delivered,true);await turn();assert.deepEqual(codes,[]);assert.equal(await actual.shutdown(),true);
});
