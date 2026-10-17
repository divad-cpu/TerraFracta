// Invented pre-capture owner observation only. No writer, claim or default.
import assert from 'node:assert/strict';
import {readSync,writeSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
import {createPostgresIssuePreparationContextReader,prepareIssuePreparationContextRead,parseStoredIssuePreparationContext,ISSUE_PREPARATION_CONTEXT_SQL as CONTEXT} from '../src/server/issue-preparation-context.ts';
import {POSTGRES_APPENDED_OWNER_GUARD_SQL as GUARD} from '../src/server/postgres-appended-capture-provider.ts';
const BEGIN='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',FAULTS={read_write:'SET TRANSACTION READ WRITE',read_committed:'SET TRANSACTION ISOLATION LEVEL READ COMMITTED'};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
async function observation(){const began=performance.now(),first=Date.now();let previous=began,wall=first;assert.ok(Number.isFinite(began)&&Number.isSafeInteger(first));for(;;){await new Promise(r=>setTimeout(r,0));const tick=performance.now(),now=Date.now();assert.ok(Number.isFinite(tick)&&tick>=previous&&tick-began<20&&Number.isSafeInteger(now)&&now>=wall);previous=tick;wall=now;if(now>first)return new Date(now).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');}}
const owners=[],all=[];let stage='startup';
try{
 const b=Buffer.alloc(294913);let n=0;while(n<b.length){const k=readSync(0,b,n,b.length-n,null);if(!k)break;n+=k;}assert.ok(n>=2&&n<=294912);const raw=b.subarray(0,n),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(raw);assert.ok(Buffer.from(text).equals(raw));const v=JSON.parse(text);
 assert.deepEqual(Object.keys(v).sort(),['baselineBase64','expected','mode','scope','socketDirectory']);assert.equal(v.mode,'suite');
 const socket=v.socketDirectory;assert.equal(typeof socket,'string');assert.match(socket,/^\/tmp\/tf-feed-postgres-trial-\d{8}T\d{6}Z-[a-f0-9]{8}\/protocol-socket$/);assert.ok(Buffer.byteLength(socket+'/.s.PGSQL.5432')<104);const proof=process.cwd().replace(/\/inputs$/,'');assert.equal(process.cwd(),proof+'/inputs');assert.equal(socket,proof+'/protocol-socket');assert.equal(realpathSync(proof),proof);assert.equal(realpathSync(socket),socket);
 for(const [p,mode]of[[proof,0o700],[socket,0o1777]]){const s=lstatSync(p);assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.equal(s.uid,process.getuid());assert.equal(s.mode&0o7777,mode);}assert.ok(lstatSync(socket+'/.s.PGSQL.5432').isSocket());assert.equal(process.env.NODE_ENV,'development');assert.ok(Object.keys(process.env).every(k=>['PATH','LANG','TZ','NODE_ENV'].includes(k)));
 assert.equal(typeof v.baselineBase64,'string');const baseline=Buffer.from(v.baselineBase64,'base64');assert.equal(baseline.toString('base64'),v.baselineBase64);assert.ok(baseline.length>0&&baseline.length<=24576);const baselineText=new TextDecoder('utf8',{fatal:true}).decode(baseline);assert.ok(Buffer.from(baselineText).equals(baseline));const prepared=prepareIssuePreparationContextRead(v.scope);assert.equal(sha(baseline),v.expected.head.contentSha256);
 const config={host:'127.0.0.1',port:5432,database:'postgres',user:'postgres',password:'INVENTED_LOCAL_NONSECRET_PLACEHOLDER',transport:{kind:'loopback-development'}};
 function harness(fault){
  const records=[],codes=[],native=[];let reads=0,observers=0,activeScope=v.scope;
  const factory=async o=>{
   assert.deepEqual(Object.keys(o).sort(),['application_name','binary','client_encoding','connectionTimeoutMillis','database','enableChannelBinding','fallback_application_name','host','idle_in_transaction_session_timeout','lock_timeout','options','password','pipeline','port','query_timeout','replication','ssl','sslnegotiation','statement_timeout','user'].sort());assert.equal(o.host,'127.0.0.1');assert.equal(o.port,5432);assert.equal(o.database,'postgres');assert.equal(o.user,'postgres');assert.equal(o.ssl,false);assert.equal(o.binary,false);assert.equal(o.replication,false);assert.equal(o.pipeline,false);assert.equal(o.sslnegotiation,'postgres');assert.equal(o.enableChannelBinding,true);assert.equal(o.client_encoding,'UTF8');assert.equal(o.connectionTimeoutMillis,1000);assert.equal(o.statement_timeout,2000);assert.equal(o.query_timeout,2250);assert.equal(o.lock_timeout,500);assert.equal(o.idle_in_transaction_session_timeout,2000);assert.equal(o.application_name,'terrafracta.operator-audit');assert.equal(o.fallback_application_name,'terrafracta.operator-audit');assert.equal(o.options,'-c default_transaction_read_only=on -c search_path=pg_catalog,pg_temp -c client_connection_check_interval=100');assert.equal(typeof o.password,'string');
   const c=new Client({...o,host:socket,port:5432});assert.equal(c.connectionParameters.isDomainSocket,true);assert.equal(c.binary,false);assert.ok(c.replication===false||c.replication===undefined);const r={pid:null,fault:fault??null,closeCalls:0,closeAcknowledged:false,queries:[]};records.push(r);all.push(r);const connect=c.connect.bind(c),query=c.query.bind(c),end=c.end.bind(c);
   c.connect=async()=>{await connect();assert.ok(Number.isInteger(c.processID)&&c.processID>0);r.pid=c.processID;};
   c.query=async q=>{
    assert.deepEqual(Object.keys(q).sort(),['rowMode','text','values']);assert.equal(q.rowMode,'array');let phase;
    if(q.text===BEGIN||q.text==='ROLLBACK'){phase=q.text===BEGIN?'begin':'rollback';assert.deepEqual(q.values,[]);}
    else if(q.text===GUARD){phase='guard';assert.deepEqual(q.values,[]);}
    else if(q.text===CONTEXT){phase='context';assert.deepEqual(q.values,[...prepareIssuePreparationContextRead(activeScope).values]);reads++;}
    else throw Error('foreign_context_query');
    const item={phase,valueCount:q.values.length};r.queries.push(item);const out=await query(q);item.command=out.command;item.rowCount=out.rowCount;item.fields=out.fields.map(f=>({name:f.name,dataTypeID:f.dataTypeID}));item.rows=out.rows.length;
    if(phase==='begin'&&fault){const changed=await query({text:FAULTS[fault],values:[],rowMode:'array'});assert.equal(changed.command,'SET');assert.equal(changed.rowCount,null);assert.deepEqual(changed.fields,[]);assert.deepEqual(changed.rows,[]);r.queries.push({phase:'trusted_lab_'+fault,command:'SET'});}
    if(phase==='guard'){assert.deepEqual(item.fields,[{name:'admitted',dataTypeID:16}]);assert.deepEqual(out.rows,[[!fault]]);}
    if(phase==='context'){assert.equal(out.rowCount,1);assert.deepEqual(item.fields,[{name:'context',dataTypeID:25}]);assert.equal(typeof out.rows[0][0],'string');native.push(out.rows[0][0]);item.nativeBytes=Buffer.byteLength(out.rows[0][0]);item.nativeSHA256=sha(out.rows[0][0]);}
    return out;
   };
   c.end=()=>{r.closeCalls++;assert.equal(r.closeCalls,1);return end().then(()=>{r.closeAcknowledged=true;});};return c;
  };
  const owner=createPostgresReadOwner(config,'terrafracta.operator-audit',false,factory);owners.push(owner);const read=createPostgresIssuePreparationContextReader(owner,async()=>{observers++;return observation();},async code=>{codes.push(code);return 'saved';});
  return {owner,records,codes,native,read:async(scope,expected,signal)=>{activeScope=scope;return read(scope,expected,signal??new AbortController().signal);},reads:()=>reads,observers:()=>observers};
 }
 const h=harness();stage='positive';
 const parent=new AbortController();parent.abort();assert.deepEqual(await h.read(v.scope,v.expected,parent.signal),{kind:'unavailable'});assert.equal(h.records.length,0);assert.deepEqual(h.codes,[]);
 assert.deepEqual(await h.read({...v.scope,extra:true},v.expected),{kind:'invalid_scope'});assert.deepEqual(await h.read(v.scope,{...v.expected,head:undefined}),{kind:'invalid_scope'});assert.equal(h.records.length,0);
 const matched=await h.read(v.scope,v.expected);assert.equal(matched.kind,'ok');assert.equal(matched.context.headComparison,'matched');assert.equal(matched.context.baselineJson,baselineText);assert.equal(matched.context.baselineSha256,sha(baseline));assert.deepEqual(matched.context.scope,v.scope);assert.ok(Object.isFrozen(matched)&&Object.isFrozen(matched.context)&&Object.isFrozen(matched.context.held));
 const actualEnvelope=h.native[0],actual=Buffer.from(actualEnvelope,'utf8'),post=await observation(),parsed=parseStoredIssuePreparationContext(actual,v.scope,v.expected,post);assert.equal(parsed.kind,'ok');assert.equal(parsed.context.baselineJson,baselineText);
 const unpaired=await h.read(v.scope,{...v.expected,head:null});assert.equal(unpaired.kind,'ok');assert.equal(unpaired.context.headComparison,'not_supplied');assert.equal(unpaired.context.baselineJson,matched.context.baselineJson);assert.equal(unpaired.context.issue.head.publication_id,v.scope.basePublicationId);
 stage='missing_scope';const missing=[];
 for(const key of ['runId','decisionId','issueId','basePublicationId']){const scope={...v.scope,[key]:'00000000-0000-4000-8000-000000000999'},out=await h.read(scope,v.expected);assert.equal(out.kind,'no_match');assert.deepEqual(Object.keys(out).sort(),['kind','observedAt','scope']);assert.deepEqual(out.scope,scope);missing.push(key);}
 stage='source_mismatch';const substitutions={sourceVersionId:'00000000-0000-4000-8000-000000000999',contentSha256:'f'.repeat(64),itemKey:'invented-foreign-item',locator:'section:unassigned',jurisdictionId:'invented-foreign-jurisdiction'},sourceHeld=[];
 for(const[key,value]of Object.entries(substitutions)){assert.notEqual(v.expected.source[key],value);assert.deepEqual(await h.read(v.scope,{...v.expected,source:{...v.expected.source,[key]:value}}),{kind:'unavailable'});sourceHeld.push(key);}
 stage='head_mismatch';const headHeld=[];
 for(const[key,value]of Object.entries({contentSha256:'f'.repeat(64),changedAt:'2000-01-01T00:00:00.000000Z'})){assert.notEqual(v.expected.head[key],value);assert.deepEqual(await h.read(v.scope,{...v.expected,head:{...v.expected.head,[key]:value}}),{kind:'unavailable'});headHeld.push(key);}
 await new Promise(r=>setImmediate(r));assert.deepEqual(h.codes,Array(7).fill('operator_audit_read'));assert.equal(h.reads(),13);assert.equal(h.observers(),13);assert.equal(await h.owner.shutdown(),true);
 // Valid successful sessions acknowledge BEGIN and ROLLBACK. Failed private
 // comparisons intentionally close their own session without exposing parts.
 for(const r of h.records){assert.equal(r.queries[0].command,'BEGIN');assert.equal(r.queries[0].rowCount,null);assert.deepEqual(r.queries[0].fields,[]);if(r.queries.at(-1).phase==='rollback'){assert.equal(r.queries.at(-1).command,'ROLLBACK');assert.equal(r.queries.at(-1).rowCount,null);assert.deepEqual(r.queries.at(-1).fields,[]);}}
 stage='guard_fault';const guardFaults=[];
 for(const fault of ['read_write','read_committed']){const f=harness(fault);assert.deepEqual(await f.read(v.scope,v.expected),{kind:'unavailable'});assert.equal(f.reads(),0);assert.equal(f.observers(),0);assert.deepEqual(f.records[0].queries.map(q=>q.phase),['begin','trusted_lab_'+fault,'guard']);assert.equal(await f.owner.shutdown(),true);await new Promise(r=>setImmediate(r));assert.deepEqual(f.codes,['operator_audit_read']);guardFaults.push(fault);}
 assert.ok(all.every(r=>r.closeAcknowledged&&r.closeCalls===1));const result={state:'PASS_INVENTED_PRECAPTURE_CONTEXT_PROTOCOL',preparedValues:[...prepared.values],context:matched.context,unpairedHeadComparison:unpaired.context.headComparison,rawEnvelopeBase64:actual.toString('base64'),rawEnvelopeSHA256:sha(actual),missingScopeFields:missing,heldSourceFields:sourceHeld,heldHeadFields:headHeld,trustedLabGuardFaults:guardFaults,preabortAcquisitions:0,invalidAcquisitions:0,actualContextStatements:13,allPhysicalCloseAcknowledged:true,actualNodePgProtocol:true,actualAuthentication:false,defaultFactoryQualified:false,nativeClients:all};const encoded=Buffer.from(JSON.stringify(result));assert.ok(encoded.length<=131072);writeSync(1,encoded);
}catch{writeSync(2,'issue_preparation_context_unavailable:'+stage+'\n');process.exitCode=1;}
finally{for(const owner of owners){try{await owner.shutdown();}catch{/* Each same-client close attempt remains owned. */}}}
