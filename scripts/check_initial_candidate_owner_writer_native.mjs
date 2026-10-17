// Actual pg protocol for the fixed invented initial adapter; no default binding.
import assert from 'node:assert/strict';
import {readSync,writeSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
import {createPostgresInitialCandidateWorkTransport,POSTGRES_INITIAL_CANDIDATE_WORK_SQL as WRITE} from '../src/server/postgres-initial-candidate-work-transport.ts';
import {prepareInitialCandidateCaptureForWork,prepareInitialCandidateCaptureRead,parseStoredInitialCandidateCapture,INITIAL_CANDIDATE_CAPTURE_READ_SQL as READ} from '../src/server/initial-candidate-capture.ts';
import {POSTGRES_APPENDED_OWNER_GUARD_SQL as GUARD} from '../src/server/postgres-appended-capture-provider.ts';
const SETS=['SET default_transaction_read_only = off',"SET default_transaction_isolation = 'read committed'"],BEGIN='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',FAULT="SET default_transaction_isolation = 'repeatable read'";
const sha=b=>createHash('sha256').update(b).digest('hex');
async function observeAfterQuery(wall=()=>Date.now(),monotonic=()=>performance.now(),pause=()=>new Promise(resolve=>setTimeout(resolve,0))){
 const began=monotonic(),first=wall();assert.ok(Number.isFinite(began)&&Number.isSafeInteger(first)&&first>=0);let previous=began,previousWall=first;
 for(;;){await pause();const tick=monotonic(),observed=wall();assert.ok(Number.isFinite(tick)&&tick>=previous&&tick-began<20&&Number.isSafeInteger(observed)&&observed>=previousWall);previous=tick;previousWall=observed;if(observed>first)return new Date(observed).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');}
}
function control(r,command){assert.equal(r.command,command);assert.equal(r.rowCount,null);assert.deepEqual(r.fields,[]);assert.deepEqual(r.rows,[]);}
let owner,stage='startup';
try{
 const input=Buffer.alloc(294913);let size=0;while(size<input.length){const n=readSync(0,input,size,input.length-size,null);if(!n)break;size+=n;}assert.ok(size>=2&&size<=294912);const raw=input.subarray(0,size),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(raw);assert.ok(Buffer.from(text).equals(raw));const v=JSON.parse(text);
 assert.deepEqual(Object.keys(v).sort(),['mode','work','report','expected','retainedIntentJson','socketDirectory'].sort());assert.ok(['chain','guard'].includes(v.mode));
 const socket=v.socketDirectory,proof=process.cwd().replace(/\/inputs$/,'');assert.equal(process.cwd(),proof+'/inputs');assert.equal(socket,proof+'/protocol-socket');assert.match(socket,/^\/tmp\/tf-feed-postgres-trial-\d{8}T\d{6}Z-[a-f0-9]{8}\/protocol-socket$/);assert.equal(realpathSync(proof),proof);assert.equal(realpathSync(socket),socket);assert.ok(Buffer.byteLength(socket+'/.s.PGSQL.5432')<104);
 for(const[path,mode]of[[proof,0o700],[socket,0o1777]]){const s=lstatSync(path);assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.equal(s.uid,process.getuid());assert.equal(s.mode&0o7777,mode);}assert.ok(lstatSync(socket+'/.s.PGSQL.5432').isSocket());
 assert.equal(process.env.NODE_ENV,'development');for(const name of Object.keys(process.env))assert.ok(['PATH','LANG','TZ','NODE_ENV'].includes(name));
 const prepared=prepareInitialCandidateCaptureForWork(v.work,v.report,v.expected);assert.equal(prepared.intentJson,v.retainedIntentJson);const read=prepareInitialCandidateCaptureRead(v.retainedIntentJson),clients=[],diagnosticCodes=[],actualReceipts=[];let writes=0,observerCalls=0,lost=false;
 const factory=async options=>{
  assert.deepEqual(Object.keys(options).sort(),['application_name','binary','client_encoding','connectionTimeoutMillis','database','enableChannelBinding','fallback_application_name','host','idle_in_transaction_session_timeout','lock_timeout','options','password','pipeline','port','query_timeout','replication','ssl','sslnegotiation','statement_timeout','user'].sort());
  assert.equal(options.host,'127.0.0.1');assert.equal(options.port,5432);assert.equal(options.database,'postgres');assert.equal(options.user,'postgres');assert.equal(options.ssl,false);assert.equal(options.binary,false);assert.equal(options.replication,false);assert.equal(options.pipeline,false);assert.equal(options.sslnegotiation,'postgres');assert.equal(options.enableChannelBinding,true);assert.equal(options.client_encoding,'UTF8');assert.equal(options.connectionTimeoutMillis,1000);assert.equal(options.statement_timeout,2000);assert.equal(options.query_timeout,2250);assert.equal(options.lock_timeout,500);assert.equal(options.idle_in_transaction_session_timeout,2000);assert.equal(options.application_name,'terrafracta.proposal-worker');assert.equal(options.fallback_application_name,'terrafracta.proposal-worker');assert.equal(options.options,'-c default_transaction_read_only=on -c search_path=pg_catalog,pg_temp -c client_connection_check_interval=100');assert.equal(typeof options.password,'string');
  const c=new Client({...options,host:socket,port:5432});assert.equal(c.host,socket);assert.equal(c.connectionParameters.isDomainSocket,true);assert.equal(c.binary,false);assert.ok(c.replication===false||c.replication===undefined);assert.equal(typeof c.getTransactionStatus,'function');
  const record={pid:null,queries:[],closeCalls:0,closeAcknowledged:false,idleOnConnect:false},connect=c.connect.bind(c),query=c.query.bind(c),end=c.end.bind(c);clients.push(record);
  c.connect=async()=>{await connect();record.pid=c.processID;assert.ok(Number.isInteger(record.pid)&&record.pid>0);record.idleOnConnect=c.getTransactionStatus()==='I';assert.equal(record.idleOnConnect,true);};
  c.query=async q=>{
   assert.deepEqual(Object.keys(q).sort(),['rowMode','text','values']);assert.equal(q.rowMode,'array');let phase;
   if(SETS.includes(q.text)){phase=q.text===SETS[0]?'set_rw':'set_rc';assert.deepEqual(q.values,[]);}
   else if(q.text===WRITE){phase='write';writes++;assert.equal(q.values.length,5);assert.deepEqual(q.values.filter((_,i)=>i!==2),prepared.values.filter((_,i)=>i!==2));assert.ok(q.values[2]===prepared.values[2]||q.values[2]==='00000000-0000-4000-8000-000000000999');assert.equal(c.getTransactionStatus(),'I');}
   else if(q.text===BEGIN||q.text==='ROLLBACK'){phase=q.text===BEGIN?'read_begin':'read_rollback';assert.deepEqual(q.values,[]);}
   else if(q.text===GUARD){phase='read_guard';assert.deepEqual(q.values,[]);}
   else if(q.text===READ){phase='read_capture';assert.deepEqual(q.values,[...read.values]);}
   else throw Error('foreign_initial_protocol_statement');
   const item={phase,valueCount:q.values.length,statusBefore:c.getTransactionStatus()};record.queries.push(item);
   try{
    const r=await query(q);Object.assign(item,{command:r.command,rowCount:r.rowCount,fields:r.fields.map(f=>({name:f.name,dataTypeID:f.dataTypeID})),rows:r.rows.length,statusAfter:c.getTransactionStatus()});
    if(phase==='set_rc'&&v.mode==='guard'){
     control(r,'SET');const fault=await query({text:FAULT,values:[],rowMode:'array'});control(fault,'SET');assert.equal(c.getTransactionStatus(),'I');record.queries.push({phase:'lab_guard_session_fault',command:fault.command,rowCount:fault.rowCount,fields:[],rows:0,statusBefore:'I',statusAfter:c.getTransactionStatus()});
    }
    if(phase==='write'){
     assert.equal(item.statusAfter,'I');assert.equal(r.command,'SELECT');assert.equal(r.rowCount,1);assert.deepEqual(item.fields,[{name:'admitted',dataTypeID:16},{name:'capture',dataTypeID:25}]);assert.equal(r.rows.length,1);assert.equal(r.rows[0].length,2);item.admitted=r.rows[0][0];
     if(v.mode==='guard'){assert.deepEqual(r.rows,[[false,null]]);item.nullCapture=true;}
     else{
      assert.equal(r.rows[0][0],true);assert.equal(typeof r.rows[0][1],'string');const bytes=Buffer.from(r.rows[0][1],'utf8');assert.ok(bytes.length>=2&&bytes.length<=131072);actualReceipts.push(bytes);
      // Controlled application-response loss AFTER actual native autocommit and
      // idle acknowledgement on the explicit identical second invocation.
      if(writes===2){lost=true;item.controlledApplicationReplyDiscarded=true;throw Error('invented_application_response_loss');}
     }
    }
    return r;
   }catch(error){item.failureCode=['23514','23505','40001'].includes(error?.code)?error.code:lost&&writes===2?'invented_application_response_loss':'native_failure';throw error;}
  };
  c.end=()=>{record.closeCalls++;assert.equal(record.closeCalls,1);return end().then(()=>{record.closeAcknowledged=true;});};return c;
 };
 owner=createPostgresReadOwner({host:'127.0.0.1',port:5432,database:'postgres',user:'postgres',password:'INVENTED_LOCAL_NONSECRET_PLACEHOLDER',transport:{kind:'loopback-development'}},'terrafracta.proposal-worker',false,factory);
 const transport=createPostgresInitialCandidateWorkTransport(owner,async()=>{observerCalls++;return observeAfterQuery();},code=>diagnosticCodes.push(code)),signal=()=>new AbortController().signal;let result;
 if(v.mode==='guard'){
  stage='guard';const outcome=await transport.capture(v.work,v.report,v.expected,signal());assert.deepEqual(outcome,{kind:'not_dispatched'});assert.equal(writes,1);assert.equal(observerCalls,0);assert.deepEqual(diagnosticCodes,[]);assert.equal(actualReceipts.length,0);assert.equal(clients.length,1);
  result={kind:outcome.kind,writerSQLInvocations:writes,writerFunctionInvoked:false,nativeGuardFalseNull:true,trustedLabSessionFault:true,observerCalls};
 }else{
  stage='preabort';const pre=new AbortController();pre.abort();assert.deepEqual(await transport.capture(v.work,v.report,v.expected,pre.signal),{kind:'not_dispatched'});assert.deepEqual(await transport.capture({},v.report,v.expected,signal()),{kind:'not_dispatched'});assert.equal(clients.length,0);
  stage='capture';const first=await transport.capture(v.work,v.report,v.expected,signal());assert.equal(first.kind,'confirmed');assert.equal(first.stored.intentJson,v.retainedIntentJson);assert.deepEqual(first.work,v.work);assert.equal(writes,1);assert.equal(observerCalls,1);const receipt=actualReceipts[0];assert.equal(first.stored.receiptSha256,sha(receipt));
  stage='controlled_loss';const unknown=await transport.capture(v.work,v.report,v.expected,signal());assert.deepEqual(unknown,{kind:'outcome_unknown'});assert.equal(lost,true);assert.equal(writes,2);assert.equal(observerCalls,1);assert.ok(actualReceipts[1].equals(receipt));assert.deepEqual(diagnosticCodes,['proposal_capture_write']);
  stage='independent_read';const independentlyRead=await owner.run(signal(),async(c,active)=>{
   active();control(await c.query({text:BEGIN,values:[],rowMode:'array'}),'BEGIN');active();const guard=await c.query({text:GUARD,values:[],rowMode:'array'});active();assert.equal(guard.command,'SELECT');assert.equal(guard.rowCount,1);assert.deepEqual(guard.fields.map(f=>({name:f.name,dataTypeID:f.dataTypeID})),[{name:'admitted',dataTypeID:16}]);assert.deepEqual(guard.rows,[[true]]);
   const r=await c.query({text:READ,values:[...read.values],rowMode:'array'});active();assert.equal(r.command,'SELECT');assert.equal(r.rowCount,1);assert.deepEqual(r.fields.map(f=>({name:f.name,dataTypeID:f.dataTypeID})),[{name:'capture',dataTypeID:25}]);assert.equal(r.rows.length,1);assert.equal(r.rows[0].length,1);assert.equal(typeof r.rows[0][0],'string');const bytes=Buffer.from(r.rows[0][0],'utf8');assert.ok(bytes.length>=2&&bytes.length<=131072);
   control(await c.query({text:'ROLLBACK',values:[],rowMode:'array'}),'ROLLBACK');active();assert.equal(c.getTransactionStatus(),'I');return bytes;
  });
  const resolvedObservedAt=await observeAfterQuery(),resolved=parseStoredInitialCandidateCapture(independentlyRead,v.retainedIntentJson,v.expected,resolvedObservedAt);assert.ok(independentlyRead.equals(receipt));assert.equal(resolved.receiptSha256,sha(receipt));assert.equal(writes,2);
  stage='explicit_recover';const recovered=await transport.recover(v.work,independentlyRead,v.retainedIntentJson,v.expected,resolvedObservedAt,signal());assert.equal(recovered.kind,'confirmed');assert.equal(recovered.stored.receiptSha256,sha(receipt));assert.deepEqual(recovered.work,v.work);assert.ok(actualReceipts[2].equals(receipt));assert.equal(writes,3);assert.equal(observerCalls,2);
  stage='bad_work';const bad=await transport.capture({...v.work,workClaimId:'00000000-0000-4000-8000-000000000999'},v.report,v.expected,signal());assert.deepEqual(bad,{kind:'outcome_unknown'});assert.equal(writes,4);assert.equal(observerCalls,2);assert.equal(clients.at(-1).queries.find(q=>q.phase==='write').failureCode,'23514');assert.deepEqual(diagnosticCodes,['proposal_capture_write']);
  result={kind:first.kind,actualReceiptBase64:receipt.toString('base64'),receiptSha256:sha(receipt),firstObservedAt:first.stored.observedAt,controlledApplicationResponseLoss:{kind:unknown.kind,storedExposed:Object.hasOwn(unknown,'stored'),automaticRetry:false,nativeAutocommitAcknowledgedBeforeDiscard:true,networkFault:false},independentReceiptBase64:independentlyRead.toString('base64'),resolvedObservedAt,recoveredKind:recovered.kind,recoveredObservedAt:recovered.stored.observedAt,recoveredSameClaimId:recovered.work.workClaimId,recoveredReceiptSha256:recovered.stored.receiptSha256,badWorkKind:bad.kind,badWorkCode:'23514',writerSQLInvocations:writes,observerCalls,preabortClients:0,invalidInputClients:0};
 }
 stage='shutdown';assert.equal(await owner.shutdown(),true);assert.ok(clients.every(c=>c.closeCalls===1&&c.closeAcknowledged&&c.idleOnConnect));
 for(const c of clients){
  if(c.queries.some(q=>q.phase==='write')){assert.deepEqual(c.queries.map(q=>q.phase),v.mode==='guard'?['set_rw','set_rc','lab_guard_session_fault','write']:['set_rw','set_rc','write']);for(const q of c.queries.slice(0,2)){assert.equal(q.command,'SET');assert.equal(q.rowCount,null);assert.deepEqual(q.fields,[]);assert.equal(q.rows,0);assert.equal(q.statusBefore,'I');assert.equal(q.statusAfter,'I');}}
  else assert.deepEqual(c.queries.map(q=>q.phase),['read_begin','read_guard','read_capture','read_rollback']);
 }
 Object.assign(result,{nativeClients:clients,diagnosticCodes,allPhysicalCloseAcknowledged:true,actualNodePgProtocol:true,defaultFactoryQualified:false,actualAuthentication:false,tlsQualified:false});const output=Buffer.from(JSON.stringify(result));assert.ok(output.length<=131072);writeSync(1,output);
}catch{writeSync(2,'initial_owner_writer_unavailable:'+stage+'\n');process.exitCode=1;}
finally{if(owner)try{await owner.shutdown();}catch{/* Retain uncertain ownership; never synthesize acknowledgement. */}}
