// Distinct invented pending-write lifetime witness. No default target or role.
import assert from 'node:assert/strict';
import {readSync,writeSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
import {createPostgresAppendedWorkTransport,POSTGRES_APPENDED_WORK_SQL as WRITE} from '../src/server/postgres-appended-work-transport.ts';
import {prepareAppendedIssueCaptureForWork} from '../src/server/appended-capture-work.ts';
const SETS=['SET default_transaction_read_only = off',"SET default_transaction_isolation = 'read committed'"],BEGIN='BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE',LOCK='LOCK TABLE tf_appended_review.captures IN ACCESS EXCLUSIVE MODE',CLEAR='SELECT pg_catalog.pg_stat_clear_snapshot()',SLOT='SELECT 1::integer AS settled',FAULT="SET default_transaction_isolation = 'repeatable read'";
const OBS=`SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('pid',a.pid,'databaseOID',a.datid::text,'database',a.datname,'waitType',a.wait_event_type,'blockers',pg_catalog.pg_blocking_pids(a.pid),'locks',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',n.nspname,'relation',c.relname,'mode',l.mode,'granted',l.granted)),'[]'::jsonb) FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_class c ON c.oid=l.relation JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE l.pid=a.pid AND l.database=a.datid AND n.nspname IN('terra_private','tf_appended_review')))),'[]'::jsonb)::text AS observation FROM pg_catalog.pg_stat_activity a WHERE a.pid=ANY(pg_catalog.string_to_array($1::text,',')::integer[]) AND a.datname=pg_catalog.current_database()`;
const sha=raw=>createHash('sha256').update(raw).digest('hex'),owners=[],records=[];
async function postwriteObservation(){const began=performance.now(),first=Date.now();let previous=began,wall=first;assert.ok(Number.isFinite(began)&&Number.isSafeInteger(first));for(;;){await new Promise(r=>setTimeout(r,0));const tick=performance.now(),now=Date.now();assert.ok(Number.isFinite(tick)&&tick>=previous&&tick-began<20&&Number.isSafeInteger(now)&&now>=wall);previous=tick;wall=now;if(now>first)return new Date(now).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');}}
async function until(observe,predicate){const start=performance.now();let previous=start;assert.ok(Number.isFinite(start));for(let i=0;i<24;i++){const result=await observe(),now=performance.now();assert.ok(Number.isFinite(now)&&now>=previous&&now-start<220,'bounded actual pending-state observation');previous=now;if(predicate(result))return result;await new Promise(r=>setTimeout(r,2));}throw Error('owned_pending_state_unobserved');}
const isLock=(r,schema,relation,mode,granted=true)=>r.locks.some(l=>l.schema===schema&&l.relation===relation&&l.mode===mode&&l.granted===granted);
const association=(r,holder)=>r.waitType==='Lock'&&r.blockers.length===1&&r.blockers[0]===holder&&isLock(r,'tf_appended_review','captures','AccessShareLock',false)&&isLock(r,'terra_private','update_runs','RowShareLock')&&isLock(r,'terra_private','update_run_work_state','RowShareLock');
try{
 const b=Buffer.alloc(294913);let n=0;while(n<b.length){const k=readSync(0,b,n,b.length-n,null);if(!k)break;n+=k;}assert.ok(n>=2&&n<=294912);const raw=b.subarray(0,n),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(raw);assert.ok(Buffer.from(text).equals(raw));const v=JSON.parse(text);
 assert.deepEqual(Object.keys(v).sort(),['bundle','expected','mode','retainedIntentJson','socketDirectory','work']);assert.ok(['blocked','capture','guard'].includes(v.mode));
 const socket=v.socketDirectory;assert.equal(typeof socket,'string');assert.match(socket,/^\/tmp\/tf-feed-postgres-trial-\d{8}T\d{6}Z-[a-f0-9]{8}\/protocol-socket$/);assert.ok(Buffer.byteLength(socket+'/.s.PGSQL.5432')<104);const proof=process.cwd().replace(/\/inputs$/,'');assert.equal(process.cwd(),proof+'/inputs');assert.equal(socket,proof+'/protocol-socket');assert.equal(realpathSync(proof),proof);assert.equal(realpathSync(socket),socket);
 for(const [p,mode]of[[proof,0o700],[socket,0o1777]]){const s=lstatSync(p);assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.equal(s.uid,process.getuid());assert.equal(s.mode&0o7777,mode);}assert.ok(lstatSync(socket+'/.s.PGSQL.5432').isSocket());assert.equal(process.env.NODE_ENV,'development');assert.ok(Object.keys(process.env).every(k=>['PATH','LANG','TZ','NODE_ENV'].includes(k)));
 const prepared=prepareAppendedIssueCaptureForWork(v.work,v.bundle,v.expected);assert.equal(prepared.capture.intentJson,v.retainedIntentJson);
 const diagnostics=[];let observers=0,writeInvocations=0;
 function makeOwner(role){
  const ownRecords=[];
  const config={host:'127.0.0.1',port:5432,database:'postgres',user:'postgres',password:'INVENTED_LOCAL_NONSECRET_PLACEHOLDER',transport:{kind:'loopback-development'}};
  const factory=async o=>{
   assert.deepEqual(Object.keys(o).sort(),['application_name','binary','client_encoding','connectionTimeoutMillis','database','enableChannelBinding','fallback_application_name','host','idle_in_transaction_session_timeout','lock_timeout','options','password','pipeline','port','query_timeout','replication','ssl','sslnegotiation','statement_timeout','user'].sort());assert.equal(o.host,'127.0.0.1');assert.equal(o.port,5432);assert.equal(o.database,'postgres');assert.equal(o.user,'postgres');assert.equal(o.ssl,false);assert.equal(o.binary,false);assert.equal(o.replication,false);assert.equal(o.pipeline,false);assert.equal(o.sslnegotiation,'postgres');assert.equal(o.enableChannelBinding,true);assert.equal(o.client_encoding,'UTF8');assert.equal(o.connectionTimeoutMillis,1000);assert.equal(o.statement_timeout,2000);assert.equal(o.query_timeout,2250);assert.equal(o.lock_timeout,500);assert.equal(o.idle_in_transaction_session_timeout,2000);assert.equal(o.application_name,'terrafracta.proposal-worker');assert.equal(o.fallback_application_name,'terrafracta.proposal-worker');assert.equal(o.options,'-c default_transaction_read_only=on -c search_path=pg_catalog,pg_temp -c client_connection_check_interval=100');assert.equal(typeof o.password,'string');
   const c=new Client({...o,host:socket,port:5432});assert.equal(c.connectionParameters.isDomainSocket,true);assert.equal(c.binary,false);assert.ok(c.replication===false||c.replication===undefined);
   const r={role,pid:null,closeCalls:0,closeAcknowledged:false,activeQuery:false,queries:[]};records.push(r);ownRecords.push(r);const connect=c.connect.bind(c),query=c.query.bind(c),end=c.end.bind(c);
   c.connect=async()=>{await connect();assert.ok(Number.isInteger(c.processID)&&c.processID>0);r.pid=c.processID;assert.equal(c.getTransactionStatus(),'I');};
   c.query=async q=>{
    assert.deepEqual(Object.keys(q).sort(),['rowMode','text','values']);assert.equal(q.rowMode,'array');let phase;
    if(SETS.includes(q.text)){phase='setting';assert.deepEqual(q.values,[]);}
    else if(role==='worker'&&q.text===WRITE){phase='write';assert.deepEqual(q.values,[...prepared.values]);writeInvocations++;}
    else if(role==='worker'&&q.text===SLOT){phase='capacity_probe';assert.deepEqual(q.values,[]);}
    else if(role==='control'&&[BEGIN,LOCK,CLEAR,'ROLLBACK',OBS].includes(q.text)){phase=q.text===OBS?'observation':q.text===LOCK?'holder':q.text===CLEAR?'clear_stats':q.text===BEGIN?'begin':'rollback';if(q.text===OBS){assert.equal(q.values.length,1);assert.match(q.values[0],/^\d+(?:,\d+)*$/);const ids=q.values[0].split(',').map(Number);assert.ok(ids.every(pid=>records.some(a=>a.pid===pid)));}else assert.deepEqual(q.values,[]);}
    else throw Error('foreign_retirement_query');
    const item={phase,valueCount:q.values.length,statusBefore:c.getTransactionStatus()};r.queries.push(item);r.activeQuery=true;
    try{
     const out=await query(q);item.command=out.command;item.rowCount=out.rowCount;item.fields=out.fields.map(f=>({name:f.name,dataTypeID:f.dataTypeID}));item.statusAfter=c.getTransactionStatus();
     if(role==='worker'&&phase==='setting'&&q.text===SETS[1]&&v.mode==='guard'){
      const fault=await query({text:FAULT,values:[],rowMode:'array'});assert.equal(fault.command,'SET');assert.equal(fault.rowCount,null);assert.deepEqual(fault.fields,[]);assert.deepEqual(fault.rows,[]);r.queries.push({phase:'trusted_lab_repeatable_read_fault',command:fault.command,statusAfter:c.getTransactionStatus()});
     }
     if(phase==='write'&&v.mode==='guard'){assert.deepEqual(out.rows,[[false,null]]);assert.deepEqual(item.fields,[{name:'admitted',dataTypeID:16},{name:'capture',dataTypeID:25}]);item.falseNullAcknowledged=true;}
     return out;
    }catch(error){item.failureCode=error?.code==='55P03'?'55P03':'native_failure';throw error;}
    finally{r.activeQuery=false;}
   };
   c.end=()=>{r.closeCalls++;assert.equal(r.closeCalls,1);return end().then(()=>{r.closeAcknowledged=true;});};return c;
  };
  const owner=createPostgresReadOwner(config,'terrafracta.proposal-worker',false,factory);owners.push(owner);return {owner,records:ownRecords};
 }
 const worker=makeOwner('worker'),transport=createPostgresAppendedWorkTransport(worker.owner,async()=>{observers++;return postwriteObservation();},async code=>{diagnostics.push(code);return 'saved';});
 const capture=signal=>transport.capture(v.work,v.bundle,v.expected,signal??new AbortController().signal);let result;
 if(v.mode==='capture'){
  const out=await capture();assert.equal(out.kind,'confirmed');assert.equal(writeInvocations,1);assert.equal(observers,1);assert.deepEqual(diagnostics,[]);
  result={kind:out.kind,receiptSha256:out.stored.receiptSha256,storedAt:out.stored.storedAt,fullParts:7,writeInvocations,observerCalls:observers};
 }else if(v.mode==='guard'){
  assert.deepEqual(await capture(),{kind:'not_dispatched'});assert.equal(writeInvocations,1);assert.equal(observers,0);assert.deepEqual(diagnostics,[]);assert.equal(worker.records[0].queries.find(q=>q.phase==='write').falseNullAcknowledged,true);
  result={kind:'not_dispatched',trustedLaboratoryFault:true,actualFalseNull:true,writeInvocations,observerCalls:observers};
 }else{
  const control=makeOwner('control'),observations=[];
  const outcome=await control.owner.run(new AbortController().signal,async(client,active)=>{
   const q=async(text,values=[])=>{active();const out=await client.query({text,values,rowMode:'array'});active();if(SETS.includes(text)||[BEGIN,LOCK,'ROLLBACK'].includes(text)){const command=SETS.includes(text)?'SET':text===BEGIN?'BEGIN':text===LOCK?'LOCK':'ROLLBACK';assert.equal(out.command,command);assert.equal(out.rowCount,null);assert.deepEqual(out.fields,[]);assert.deepEqual(out.rows,[]);}return out;};
   for(const text of SETS){const a=await q(text);assert.equal(a.command,'SET');}
   await q(BEGIN);let transaction=true;
   try{
    assert.equal((await q(LOCK)).command,'LOCK');const holder=control.records[0].pid;
    const observe=async ids=>{await q(CLEAR);const out=await q(OBS,[ids.join(',')]);assert.deepEqual(out.fields.map(f=>({name:f.name,dataTypeID:f.dataTypeID})),[{name:'observation',dataTypeID:25}]);const rows=JSON.parse(out.rows[0][0]);assert.ok(Array.isArray(rows));return rows;};
    const waitFor=(ids,predicate)=>until(async()=>{const pids=ids();if(pids.some(x=>!Number.isInteger(x)))return [];return observe(pids);},predicate);
    const timeout=capture();const waiting=await waitFor(()=>[worker.records[0]?.pid],rows=>rows.length===1&&association(rows[0],holder));observations.push({phase:'timeout_pending',rows:waiting,holder});assert.deepEqual(await timeout,{kind:'outcome_unknown'});assert.equal(worker.records[0].queries.find(q=>q.phase==='write').failureCode,'55P03');assert.equal(observers,0);assert.equal(writeInvocations,1);assert.deepEqual(diagnostics,['proposal_capture_write']);
    await waitFor(()=>[worker.records[0].pid],rows=>rows.length===0&&worker.records[0].closeAcknowledged&&!worker.records[0].activeQuery);
    const a=new AbortController(),b=new AbortController(),one=capture(a.signal),two=capture(b.signal);
    const chain=await waitFor(()=>[worker.records[1]?.pid,worker.records[2]?.pid],rows=>{
     const first=rows.find(r=>r.pid===worker.records[1]?.pid),second=rows.find(r=>r.pid===worker.records[2]?.pid);return first&&second&&first.databaseOID===second.databaseOID&&first.database==='postgres'&&association(first,holder)&&second.waitType==='Lock'&&second.blockers.length===1&&second.blockers[0]===first.pid&&isLock(second,'terra_private','update_runs','RowShareLock');
    });observations.push({phase:'two_actual_writes_pending',rows:chain,holder});const before=worker.records.length;assert.deepEqual(await capture(),{kind:'not_dispatched'});assert.equal(worker.records.length,before);assert.equal(before,3);assert.deepEqual(diagnostics,['proposal_capture_write','proposal_capture_write']);
    a.abort();assert.deepEqual(await one,{kind:'outcome_unknown'});
    const afterAbort=await waitFor(()=>[worker.records[1].pid,worker.records[2].pid],rows=>rows.length===1&&rows[0].pid===worker.records[2].pid&&association(rows[0],holder)&&worker.records[1].closeAcknowledged&&!worker.records[1].activeQuery);observations.push({phase:'aborted_first_backend_gone_second_now_waits_on_holder',rows:afterAbort,holder});
    assert.deepEqual(await two,{kind:'outcome_unknown'});assert.equal(worker.records[2].queries.find(q=>q.phase==='write').failureCode,'55P03');assert.equal(writeInvocations,3);assert.equal(observers,0);assert.deepEqual(diagnostics,['proposal_capture_write','proposal_capture_write','proposal_capture_write']);
    await waitFor(()=>worker.records.map(r=>r.pid),rows=>rows.length===0&&worker.records.every(r=>r.closeAcknowledged&&!r.activeQuery));
    const reused=await worker.owner.run(new AbortController().signal,async(c,active)=>{active();const out=await c.query({text:SLOT,values:[],rowMode:'array'});active();assert.deepEqual(out.rows,[[1]]);assert.equal(out.fields[0].dataTypeID,23);return true;});assert.equal(reused,true);assert.equal(worker.records.length,4);assert.ok(worker.records.every(r=>r.closeAcknowledged));
    const rollback=await q('ROLLBACK');assert.equal(rollback.command,'ROLLBACK');assert.equal(client.getTransactionStatus(),'I');transaction=false;
    return {timeoutKind:'outcome_unknown',abortedKind:'outcome_unknown',peerTimeoutKind:'outcome_unknown',actualTimeouts:2,abortedPendingParents:1,overflowKind:'not_dispatched',overflowAcquisitions:0,writeInvocations,observerCalls:observers,sameOwnerCapacityReuse:true,sameOwnerWriteReuse:false,observations};
   }finally{if(transaction){const ack=await q('ROLLBACK');assert.equal(ack.command,'ROLLBACK');}}
  });assert.equal(await control.owner.shutdown(),true);result=outcome;
 }
 assert.equal(await worker.owner.shutdown(),true);assert.ok(records.every(r=>r.closeAcknowledged&&r.closeCalls===1&&!r.activeQuery));result.mode=v.mode;result.allPhysicalCloseAcknowledged=true;result.actualNodePgProtocol=true;result.diagnosticCodes=diagnostics;result.nativeClients=records;result.actualAuthentication=false;result.defaultFactoryQualified=false;
 const encoded=Buffer.from(JSON.stringify(result));assert.ok(encoded.length<=131072);writeSync(1,encoded);
}catch{writeSync(2,'appended_writer_retirement_unavailable\n');process.exitCode=1;}
finally{for(const owner of owners){try{await owner.shutdown();}catch{/* Keep each same-client close attempt. */}}}
