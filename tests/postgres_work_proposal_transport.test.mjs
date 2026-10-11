import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {createPostgresWorkProposalTransport,POSTGRES_WORK_PROPOSAL_SQL} from '../src/server/postgres-work-proposal-transport.ts';
import {proposalReport,proposalId} from './helpers/proposal_fixture.mjs';
const config={host:'db.example.org',port:5432,database:'terra_private',user:'fictional_worker',password:'invented-password',transport:{kind:'verified-tls'}};
const work=()=>({runId:proposalId(1),requestFingerprint:'a'.repeat(64),workClaimId:proposalId(51)});
const selection=()=>({captureId:proposalId(8),runId:proposalId(1),decisionId:proposalId(2),issueId:proposalId(7),basePublicationId:proposalId(6)});
const payload=()=>JSON.parse(proposalReport().capture.proposalJson);
const signal=()=>new AbortController().signal,turn=()=>new Promise(done=>setImmediate(done));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const ack=()=>({command:'SET',rowCount:null,fields:[],rows:[]});
const receipt=(status='stored')=>({schemaVersion:1,status,...selection(),proposalSha256:proposalReport().capture.proposalSha256,capturedAt:proposalReport().capture.capturedAt,observedAt:proposalReport().observedAt});
const wire=(value=receipt())=>({command:'SELECT',rowCount:1,fields:[{name:'admitted',dataTypeID:16},{name:'capture',dataTypeID:25}],rows:[[true,JSON.stringify(value)]]});
class Client extends EventEmitter {
 queries=[];ended=0;status='I';result=wire();
 async connect(){} getTransactionStatus(){return this.status;}
 async query(q){this.queries.push(q);return q.text===POSTGRES_WORK_PROPOSAL_SQL?this.result:ack();}
 async end(){this.ended++;}
}
const create=(c,record=async()=>assert.fail('unexpected diagnostic'),clock=undefined)=>createPostgresWorkProposalTransport(config,async()=>c,clock,record);
test('fixed worker query commits in one autocommit statement and only confirms a strict receipt after idle status and close acknowledgement',async()=>{
 const c=new Client();let options;const t=createPostgresWorkProposalTransport(config,async value=>{options=value;return c;},undefined,async()=>assert.fail('diagnostic'));
 const w=work(),s=selection(),p=payload(),pending=t.capture(w,s,p,signal());w.workClaimId=proposalId(99);s.runId=proposalId(99);p.snapshot.title='PRIVATE_CHANGED';
 const result=await pending;assert.deepEqual(result,{kind:'confirmed',receipt:receipt()});assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.receipt));
 assert.deepEqual(c.queries.map(q=>q.text),['SET default_transaction_read_only = off',"SET default_transaction_isolation = 'read committed'",POSTGRES_WORK_PROPOSAL_SQL]);
 assert.deepEqual(c.queries[2].values,[proposalId(1),'a'.repeat(64),proposalId(51),proposalId(8),proposalId(2),proposalId(7),proposalId(6),proposalReport().capture.proposalJson,'fictional_worker']);
 assert.ok(c.queries.every(q=>q.rowMode==='array'));assert.equal(c.ended,1);assert.equal(options.application_name,'terrafracta.proposal-worker');
 assert.ok(options.options.includes('default_transaction_read_only=on'));assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.enableChannelBinding,true);assert.equal(options.binary,false);assert.equal(options.replication,false);assert.equal(options.pipeline,false);
 assert.equal(options.statement_timeout,2000);assert.equal(options.query_timeout,2250);assert.equal(options.lock_timeout,500);assert.equal(await t.shutdown(),true);
});
test('recovery uses exact stored identity, canonical content and base with the current claim rather than fresh source input',async()=>{
 const c=new Client();c.result=wire(receipt('replayed'));const t=create(c),report=proposalReport(),w={...work(),workClaimId:proposalId(52)};
 const result=await t.recover(w,{runId:proposalId(1),decisionId:proposalId(2),issueId:proposalId(7)},report,signal());
 assert.equal(result.kind,'confirmed');assert.equal(result.receipt.status,'replayed');assert.equal(c.queries[2].values[2],proposalId(52));assert.equal(c.queries[2].values[7],report.capture.proposalJson);assert.equal(c.queries[2].values[6],proposalId(6));assert.equal(await t.shutdown(),true);
});
test('invalid selectors, foreign work, noncanonical content, preabort and shutdown never acquire a client or log',async()=>{
 let acquired=0;const t=createPostgresWorkProposalTransport(config,async()=>{acquired++;return new Client();},undefined,async()=>assert.fail('expected refusal logged'));
 for(const args of [[null,selection(),payload()],[{...work(),runId:proposalId(99)},selection(),payload()],[work(),{...selection(),sql:'PRIVATE_SQL'},payload()],[work(),selection(),{...payload(),private:'PRIVATE_BODY'}]])assert.deepEqual(await t.capture(...args,signal()),{kind:'not_dispatched'});
 const r=proposalReport();r.capture.proposalSha256='0'.repeat(64);assert.deepEqual(await t.recover(work(),{runId:proposalId(1),decisionId:proposalId(2),issueId:proposalId(7)},r,signal()),{kind:'not_dispatched'});
 const a=new AbortController();a.abort();assert.deepEqual(await t.capture(work(),selection(),payload(),a.signal),{kind:'not_dispatched'});assert.equal(await t.shutdown(),true);
 assert.deepEqual(await t.capture(work(),selection(),payload(),signal()),{kind:'not_dispatched'});assert.equal(acquired,0);
});
test('writer always requires explicit verified TLS and closed server configuration',()=>{
 for(const bad of [{...config,transport:{kind:'loopback-development'},host:'127.0.0.1'},{...config,connectionString:'PRIVATE_URI'},{...config,password:''},{...config,transport:{kind:'verified-tls',rejectUnauthorized:false}}])assert.throws(()=>createPostgresWorkProposalTransport(bad));
});
test('unknown or nonidle transaction state and malformed SET acknowledgements refuse before the capture statement',async()=>{
 for(const change of [c=>c.status=null,c=>c.status='T',c=>c.status='E',c=>c.getTransactionStatus=undefined,
  c=>c.query=async q=>{c.queries.push(q);return {...ack(),rowCount:0};},
  c=>c.query=async q=>{c.queries.push(q);c.status='T';return ack();}]){
  const c=new Client(),calls=[];change(c);const t=create(c,async(...args)=>{calls.push(args);return 'saved';});
  assert.deepEqual(await t.capture(work(),selection(),payload(),signal()),{kind:'not_dispatched'});await turn();assert.deepEqual(calls,[['proposal_capture_write']]);assert.ok(!c.queries.some(q=>q.text===POSTGRES_WORK_PROPOSAL_SQL));assert.equal(await t.shutdown(),true);
 }
});
test('malformed postdispatch result and receipt never become a success and record only a fixed location',async()=>{
 for(const change of [r=>r.command='INSERT',r=>r.rowCount=0,r=>r.fields[1].dataTypeID=3802,r=>r.fields[1].name='body',r=>r.rows[0].push('PRIVATE_EXTRA'),r=>r.rows[0][0]='true',r=>r.rows[0][1]=null,r=>r.rows[0][1]='PRIVATE_BODY',r=>r.rows[0][1]='x'.repeat(2049),r=>r.rows[0][1]=JSON.stringify({...receipt(),proposalSha256:'0'.repeat(64)}),r=>r.rows[0][1]=JSON.stringify({...receipt(),captureId:proposalId(99)}),r=>r.rows[0][1]=JSON.stringify({...receipt(),private:'PRIVATE_PATH'})]){
  const c=new Client(),calls=[];change(c.result);const t=create(c,async(...args)=>{calls.push(args);return 'saved';});
  assert.deepEqual(await t.capture(work(),selection(),payload(),signal()),{kind:'outcome_unknown'});await turn();assert.deepEqual(calls,[['proposal_capture_write']]);assert.equal(c.queries.length,3);assert.equal(c.ended,1);assert.equal(await t.shutdown(),true);
 }
});
test('returned nonidle status remains unknown even when a matching receipt was received',async()=>{
 const c=new Client(),base=c.query.bind(c),calls=[];c.query=async q=>{const value=await base(q);if(q.text===POSTGRES_WORK_PROPOSAL_SQL)c.status='T';return value;};
 const t=create(c,async code=>{calls.push(code);return 'saved';});assert.deepEqual(await t.capture(work(),selection(),payload(),signal()),{kind:'outcome_unknown'});await turn();assert.deepEqual(calls,['proposal_capture_write']);assert.equal(await t.shutdown(),true);
});
test('explicit principal false/null acknowledges that the guarded capture function was not dispatched',async()=>{
 const c=new Client(),calls=[];c.result.rows=[[false,null]];const t=create(c,async code=>{calls.push(code);return 'saved';});assert.deepEqual(await t.capture(work(),selection(),payload(),signal()),{kind:'not_dispatched'});await turn();assert.deepEqual(calls,['proposal_capture_write']);assert.equal(await t.shutdown(),true);
});
test('dependency, fence and conflict SQL refusals stay silent but make no promise about previous durable writes',async()=>{
 for(const code of ['23514','23505','40001']){
  const c=new Client(),base=c.query.bind(c);c.query=async q=>{if(q.text===POSTGRES_WORK_PROPOSAL_SQL){c.queries.push(q);throw Object.assign(Error('PRIVATE_DATABASE_BODY'),{code});}return base(q);};
  const t=create(c);assert.deepEqual(await t.capture(work(),selection(),payload(),signal()),{kind:'outcome_unknown'});await turn();assert.equal(c.queries.length,3);assert.equal(await t.shutdown(),true);
 }
});
test('unexpected SQL failures record once; throwing, rejected and stalled loggers never mask the original outcome',async()=>{
 for(const record of [async()=>{throw Error('PRIVATE_LOGGER');},()=>Promise.reject(Error('PRIVATE_LOGGER')),()=>new Promise(()=>{})]){
  const c=new Client(),base=c.query.bind(c);c.query=async q=>{if(q.text===POSTGRES_WORK_PROPOSAL_SQL)throw Object.assign(Error('PRIVATE_SQL'),{code:'42501'});return base(q);};
  const t=create(c,record);assert.deepEqual(await t.capture(work(),selection(),payload(),signal()),{kind:'outcome_unknown'});await turn();assert.equal(await t.shutdown(),true);
 }
});
test('caller cancellation before and after dispatch returns promptly and consumes late success or failure without logs or retry',async()=>{
 for(const stage of ['setting','capture'])for(const late of ['success','failure']){
  const c=new Client(),base=c.query.bind(c),wait=deferred(),a=new AbortController();let entered=false;
  c.query=async q=>{if((stage==='setting'&&q.text.startsWith('SET'))||(stage==='capture'&&q.text===POSTGRES_WORK_PROPOSAL_SQL)){c.queries.push(q);entered=true;return wait.promise;}return base(q);};
  const t=create(c),pending=t.capture(work(),selection(),payload(),a.signal);await turn();assert.equal(entered,true);a.abort();assert.deepEqual(await pending,{kind:stage==='capture'?'outcome_unknown':'not_dispatched'});
  if(late==='failure')wait.reject(Error('PRIVATE_LATE'));else wait.resolve(stage==='capture'?wire():ack());await turn();assert.equal(c.queries.filter(q=>q.text===POSTGRES_WORK_PROPOSAL_SQL).length,stage==='capture'?1:0);assert.equal(await t.shutdown(),true);
 }
});
test('uncertain client acquisition owns both slots until late clients close and settled work is drained',async()=>{
 const waits=[deferred(),deferred()],parents=[new AbortController(),new AbortController()],calls=[];let index=0;
 const t=createPostgresWorkProposalTransport(config,async()=>waits[index++].promise,undefined,async code=>{calls.push(code);return 'saved';});
 const pending=parents.map(a=>t.capture(work(),selection(),payload(),a.signal));await turn();assert.deepEqual(await t.capture(work(),selection(),payload(),signal()),{kind:'not_dispatched'});await turn();assert.deepEqual(calls,['proposal_capture_write']);assert.equal(index,2);
 parents.forEach(a=>a.abort());assert.deepEqual(await Promise.all(pending),[{kind:'not_dispatched'},{kind:'not_dispatched'}]);assert.equal(await t.shutdown(),false);
 const clients=waits.map(()=>new Client());waits.forEach((w,i)=>w.resolve(clients[i]));await turn();assert.ok(clients.every(c=>c.ended===1&&c.queries.length===0));assert.equal(await t.shutdown(),true);
});
test('lost close acknowledgement after a matching receipt stays unknown and holds the owned slot',async()=>{
 const c=new Client(),wait=deferred(),calls=[];c.end=()=>{c.ended++;return wait.promise;};const t=create(c,async code=>{calls.push(code);return 'saved';});
 assert.deepEqual(await t.capture(work(),selection(),payload(),signal()),{kind:'outcome_unknown'});await turn();assert.deepEqual(calls,['proposal_capture_write']);assert.equal(c.ended,1);assert.equal(await t.shutdown(),false);wait.resolve();await turn();assert.equal(await t.shutdown(),true);
});
test('owned deadline aborts a stalled capture, emits one fixed technical code and consumes its late receipt',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const c=new Client(),wait=deferred(),base=c.query.bind(c),calls=[];
 c.query=q=>q.text===POSTGRES_WORK_PROPOSAL_SQL?(c.queries.push(q),wait.promise):base(q);
 const transport=create(c,async code=>{calls.push(code);return 'saved';},()=>0),pending=transport.capture(work(),selection(),payload(),signal());await turn();assert.equal(c.queries.length,3);
 t.mock.timers.tick(2500);assert.deepEqual(await pending,{kind:'outcome_unknown'});await turn();assert.deepEqual(calls,['proposal_capture_write']);wait.resolve(wire());await turn();assert.equal(await transport.shutdown(),true);
});
