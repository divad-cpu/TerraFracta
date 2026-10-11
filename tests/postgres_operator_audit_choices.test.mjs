import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createPostgresOperatorAuditTransport, POSTGRES_OPERATOR_AUDIT_SQL, POSTGRES_OPERATOR_AUDIT_CHOICES_SQL } from '../src/server/postgres-operator-audit-provider.ts';
import { createOperatorAuditChoicesReader } from '../src/server/operator-audit-choices-reader.ts';
import { choices,choiceId } from './helpers/operator_audit_choices_fixture.mjs';
import { scope } from './helpers/operator_audit_fixture.mjs';
const config={host:'db.example.org',port:5432,database:'terrafracta',user:'fictional_operator',password:'FICTITIOUS_ONLY',transport:{kind:'verified-tls'}};
const ack=command=>({command,rowCount:null,fields:[],rows:[]}),signal=()=>new AbortController().signal;
const output=value=>({command:'SELECT',rowCount:1,fields:[{name:'admitted',dataTypeID:16},{name:'choices',dataTypeID:25}],rows:[[true,JSON.stringify(value)]]});
class Client extends EventEmitter {
  queries=[];ended=0;result=output(choices());
  async connect(){}
  async query(q){this.queries.push(q);return q.text===POSTGRES_OPERATOR_AUDIT_CHOICES_SQL?this.result:ack(q.text.split(' ')[0]);}
  async end(){this.ended++;}
}
const quiet=()=>Promise.resolve();

test('cursor values remain detached fixed SQL parameters; malformed continuation never acquires a client',async()=>{
  const c=new Client(),t=createPostgresOperatorAuditTransport(config,async()=>c),cursor={createdAt:'2026-10-05T09:00:00.000001Z',runId:choiceId(10)};
  c.result=output({schemaVersion:2,status:'changed',requestedRunId:null,requestedCursor:cursor});
  const input={...cursor},pending=t.readChoices(null,signal(),input);input.runId=choiceId(99);
  await pending;assert.deepEqual(c.queries[2].values,['fictional_operator',null,cursor.createdAt,cursor.runId]);
  assert.equal(c.queries[2].text,POSTGRES_OPERATOR_AUDIT_CHOICES_SQL);assert.equal(c.ended,1);
  await assert.rejects(t.readChoices(null,signal(),{...cursor,sql:'PRIVATE_CANARY'}),{message:'read_unavailable'});assert.equal(c.queries.length,4);assert.equal(await t.shutdown(),true);
});

test('choices use fixed same read-only transaction and exact username/nullable selection binds',async()=>{
  const c=new Client(),t=createPostgresOperatorAuditTransport(config,async()=>c),read=createOperatorAuditChoicesReader(t.readChoices,undefined,quiet);
  assert.equal((await read()).kind,'ok');assert.equal(c.ended,1);
  assert.deepEqual(c.queries.map(q=>q.text),['BEGIN READ ONLY','SET LOCAL ROLE terra_reviewer',POSTGRES_OPERATOR_AUDIT_CHOICES_SQL,'ROLLBACK']);
  assert.deepEqual(c.queries[2].values,['fictional_operator',null,null,null]);assert.ok(c.queries.every(q=>q.rowMode==='array'));
  c.result=output(choices(choiceId(1)));assert.equal((await read(choiceId(1))).kind,'ok');assert.deepEqual(c.queries[6].values,['fictional_operator',choiceId(1),null,null]);
  assert.equal(await t.shutdown(),true);await assert.rejects(t.readChoices(null,signal()),{message:'read_unavailable'});
});

test('malformed identity/result/rollback never returns choices or creates false absence',async()=>{
  for(const mutate of [r=>r.rows[0][0]=false,r=>r.rows[0][1]=null,r=>r.fields[1].name='audit',r=>r.fields[1].dataTypeID=3802,
    r=>r.rows[0][1]='é'.repeat(32769),r=>r.rows[0].push('PRIVATE_CANARY')]){
    const c=new Client();mutate(c.result);const t=createPostgresOperatorAuditTransport(config,async()=>c);
    assert.deepEqual(await createOperatorAuditChoicesReader(t.readChoices,undefined,quiet)(),{kind:'unavailable'});assert.equal(c.ended,1);assert.equal(await t.shutdown(),true);
  }
  const c=new Client(),original=c.query.bind(c);c.query=async q=>q.text==='ROLLBACK'?ack('OTHER'):original(q);
  const t=createPostgresOperatorAuditTransport(config,async()=>c);assert.deepEqual(await createOperatorAuditChoicesReader(t.readChoices,undefined,quiet)(),{kind:'unavailable'});assert.equal(await t.shutdown(),true);
});

test('choices and audit share two ownership slots including unresolved acquisition and shutdown',async()=>{
  const pending=[];let calls=0;const t=createPostgresOperatorAuditTransport(config,async()=>{calls++;return new Promise(resolve=>pending.push(resolve));});
  const a=new AbortController(),b=new AbortController();
  const first=t.readChoices(null,a.signal),second=t.readAudit(scope(),b.signal);
  await assert.rejects(t.readChoices(choiceId(1),signal()),{message:'read_unavailable'});
  await assert.rejects(t.readAudit(scope(),signal()),{message:'read_unavailable'});assert.equal(calls,2);
  a.abort();b.abort();await Promise.all([assert.rejects(first),assert.rejects(second)]);assert.equal(await t.shutdown(),false);
  const clients=[new Client(),new Client()];pending.forEach((done,i)=>done(clients[i]));await new Promise(resolve=>setImmediate(resolve));
  assert.ok(clients.every(c=>c.ended===1&&c.queries.length===0));assert.equal(await t.shutdown(),true);
});

test('invalid choices selectors never acquire a connection or accept SQL selectors',async()=>{
  let calls=0;const t=createPostgresOperatorAuditTransport(config,async()=>{calls++;return new Client();});
  for(const value of [undefined,{},[],{runId:choiceId(1),sql:POSTGRES_OPERATOR_AUDIT_SQL},'PRIVATE_CANARY'])await assert.rejects(t.readChoices(value,signal()),{message:'read_unavailable'});
  assert.equal(calls,0);assert.equal(await t.shutdown(),true);
});
