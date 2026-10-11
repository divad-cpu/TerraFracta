import assert from 'node:assert/strict';import test from 'node:test';import {EventEmitter} from 'node:events';
import {createPostgresOperatorAuditTransport,POSTGRES_OPERATOR_PROPOSAL_SQL} from '../src/server/postgres-operator-audit-provider.ts';
import {createProposalReader} from '../src/server/operator-proposal-reader.ts';import {proposalReport,proposalScope,proposalId} from './helpers/proposal_fixture.mjs';
const config={host:'db.example.org',port:5432,database:'terra_private',user:'fictional_operator',password:'invented-password',transport:{kind:'verified-tls'}};
const ack=command=>({command,rowCount:null,fields:[],rows:[]}),signal=()=>new AbortController().signal;
const output=x=>({command:'SELECT',rowCount:1,fields:[{name:'admitted',dataTypeID:16},{name:'proposal',dataTypeID:25}],rows:[[true,JSON.stringify(x)]]});
class Client extends EventEmitter {queries=[];ended=0;result=output(proposalReport());async connect(){}async query(q){this.queries.push(q);return q.text===POSTGRES_OPERATOR_PROPOSAL_SQL?this.result:ack(q.text.split(' ')[0]);}async end(){this.ended++;}}
test('proposal shares literal verified-TLS read-only owner, detached UUIDs, exact result column and rollback',async()=>{
 const c=new Client(),t=createPostgresOperatorAuditTransport(config,async()=>c),request=proposalScope();
 assert.equal((await createProposalReader(t.readProposal,()=>0,async()=> 'saved')(request)).kind,'ok');
 assert.deepEqual(c.queries.map(q=>q.text),['BEGIN READ ONLY','SET LOCAL ROLE terra_reviewer',POSTGRES_OPERATOR_PROPOSAL_SQL,'ROLLBACK']);
 assert.deepEqual(c.queries[2].values,['fictional_operator',proposalId(1),proposalId(2)]);assert.equal(c.ended,1);
 const p=t.readProposal(request,signal());request.decisionId=proposalId(99);await p;assert.deepEqual(c.queries[6].values,['fictional_operator',proposalId(1),proposalId(2)]);
 assert.equal(await t.shutdown(),true);await assert.rejects(t.readProposal(proposalScope(),signal()),{message:'read_unavailable'});
});
test('foreign selectors/wire identities, failed rollback and malformed SQL result fail closed',async()=>{
 let opened=0;const t=createPostgresOperatorAuditTransport(config,async()=>{opened++;return new Client();});
 for(const s of [null,[],{}, {...proposalScope(),sql:'PRIVATE_CANARY'}])await assert.rejects(t.readProposal(s,signal()));assert.equal(opened,0);assert.equal(await t.shutdown(),true);
 for(const change of [r=>r.fields[1].name='held',r=>r.rows[0][0]=false,r=>r.fields[1].dataTypeID=3802,r=>r.rows[0][1]=null]){
  const c=new Client();change(c.result);const t=createPostgresOperatorAuditTransport(config,async()=>c);
  assert.deepEqual(await createProposalReader(t.readProposal,()=>0,async()=> 'saved')(proposalScope()),{kind:'unavailable'});assert.equal(c.ended,1);assert.equal(await t.shutdown(),true);}
});
test('proposal and older audit calls use shared two slots; cancelled uncertain acquisition retains slots until closed',async()=>{
 const pending=[];let calls=0;const t=createPostgresOperatorAuditTransport(config,async()=>{calls++;return new Promise(r=>pending.push(r));});
 const a=new AbortController(),b=new AbortController(),one=t.readProposal(proposalScope(),a.signal),two=t.readChoices(null,b.signal);
 await assert.rejects(t.readProposal(proposalScope(),signal()));assert.equal(calls,2);a.abort();b.abort();await Promise.all([assert.rejects(one),assert.rejects(two)]);
 assert.equal(await t.shutdown(),false);pending.forEach(done=>done(new Client()));await new Promise(r=>setImmediate(r));assert.equal(await t.shutdown(),true);
});
