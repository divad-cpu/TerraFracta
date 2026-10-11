import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createPostgresOperatorAuditTransport, POSTGRES_OPERATOR_AUDIT_SQL } from '../src/server/postgres-operator-audit-provider.ts';
import { createOperatorAuditReader, readOperatorAudit, OPERATOR_AUDIT_BYTES } from '../src/server/operator-audit-reader.ts';
import { audit, scope, id } from './helpers/operator_audit_fixture.mjs';

const config = () => ({host:'db.example.org',port:5432,database:'terrafracta',user:'fictional_operator',
  password:'FICTITIOUS_TEST_ONLY',transport:{kind:'verified-tls',ca:'FICTITIOUS_CERTIFICATE'}});
const signal = () => new AbortController().signal;
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const ack = command => ({command,rowCount:null,fields:[],rows:[]});
const result = value => ({command:'SELECT',rowCount:1,fields:[{name:'admitted',dataTypeID:16},{name:'audit',dataTypeID:25}],
  rows:[[true,JSON.stringify(value)]]});
class Client extends EventEmitter {
  connected=0;ended=0;queries=[];output=result(audit());
  async connect(){this.connected++;}
  async query(query){this.queries.push(query);return query.text===POSTGRES_OPERATOR_AUDIT_SQL?this.output:ack(query.text.split(' ')[0]);}
  async end(){this.ended++;}
}
const readWith = (transport, intents=[]) => createOperatorAuditReader(transport.readAudit,undefined,code=>{intents.push(code);return Promise.resolve();});

test('actual reader accepts bounded metadata after fixed read-only transaction, rollback and close; defaults stay inactive',async()=>{
  const clients=[],options=[],intents=[];
  const t=createPostgresOperatorAuditTransport(config(),async value=>{options.push(value);const c=new Client();clients.push(c);return c;});
  const read=readWith(t,intents);
  assert.equal((await read(scope())).kind,'ok');assert.equal((await read(scope())).kind,'ok');
  assert.equal(clients.length,2);
  for(const c of clients){
    assert.equal(c.connected,1);assert.equal(c.ended,1);
    assert.deepEqual(c.queries.map(q=>q.text),['BEGIN READ ONLY','SET LOCAL ROLE terra_reviewer',POSTGRES_OPERATOR_AUDIT_SQL,'ROLLBACK']);
    assert.deepEqual(c.queries[2].values,[id(1),id(2),null,null,null,'fictional_operator']);
    assert.ok(c.queries.every(q=>q.rowMode==='array'));
  }
  for(const o of options){assert.ok(Object.isFrozen(o));assert.equal(o.ssl.rejectUnauthorized,true);assert.equal(o.ssl.ca,'FICTITIOUS_CERTIFICATE');
    assert.equal(o.application_name,'terrafracta.operator-audit');assert.equal(o.enableChannelBinding,true);assert.equal(o.pipeline,false);
    assert.equal(o.connectionString,undefined);assert.ok(o.options.includes('default_transaction_read_only=on'));}
  assert.deepEqual(intents,[]);assert.deepEqual(await readOperatorAudit(scope()),{kind:'unconfigured'});
  assert.equal(await t.shutdown(),true);await assert.rejects(t.readAudit(scope(),signal()),{message:'read_unavailable'});assert.equal(clients.length,2);
});

test('pagination parameters remain separate from SQL and requested cursor; changed and missing are ordinary outcomes',async()=>{
  const c=new Client(),t=createPostgresOperatorAuditTransport(config(),async()=>c),intents=[],read=readWith(t,intents);
  const cursor={latestRevision:2,headPublicationId:id(6),beforeRevision:2};
  const requested={...scope(),cursor};
  const value=audit();value.requested=requested;value.history.publications=value.history.publications.slice(1);
  c.output=result(value);assert.equal((await read(requested)).kind,'ok');
  assert.deepEqual(c.queries[2].values,[id(1),id(2),2,id(6),2,'fictional_operator']);
  for(const status of ['changed','not_found']){c.output=result({schemaVersion:1,status,requested});assert.deepEqual(await read(requested),{kind:status});}
  assert.deepEqual(intents,[]);assert.equal(await t.shutdown(),true);
});

test('invalid scope, prior cancellation and prohibited configuration never construct clients',async()=>{
  let calls=0;const t=createPostgresOperatorAuditTransport(config(),async()=>{calls++;return new Client();});
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(t.readAudit(scope(),cancelled.signal),{message:'read_unavailable'});
  for(const bad of [null,{...scope(),sql:'PRIVATE_CANARY'},{...scope(),runId:'../private'},
    {...scope(),cursor:{latestRevision:2,headPublicationId:null,beforeRevision:3}}])
    await assert.rejects(t.readAudit(bad,signal()),{message:'read_unavailable'});
  const old=process.env.NODE_ENV;
  try{process.env.NODE_ENV='development';
    for(const bad of [{...config(),host:'127.0.0.1',transport:{kind:'loopback-development'}},
      {...config(),transport:{kind:'verified-tls',rejectUnauthorized:false}},{...config(),user:'terra_reviewer; SELECT private'},
      {...config(),connectionString:'PRIVATE_CANARY'},{...config(),transport:{kind:'verified-tls',key:'PRIVATE_KEY_CANARY'}}])
      assert.throws(()=>createPostgresOperatorAuditTransport(bad),{message:'read_unavailable'});
  }finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}
  assert.equal(calls,0);assert.equal(await t.shutdown(),true);
});

test('SQL null, denied identities, altered column types and oversized UTF8 never become reports',async()=>{
  const mutations=[r=>r.rows[0][0]=false,r=>r.rows[0][1]=null,r=>r.fields[1].dataTypeID=3802,
    r=>r.fields[0].dataTypeID=25,r=>r.fields[1].name='candidate',r=>r.rowCount=2,r=>r.rows.push([true,'{}']),
    r=>r.rows[0].push('PRIVATE_CANARY'),r=>r.rows[0][1]='é'.repeat(OPERATOR_AUDIT_BYTES/2+1)];
  for(const mutate of mutations){const c=new Client();mutate(c.output);const intents=[];
    const t=createPostgresOperatorAuditTransport(config(),async()=>c);
    assert.deepEqual(await readWith(t,intents)(scope()),{kind:'unavailable'});assert.deepEqual(intents,['operator_audit_read']);
    assert.equal(c.ended,1);assert.equal(c.queries.some(q=>q.text==='ROLLBACK'),false);assert.equal(await t.shutdown(),true);}
});

test('failed or unacknowledged transaction phases do not continue or expose earlier metadata',async()=>{
  for(const phase of ['BEGIN READ ONLY','SET LOCAL ROLE terra_reviewer',POSTGRES_OPERATOR_AUDIT_SQL,'ROLLBACK']){
    for(const failure of ['throw','wrong_ack']){const c=new Client(),original=c.query.bind(c);
      c.query=async q=>{if(q.text!==phase)return original(q);c.queries.push(q);
        if(failure==='throw')throw new Error('PRIVATE_PASSWORD_SQL_CANARY');return ack('OTHER');};
      const t=createPostgresOperatorAuditTransport(config(),async()=>c);
      assert.deepEqual(await readWith(t)(scope()),{kind:'unavailable'});assert.equal(c.ended,1);
      assert.equal(c.queries.at(-1).text,phase);assert.equal(await t.shutdown(),true);
    }
  }
});

test('late or cancelled transaction phases stop before further queries and close once',async()=>{
  for(const phase of ['BEGIN READ ONLY','SET LOCAL ROLE terra_reviewer',POSTGRES_OPERATOR_AUDIT_SQL,'ROLLBACK']){
    const answer=deferred(),c=new Client(),original=c.query.bind(c),cancel=new AbortController(),intents=[];
    c.query=async q=>{if(q.text!==phase)return original(q);c.queries.push(q);return answer.promise;};
    const t=createPostgresOperatorAuditTransport(config(),async()=>c),pending=readWith(t,intents)(scope(),cancel.signal);
    await turn();cancel.abort();assert.deepEqual(await pending,{kind:'unavailable'});assert.equal(c.ended,1);
    answer.resolve(phase===POSTGRES_OPERATOR_AUDIT_SQL?c.output:ack(phase.split(' ')[0]));await turn();
    assert.equal(c.queries.at(-1).text,phase);assert.equal(c.ended,1);assert.deepEqual(intents,[]);assert.equal(await t.shutdown(),true);
  }
});

test('total monotonic deadline spans all phases rather than restarting for each statement',async()=>{
  for(const phase of ['BEGIN READ ONLY','SET LOCAL ROLE terra_reviewer',POSTGRES_OPERATOR_AUDIT_SQL,'ROLLBACK']){
    let clock=0;const c=new Client(),original=c.query.bind(c);
    c.query=async q=>{const out=await original(q);clock+=625;if(q.text===phase)clock=2500;return out;};
    const t=createPostgresOperatorAuditTransport(config(),async()=>c,()=>clock);
    assert.deepEqual(await readWith(t)(scope()),{kind:'unavailable'});assert.equal(c.queries.at(-1).text,phase);
    assert.equal(await t.shutdown(),true);assert.equal(c.ended,1);
  }
});

test('two owned slots include uncertain acquisition and do not admit more work before closure',async()=>{
  const waits=[deferred(),deferred()];let calls=0;
  const t=createPostgresOperatorAuditTransport(config(),async()=>waits[calls++].promise),a=new AbortController(),b=new AbortController();
  const reads=[t.readAudit(scope(),a.signal),t.readAudit(scope(),b.signal)];
  await assert.rejects(t.readAudit(scope(),signal()),{message:'read_unavailable'});assert.equal(calls,2);
  a.abort();b.abort();await Promise.all(reads.map(p=>assert.rejects(p,{message:'read_unavailable'})));
  assert.equal(await t.shutdown(),false);
  const clients=[new Client(),new Client()];waits.forEach((w,i)=>w.resolve(clients[i]));await turn();
  assert.equal(await t.shutdown(),true);assert.ok(clients.every(c=>c.connected===0&&c.queries.length===0&&c.ended===1));
});

test('close rejection or missing acknowledgement holds success and capacity without repeating close',async()=>{
  for(const mode of ['rejected','delayed']){const ending=deferred(),clients=[];
    const t=createPostgresOperatorAuditTransport(config(),async()=>{const c=new Client();
      c.end=async()=>{c.ended++;if(mode==='rejected')throw new Error('PRIVATE_CLOSE_CANARY');return ending.promise;};clients.push(c);return c;});
    for(let i=0;i<3;i++)assert.deepEqual(await readWith(t)(scope()),{kind:'unavailable'});
    assert.equal(clients.length,2);assert.equal(await t.shutdown(),false);assert.ok(clients.every(c=>c.ended===1));
    if(mode==='delayed'){ending.resolve();await turn();assert.equal(await t.shutdown(),true);}
  }
});

test('default driver refuses ambient native, replication and binary selectors without credentials escaping',async()=>{
  for(const key of ['NODE_PG_FORCE_NATIVE','PGREPLICATION','PGBINARY']){const old=process.env[key];
    try{process.env[key]='1';const t=createPostgresOperatorAuditTransport(config());
      await assert.rejects(t.readAudit(scope(),signal()),{message:'read_unavailable'});assert.equal(await t.shutdown(),true);
    }finally{if(old===undefined)delete process.env[key];else process.env[key]=old;}}
});
