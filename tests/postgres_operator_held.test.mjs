import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {createPostgresOperatorAuditTransport,POSTGRES_OPERATOR_HELD_DECISIONS_SQL} from '../src/server/postgres-operator-audit-provider.ts';
import {createHeldDecisionsReader} from '../src/server/operator-held-decisions-reader.ts';
import {heldId,heldScope,heldReport} from './helpers/operator_held_fixture.mjs';
import {scope} from './helpers/operator_audit_fixture.mjs';
const config={host:'db.example.org',port:5432,database:'terrafracta',user:'fictional_operator',password:'FICTITIOUS_ONLY',transport:{kind:'verified-tls'}};
const ack=command=>({command,rowCount:null,fields:[],rows:[]}),signal=()=>new AbortController().signal;
const output=x=>({command:'SELECT',rowCount:1,fields:[{name:'admitted',dataTypeID:16},{name:'held',dataTypeID:25}],rows:[[true,JSON.stringify(x)]]});
class Client extends EventEmitter {queries=[];ended=0;result=output(heldReport());async connect(){}async query(q){this.queries.push(q);return q.text===POSTGRES_OPERATOR_HELD_DECISIONS_SQL?this.result:ack(q.text.split(' ')[0]);}async end(){this.ended++;}}
test('held transport uses same owned read-only transaction with exact detached parameters',async()=>{
 const c=new Client(),t=createPostgresOperatorAuditTransport(config,async()=>c),read=createHeldDecisionsReader(t.readHeld,undefined,()=>Promise.resolve());
 assert.equal((await read(heldScope())).kind,'ok');assert.deepEqual(c.queries.map(x=>x.text),['BEGIN READ ONLY','SET LOCAL ROLE terra_reviewer',POSTGRES_OPERATOR_HELD_DECISIONS_SQL,'ROLLBACK']);
 assert.deepEqual(c.queries[2].values,['fictional_operator',heldId(1),null,null]);assert.equal(c.ended,1);
 const request=heldScope({decidedAt:'2026-10-05T09:01:00.000001Z',decisionId:heldId(9)}),expected=structuredClone(request);c.result=output({schemaVersion:1,status:'changed',requested:expected});
 const pending=t.readHeld(request,signal());request.cursor.decisionId=heldId(99);await pending;assert.deepEqual(c.queries[6].values,['fictional_operator',heldId(1),expected.cursor.decidedAt,heldId(9)]);
 assert.equal(await t.shutdown(),true);await assert.rejects(t.readHeld(heldScope(),signal()),{message:'read_unavailable'});
});
test('held malformed selectors, result columns and rollback fail closed without leaking or extra clients',async()=>{
 let calls=0;const t=createPostgresOperatorAuditTransport(config,async()=>{calls++;return new Client();});
 for(const s of [null,[],{}, {...heldScope(),sql:'PRIVATE_CANARY'}])await assert.rejects(t.readHeld(s,signal()),{message:'read_unavailable'});assert.equal(calls,0);assert.equal(await t.shutdown(),true);
 for(const mutate of [r=>r.rows[0][0]=false,r=>r.rows[0][1]=null,r=>r.fields[1].name='choices',r=>r.fields[1].dataTypeID=3802,r=>r.rows[0][1]='é'.repeat(32769)]){
  const c=new Client();mutate(c.result);const t=createPostgresOperatorAuditTransport(config,async()=>c);
  assert.deepEqual(await createHeldDecisionsReader(t.readHeld,undefined,()=>Promise.resolve())(heldScope()),{kind:'unavailable'});assert.equal(c.ended,1);assert.equal(await t.shutdown(),true);
 }
 const c=new Client(),query=c.query.bind(c);c.query=q=>q.text==='ROLLBACK'?Promise.resolve(ack('OTHER')):query(q);const broken=createPostgresOperatorAuditTransport(config,async()=>c);
 assert.deepEqual(await createHeldDecisionsReader(broken.readHeld,undefined,()=>Promise.resolve())(heldScope()),{kind:'unavailable'});assert.equal(await broken.shutdown(),true);
});
test('held choices and audit share the same two slots through uncertain acquisition cancellation',async()=>{
 const pending=[];let calls=0;const t=createPostgresOperatorAuditTransport(config,async()=>{calls++;return new Promise(r=>pending.push(r));}),a=new AbortController(),b=new AbortController();
 const one=t.readHeld(heldScope(),a.signal),two=t.readChoices(null,b.signal);
 await assert.rejects(t.readAudit(scope(),signal()),{message:'read_unavailable'});await assert.rejects(t.readHeld(heldScope(),signal()),{message:'read_unavailable'});assert.equal(calls,2);
 a.abort();b.abort();await Promise.all([assert.rejects(one),assert.rejects(two)]);assert.equal(await t.shutdown(),false);
 const clients=[new Client(),new Client()];pending.forEach((done,i)=>done(clients[i]));await new Promise(r=>setImmediate(r));assert.ok(clients.every(c=>c.ended===1&&c.queries.length===0));assert.equal(await t.shutdown(),true);
});
