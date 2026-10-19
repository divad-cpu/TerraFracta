import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {preparePdfInitialCandidateReadScope as scope} from '../src/server/pdf-initial-candidate-capture-scope.ts';
import {createPostgresPdfInitialCandidateWorkTransport as transport,POSTGRES_PDF_INITIAL_CANDIDATE_WORK_SQL as WRITE} from '../src/server/postgres-pdf-initial-candidate-work-transport.ts';
import {createPostgresPdfInitialCandidateCaptureTransport as provider,POSTGRES_PDF_INITIAL_CANDIDATE_OWNER_GUARD_SQL as GUARD} from '../src/server/postgres-pdf-initial-candidate-capture-provider.ts';
import {createPdfInitialCandidateCaptureReader as reader,readPdfInitialCandidateCapture as defaultReader} from '../src/server/pdf-initial-candidate-capture-reader.ts';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
import {preparePdfInitialCandidateCaptureForWork as prepare,PDF_INITIAL_CANDIDATE_CAPTURE_SQL as FIXED,PDF_INITIAL_CANDIDATE_CAPTURE_READ_SQL as READ} from '../src/server/pdf-initial-candidate-capture.ts';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const tick=()=>new Promise(r=>setImmediate(r));
const signal=()=>new AbortController().signal;
function fixture(){
 const f=JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-initial-candidate-capture.json',import.meta.url),'utf8'));
 const raw=Buffer.from(f.receiptBase64,'base64'),native=JSON.parse(raw),report=Buffer.from(native.report_base64,'base64').toString('utf8'),intent=JSON.parse(f.intentJson);
 const work={runId:intent.run_id,requestFingerprint:'a'.repeat(64),workClaimId:'90000000-0000-4000-8000-000000000098'};
 return {...f,raw,native,report,intent,work,scope:{retainedIntentJson:f.intentJson,expected:f.expected,observedAt:f.observedAt}};
}
const ack=command=>({command,rowCount:null,fields:[],rows:[]});
const wire=(fields,rows)=>({command:'SELECT',rowCount:1,fields,rows});
class Client extends EventEmitter{
 constructor(f){super();this.f=f;this.queries=[];this.ended=0;this.status='I';}
 async connect(){}getTransactionStatus(){return this.status;}
 async query(q){
  this.queries.push(q);
  if(q.text.startsWith('SET '))return ack('SET');
  if(q.text.startsWith('BEGIN '))return ack('BEGIN');
  if(q.text==='ROLLBACK')return ack('ROLLBACK');
  if(q.text===GUARD)return wire([{name:'admitted',dataTypeID:16}],[[true]]);
  if(q.text===READ)return wire([{name:'capture',dataTypeID:25}],[[this.f.raw.toString('utf8')]]);
  assert.equal(q.text,WRITE);return wire([{name:'admitted',dataTypeID:16},{name:'capture',dataTypeID:25}],[[true,this.f.raw.toString('utf8')]]);
 }
 async end(){this.ended++;}
}
function harness({observe,make,beforeFactory}={}){
 const f=fixture(),clients=[],codes=[];let observations=0;
 const config={host:'db.example.invalid',port:5432,database:'invented',user:'postgres',password:'INVENTED_NONSECRET_PASSWORD',transport:{kind:'verified-tls'}};
 const owner=createPostgresReadOwner(config,'terrafracta.proposal-worker',true,async()=>{await beforeFactory?.();const c=make?make(f):new Client(f);clients.push(c);return c;},()=>0);
 const record=async code=>{codes.push(code);return 'saved';};
 const t=transport(owner,async()=>{observations++;return observe?observe(f):f.observedAt;},record);
 return {f,owner,t,clients,codes,record,observations:()=>observations,capture:s=>t.capture(f.work,f.report,f.expected,s??signal())};
}
async function drain(h){assert.equal(await h.owner.shutdown(),true);await tick();}

test('closed independent five and null-head single candidate are admitted before external callbacks',async()=>{
 const f=fixture(),s=scope(f.intentJson,f.expected,f.observedAt);
 assert.equal(Object.keys(s.expected).length,5);assert.ok(Object.isFrozen(s.expected));assert.deepEqual(s.command,{sql:READ,values:[f.intent.capture_id]});assert.equal(f.native.capture.basePublicationId,null);
 assert.equal((await defaultReader(f.scope)).kind,'unconfigured');let calls=0;const unexpected=()=>{calls++;assert.fail('no callback');};const read=reader(unexpected,unexpected,unexpected);
 for(const name of Object.keys(f.expected)){
  const missing={...f.expected};delete missing[name];assert.deepEqual(await read({...f.scope,expected:missing}),{kind:'invalid_scope'});
  const getter={...f.expected};Object.defineProperty(getter,name,{enumerable:true,get:unexpected});assert.deepEqual(await read({...f.scope,expected:getter}),{kind:'invalid_scope'});
 }
 for(const value of [null,{...f.scope,extra:true},{...f.scope,[Symbol('private')]:true},Object.create(f.scope),{...f.scope,observedAt:'2026-02-30T00:00:00.000000Z'}])assert.deepEqual(await read(value),{kind:'invalid_scope'});
 assert.equal(calls,0);
});
test('fixed five-operand write confirms full four-part report after independent observation and physical close',async()=>{
 const h=harness(),p=prepare(h.f.work,h.f.report,h.f.expected),out=await h.capture();
 assert.equal(out.kind,'confirmed');assert.equal(out.stored.reportJson,h.f.report);assert.equal(out.stored.receiptSha256,hash(h.f.raw));assert.equal(Object.keys(out.stored.preparation.report.parts).length,4);assert.equal(out.stored.capture.basePublicationId,null);
 assert.deepEqual(h.clients[0].queries.map(q=>q.text),['SET default_transaction_read_only = off',"SET default_transaction_isolation = 'read committed'",WRITE]);assert.deepEqual(h.clients[0].queries[2].values,[...p.values]);assert.equal(h.clients[0].queries[2].values.length,5);assert.equal(h.clients[0].ended,1);assert.equal(h.observations(),1);assert.deepEqual(h.codes,[]);
 assert.ok(WRITE.includes(FIXED.slice(7,-'::text AS capture'.length)));assert.deepEqual(WRITE.match(/\$\d+/g),['$1','$2','$3','$4','$5']);await drain(h);
});
test('postwrite observer unavailable is unknown and never automatically retries or returns partial evidence',async()=>{
 const h=harness({observe:()=>{throw Error('PRIVATE');}});assert.deepEqual(await h.capture(),{kind:'outcome_unknown'});assert.equal(h.clients[0].queries.filter(q=>q.text===WRITE).length,1);assert.equal(h.clients[0].ended,1);await tick();assert.deepEqual(h.codes,['proposal_capture_write']);await drain(h);
});
test('work tuple is fixed before expected descriptor callbacks can substitute current claim',async()=>{
 const h=harness(),original={...h.f.work};let descriptors=0;
 const expected=new Proxy(h.f.expected,{getOwnPropertyDescriptor(target,key){descriptors++;h.f.work.workClaimId='90000000-0000-4000-8000-000000000099';return Reflect.getOwnPropertyDescriptor(target,key);}});
 const out=await h.t.capture(h.f.work,h.f.report,expected,signal());assert.equal(out.kind,'confirmed');assert.ok(descriptors>0);assert.equal(out.work.workClaimId,original.workClaimId);assert.equal(h.clients[0].queries[2].values[2],original.workClaimId);await drain(h);
});
test('explicit full native recovery preserves all supplied five selectors across asynchronous caller mutation',async()=>{
 let release;const wait=new Promise(r=>release=r),h=harness({beforeFactory:()=>wait});const f=h.f,w={...f.work,workClaimId:'90000000-0000-4000-8000-000000000097'},before={...w},e={...f.expected},raw=Buffer.from(f.raw);
 const pending=h.t.recover(w,raw,f.intentJson,e,f.observedAt,signal());w.workClaimId='PRIVATE';e.preparationStoredAt='PRIVATE';e.preparationArtifactId='PRIVATE';raw.fill(0);release();const out=await pending;
 assert.equal(out.kind,'confirmed');assert.deepEqual(out.work,before);assert.equal(out.stored.receiptSha256,hash(f.raw));assert.deepEqual(out.stored.preparation.expected,f.expected);assert.equal(h.clients[0].queries[2].values[2],before.workClaimId);await drain(h);
});
test('recovery work is fixed before independent expectation descriptor traps run',async()=>{
 const h=harness(),f=h.f,w={...f.work,workClaimId:'90000000-0000-4000-8000-000000000096'},original=w.workClaimId;let calls=0;
 const expected=new Proxy(f.expected,{getOwnPropertyDescriptor(target,key){calls++;w.workClaimId='90000000-0000-4000-8000-000000000095';return Reflect.getOwnPropertyDescriptor(target,key);}});
 const out=await h.t.recover(w,f.raw,f.intentJson,expected,f.observedAt,signal());assert.equal(out.kind,'confirmed');assert.ok(calls>0);assert.equal(out.work.workClaimId,original);assert.equal(h.clients[0].queries[2].values[2],original);await drain(h);
});
test('recovery rejects missing independent selectors or corrupted complete receipt before owner acquisition',async()=>{
 const h=harness(),f=h.f;
 for(const name of Object.keys(f.expected)){const e={...f.expected};delete e[name];assert.deepEqual(await h.t.recover(f.work,f.raw,f.intentJson,e,f.observedAt,signal()),{kind:'not_dispatched'});}
 assert.deepEqual(await h.t.recover(f.work,Buffer.from('{}'),f.intentJson,f.expected,f.observedAt,signal()),{kind:'not_dispatched'});assert.equal(h.clients.length,0);assert.equal(h.observations(),0);await drain(h);
});
test('expected native work refusal is quiet unknown; denied principal is quiet not dispatched',async()=>{
 for(const mode of ['work','principal']){
  const h=harness({make:f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>{if(q.text===WRITE){c.queries.push(q);if(mode==='work')throw Object.assign(Error('PRIVATE'),{code:'23514'});return wire([{name:'admitted',dataTypeID:16},{name:'capture',dataTypeID:25}],[[false,null]]);}return query(q);};return c;}});
  assert.deepEqual(await h.capture(),{kind:mode==='work'?'outcome_unknown':'not_dispatched'});assert.equal(h.observations(),0);await drain(h);assert.deepEqual(h.codes,[]);
 }
});
test('complete historical provider uses only one fixed UUID in readonly transaction and owned close',async()=>{
 const h=harness(),p=provider(h.owner),s=scope(h.f.intentJson,h.f.expected,h.f.observedAt),raw=await p.readCapture(s.command,signal());assert.ok(Buffer.from(raw).equals(h.f.raw));assert.deepEqual(Object.keys(p),['readLookup','readCapture']);assert.deepEqual(h.clients[0].queries.map(q=>q.text),['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',GUARD,READ,'ROLLBACK']);assert.deepEqual(h.clients[0].queries[2].values,[h.f.intent.capture_id]);assert.equal(h.clients[0].ended,1);await drain(h);
});
test('provider preabort and foreign SQL never acquire; malformed guard or receipt shape withholds bytes',async()=>{
 const h=harness(),p=provider(h.owner),command=scope(h.f.intentJson,h.f.expected,h.f.observedAt).command,parent=new AbortController();parent.abort();await assert.rejects(p.readCapture(command,parent.signal));await assert.rejects(p.readCapture({...command,sql:'SELECT PRIVATE'},signal()));assert.equal(h.clients.length,0);await drain(h);
 for(const phase of ['guard','receipt']){const h=harness({make:f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>{const result=await query(q);if(q.text===(phase==='guard'?GUARD:READ))result.fields[0].dataTypeID=3802;return result;};return c;}});await assert.rejects(provider(h.owner).readCapture(scope(h.f.intentJson,h.f.expected,h.f.observedAt).command,signal()));assert.equal(h.clients[0].ended,1);await drain(h);}
});
test('bounded reader captures independent five before caller clock/provider mutation and admits whole historical result',async()=>{
 const f=fixture(),input=structuredClone(f.scope),expected=structuredClone(f.expected);let release;const read=reader(()=>new Promise(r=>release=r),()=>{input.expected.preparationStoredAt='PRIVATE';return 0;},async()=>assert.fail('no diagnostic'));
 const pending=read(input);await tick();input.expected.reportSha256='PRIVATE';input.retainedIntentJson='PRIVATE';release(f.raw);const out=await pending;assert.equal(out.kind,'ok');assert.equal(out.stored.reportJson,f.report);assert.deepEqual(out.stored.preparation.expected,expected);assert.equal(out.stored.observedAt,f.observedAt);
});
test('retirement callback cancelling parent or exhausting original clock cannot deliver checked receipt',async()=>{
 for(const mode of ['abort','deadline']){const f=fixture(),parent=new AbortController(),codes=[];let now=0;
  const read=reader(async(_q,inner)=>{inner.addEventListener('abort',()=>{if(mode==='abort')parent.abort();else now=3000;});return f.raw;},()=>now,async c=>{codes.push(c);return 'saved';});
  assert.deepEqual(await read(f.scope,parent.signal),{kind:'unavailable'});await tick();assert.deepEqual(codes,mode==='abort'?[]:['operator_audit_read']);}
});
test('full byte corruption and independently wrong storedAt refuse all output without inferring replacements',async()=>{
 const f=fixture();for(const raw of [Buffer.from('{}'),Buffer.alloc(131073),Buffer.from([255])])assert.deepEqual(await reader(async()=>raw,()=>0,async()=> 'saved')(f.scope),{kind:'unavailable'});
 const expected={...f.expected,preparationStoredAt:'2026-10-01T00:00:00.000000Z'};assert.deepEqual(await reader(async()=>f.raw,()=>0,async()=> 'saved')({...f.scope,expected}),{kind:'unavailable'});
});
test('owner cleanup failure after dispatched query remains unknown and read exposes no candidate',async()=>{
 const f=fixture(),client=new Client(f),codes=[];const owner={user:'postgres',shutdown:async()=>assert.fail('caller owns shutdown'),run:async(_s,fn)=>{await fn(client,()=>{});throw Error('PRIVATE_CLOSE_FAILURE');}};
 assert.deepEqual(await transport(owner,()=>f.observedAt,async c=>{codes.push(c);return 'saved';}).capture(f.work,f.report,f.expected,signal()),{kind:'outcome_unknown'});await assert.rejects(provider(owner).readCapture(scope(f.intentJson,f.expected,f.observedAt).command,signal()));assert.ok(client.queries.some(q=>q.text===WRITE));await tick();assert.deepEqual(codes,['proposal_capture_write']);
});
