// Invented fixed autocommit whole-association protocol witness only.
import assert from 'node:assert/strict';
import {readSync,writeSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
import {createPostgresAppendedWorkTransport,POSTGRES_APPENDED_WORK_SQL as WRITE} from '../src/server/postgres-appended-work-transport.ts';
import {prepareAppendedIssueCaptureForWork} from '../src/server/appended-capture-work.ts';
import {createPostgresAppendedCaptureTransport,POSTGRES_APPENDED_OWNER_GUARD_SQL as GUARD} from '../src/server/postgres-appended-capture-provider.ts';
import {APPENDED_CAPTURE_LOOKUP_SQL as LOOKUP,prepareAppendedCaptureLookup,parseAppendedCaptureLookup} from '../src/server/appended-capture-lookup.ts';
import {APPENDED_CAPTURE_READ_SQL as READ,prepareAppendedIssueCaptureRead} from '../src/server/appended-issue-capture.ts';
import {createSelectedAppendedCaptureReader} from '../src/server/appended-capture-selection.ts';
const SETS=['SET default_transaction_read_only = off',"SET default_transaction_isolation = 'read committed'"],BEGIN='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const instant=()=>new Date().toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
// Same authored laboratory clock observation as the separately reviewed read
// protocol V2; no old module is imported for its top-level executable bridge.
async function observeAfterQuery(wall=()=>Date.now(),monotonic=()=>performance.now(),pause=()=>new Promise(resolve=>setTimeout(resolve,0))){
 const began=monotonic(),first=wall();if(!Number.isFinite(began)||!Number.isSafeInteger(first)||first<0)throw Error('writer_clock_unavailable');let previous=began,previousWall=first;
 for(;;){await pause();const tick=monotonic(),observed=wall();if(!Number.isFinite(tick)||tick<previous||tick-began>=20||!Number.isSafeInteger(observed)||observed<previousWall)throw Error('writer_clock_unavailable');previous=tick;previousWall=observed;if(observed>first)return new Date(observed).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');}
}
let owner;
try{
 const input=Buffer.alloc(294913);let size=0;while(size<input.length){const n=readSync(0,input,size,input.length-size,null);if(!n)break;size+=n;}assert.ok(size>=2&&size<=294912);
 const raw=input.subarray(0,size),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(raw);assert.ok(Buffer.from(text).equals(raw));const v=JSON.parse(text);
 assert.deepEqual(Object.keys(v).sort(),['mode','work','bundle','expected','retainedIntentJson','preparationContext','priorReceiptBase64','priorObservedAt','socketDirectory'].sort());assert.ok(['capture','lost_ack','expired','reclaimed'].includes(v.mode));
 const socket=v.socketDirectory,proof=process.cwd().replace(/\/inputs$/,'');assert.equal(process.cwd(),proof+'/inputs');assert.equal(socket,proof+'/protocol-socket');assert.match(socket,/^\/tmp\/tf-feed-postgres-trial-\d{8}T\d{6}Z-[a-f0-9]{8}\/protocol-socket$/);assert.equal(realpathSync(proof),proof);assert.equal(realpathSync(socket),socket);assert.ok(Buffer.byteLength(socket+'/.s.PGSQL.5432')<104);
 for(const[p,mode]of[[proof,0o700],[socket,0o1777]]){const s=lstatSync(p);assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.equal(s.uid,process.getuid());assert.equal(s.mode&0o7777,mode);}assert.ok(lstatSync(socket+'/.s.PGSQL.5432').isSocket());
 assert.equal(process.env.NODE_ENV,'development');for(const name of Object.keys(process.env))assert.ok(['PATH','LANG','TZ','NODE_ENV'].includes(name));
 if(v.mode==='expired'||v.mode==='reclaimed'){assert.equal(typeof v.priorReceiptBase64,'string');assert.equal(typeof v.priorObservedAt,'string');}else{assert.equal(v.priorReceiptBase64,null);assert.equal(v.priorObservedAt,null);}
 const prepared=prepareAppendedIssueCaptureForWork(v.work,v.bundle,v.expected);assert.equal(prepared.capture.intentJson,v.retainedIntentJson);const readCommand=prepareAppendedIssueCaptureRead(v.retainedIntentJson),context=v.preparationContext,lookup=prepareAppendedCaptureLookup(context.report,context.expected,instant());
 const clients=[],diagnosticCodes=[];let writeInvocations=0,observerCalls=0,lost=false;const actualReceipts=[],readReceipts=[];
 const factory=async options=>{
  assert.deepEqual(Object.keys(options).sort(),['application_name','binary','client_encoding','connectionTimeoutMillis','database','enableChannelBinding','fallback_application_name','host','idle_in_transaction_session_timeout','lock_timeout','options','password','pipeline','port','query_timeout','replication','ssl','sslnegotiation','statement_timeout','user'].sort());
  assert.equal(options.host,'127.0.0.1');assert.equal(options.port,5432);assert.equal(options.database,'postgres');assert.equal(options.user,'postgres');assert.equal(options.ssl,false);assert.equal(options.binary,false);assert.equal(options.replication,false);assert.equal(options.pipeline,false);assert.equal(options.sslnegotiation,'postgres');assert.equal(options.enableChannelBinding,true);assert.equal(options.client_encoding,'UTF8');assert.equal(options.connectionTimeoutMillis,1000);assert.equal(options.statement_timeout,2000);assert.equal(options.query_timeout,2250);assert.equal(options.lock_timeout,500);assert.equal(options.idle_in_transaction_session_timeout,2000);assert.equal(options.application_name,'terrafracta.proposal-worker');assert.equal(options.fallback_application_name,'terrafracta.proposal-worker');assert.equal(options.options,'-c default_transaction_read_only=on -c search_path=pg_catalog,pg_temp -c client_connection_check_interval=100');assert.equal(typeof options.password,'string');
  const c=new Client({...options,host:socket,port:5432});assert.equal(c.host,socket);assert.equal(c.binary,false);assert.ok(c.replication===false||c.replication===undefined);assert.equal(c.connectionParameters.isDomainSocket,true);assert.equal(typeof c.getTransactionStatus,'function');
  const record={pid:null,queries:[],closeCalls:0,closeAcknowledged:false,idleOnConnect:false},connect=c.connect.bind(c),query=c.query.bind(c),end=c.end.bind(c);clients.push(record);
  c.connect=async()=>{await connect();record.pid=c.processID;assert.ok(Number.isInteger(record.pid)&&record.pid>0);record.idleOnConnect=c.getTransactionStatus()==='I';assert.equal(record.idleOnConnect,true);};
  c.query=async q=>{
   assert.deepEqual(Object.keys(q).sort(),['rowMode','text','values']);assert.equal(q.rowMode,'array');let phase;
   if(SETS.includes(q.text)){phase=q.text===SETS[0]?'set_rw':'set_rc';assert.deepEqual(q.values,[]);}
   else if(q.text===WRITE){phase='write';writeInvocations++;assert.equal(q.values.length,10);assert.deepEqual(q.values.filter((_,i)=>i!==2),prepared.values.filter((_,i)=>i!==2));assert.ok(q.values[2]===prepared.values[2]||q.values[2]==='00000000-0000-4000-8000-000000000999');assert.equal(c.getTransactionStatus(),'I');}
   else if(q.text===BEGIN||q.text==='ROLLBACK'){phase=q.text===BEGIN?'read_begin':'read_rollback';assert.deepEqual(q.values,[]);}
   else if(q.text===GUARD){phase='read_guard';assert.deepEqual(q.values,[]);}
   else if(q.text===LOOKUP){phase='lookup';assert.deepEqual(q.values,[...lookup.values]);}
   else if(q.text===READ){phase='read_capture';assert.deepEqual(q.values,[...readCommand.values]);}
   else throw Error('foreign_writer_protocol_statement');
   const item={phase,valueCount:q.values.length,statusBefore:c.getTransactionStatus()};record.queries.push(item);
   try{
    const r=await query(q);item.command=r.command;item.rowCount=r.rowCount;item.fields=r.fields.map(f=>({name:f.name,dataTypeID:f.dataTypeID}));item.rows=r.rows.length;item.statusAfter=c.getTransactionStatus();
    if(phase==='write'){
     assert.equal(item.statusAfter,'I');assert.deepEqual(item.fields,[{name:'admitted',dataTypeID:16},{name:'capture',dataTypeID:25}]);assert.equal(r.command,'SELECT');assert.equal(r.rowCount,1);assert.equal(r.rows[0][0],true);assert.equal(typeof r.rows[0][1],'string');const bytes=Buffer.from(r.rows[0][1],'utf8');assert.ok(bytes.length>=2&&bytes.length<=131072);actualReceipts.push(bytes);
     // This controlled laboratory observer discards an ACTUAL successful
     // autocommit response before the application transport can inspect it.
     if(v.mode==='lost_ack'&&!lost){lost=true;item.replyDiscardedAfterActualIdle=true;throw Error('invented_lost_ack');}
    }
    if(phase==='read_capture'){assert.equal(typeof r.rows[0][0],'string');readReceipts.push(Buffer.from(r.rows[0][0],'utf8'));}
    return r;
   }catch(error){item.failureCode=['23514','23505','40001'].includes(error?.code)?error.code:lost?'invented_lost_ack':'native_failure';throw error;}
  };
  c.end=()=>{record.closeCalls++;assert.equal(record.closeCalls,1);return end().then(()=>{record.closeAcknowledged=true;});};return c;
 };
 owner=createPostgresReadOwner({host:'127.0.0.1',port:5432,database:'postgres',user:'postgres',password:'INVENTED_LOCAL_NONSECRET_PLACEHOLDER',transport:{kind:'loopback-development'}},'terrafracta.proposal-worker',false,factory);
 const transport=createPostgresAppendedWorkTransport(owner,async()=>{observerCalls++;return observeAfterQuery();},code=>diagnosticCodes.push(code)),signal=()=>new AbortController().signal;let result;
 if(v.mode==='capture'){
  const pre=new AbortController();pre.abort();assert.deepEqual(await transport.capture(v.work,v.bundle,v.expected,pre.signal),{kind:'not_dispatched'});assert.equal(clients.length,0);
  assert.deepEqual(await transport.capture({},v.bundle,v.expected,signal()),{kind:'not_dispatched'});assert.equal(clients.length,0);
  const first=await transport.capture(v.work,v.bundle,v.expected,signal());assert.equal(first.kind,'confirmed');assert.equal(first.stored.intentJson,v.retainedIntentJson);assert.deepEqual(first.work,v.work);const receipt=actualReceipts[0];assert.equal(first.stored.receiptSha256,sha(receipt));
  const recovered=await transport.recover(v.work,receipt,v.retainedIntentJson,await observeAfterQuery(),signal());assert.equal(recovered.kind,'confirmed');assert.equal(recovered.stored.receiptSha256,sha(receipt));assert.ok(actualReceipts[1].equals(receipt));
  const bad=await transport.capture({...v.work,workClaimId:'00000000-0000-4000-8000-000000000999'},v.bundle,v.expected,signal());assert.deepEqual(bad,{kind:'outcome_unknown'});assert.deepEqual(diagnosticCodes,[]);assert.equal(writeInvocations,3);assert.equal(observerCalls,2);assert.equal(clients.length,3);const badCode=clients[2].queries.find(q=>q.phase==='write').failureCode;assert.equal(badCode,'23514');
  result={kind:first.kind,receiptSha256:first.stored.receiptSha256,actualReceiptBase64:receipt.toString('base64'),recovered:recovered.kind,recoveredReceiptSha256:recovered.stored.receiptSha256,writerInvocations:writeInvocations,preabortClients:0,invalidScopeClients:0,badWorkKind:bad.kind,badWorkCode:badCode};
 }else if(v.mode==='lost_ack'){
  const outcome=await transport.capture(v.work,v.bundle,v.expected,signal());assert.deepEqual(outcome,{kind:'outcome_unknown'});assert.equal(lost,true);assert.equal(writeInvocations,1);assert.equal(observerCalls,0);assert.deepEqual(diagnosticCodes,['proposal_capture_write']);const receipt=actualReceipts[0];
  const reads=createPostgresAppendedCaptureTransport(owner),metadataBytes=await reads.readLookup(context.report,context.expected,instant(),signal()),observed=await observeAfterQuery(),metadata=parseAppendedCaptureLookup(metadataBytes,context.report,context.expected,observed);assert.equal(metadata.matches[0].captureId,readCommand.values[0]);
  const reader=createSelectedAppendedCaptureReader(reads.readCapture,undefined,code=>diagnosticCodes.push(code));const selected=await reader({preparationReportJson:context.report,preparationReportSha256:context.expected.reportSha256,preparationIntentJson:context.expected.preparationIntentJson,lookupRaw:metadataBytes,captureId:readCommand.values[0],captureIntentJson:v.retainedIntentJson,observedAt:observed},signal());assert.equal(selected.kind,'ok');assert.equal(selected.stored.receiptSha256,sha(receipt));assert.equal(writeInvocations,1);
  result={kind:outcome.kind,actualReceiptBase64:receipt.toString('base64'),storedExposed:Object.hasOwn(outcome,'stored'),writeInvocations,resolvedKind:selected.kind,resolvedReceiptSha256:selected.stored.receiptSha256,resolvedCaptureId:selected.stored.capture.captureId,independentlyReadReceiptBase64:readReceipts[0].toString('base64'),resolvedObservedAt:selected.stored.observedAt};
 }else if(v.mode==='reclaimed'){
  const prior=Buffer.from(v.priorReceiptBase64,'base64');assert.equal(prior.toString('base64'),v.priorReceiptBase64);const recovered=await transport.recover(v.work,prior,v.retainedIntentJson,v.priorObservedAt,signal());assert.equal(recovered.kind,'confirmed');assert.equal(recovered.stored.receiptSha256,sha(prior));assert.equal(recovered.work.workClaimId,v.work.workClaimId);assert.ok(actualReceipts[0].equals(prior));assert.equal(writeInvocations,1);assert.equal(observerCalls,1);assert.deepEqual(diagnosticCodes,[]);
  result={kind:recovered.kind,receiptSha256:recovered.stored.receiptSha256,workClaimId:recovered.work.workClaimId};
 }else{
  const prior=Buffer.from(v.priorReceiptBase64,'base64');assert.equal(prior.toString('base64'),v.priorReceiptBase64);const resultExpired=await transport.recover(v.work,prior,v.retainedIntentJson,v.priorObservedAt,signal());assert.deepEqual(resultExpired,{kind:'outcome_unknown'});assert.equal(writeInvocations,1);assert.equal(observerCalls,0);assert.deepEqual(diagnosticCodes,[]);const code=clients[0].queries.find(q=>q.phase==='write').failureCode;assert.equal(code,'23514');
  result={kind:resultExpired.kind,failureCode:code,observerCalls};
 }
 assert.equal(await owner.shutdown(),true);assert.ok(clients.every(c=>c.closeCalls===1&&c.closeAcknowledged&&c.idleOnConnect));for(const c of clients.filter(c=>c.queries.some(q=>q.phase==='write'))){assert.deepEqual(c.queries.map(q=>q.phase),['set_rw','set_rc','write']);for(const q of c.queries.slice(0,2)){assert.equal(q.command,'SET');assert.equal(q.rowCount,null);assert.deepEqual(q.fields,[]);assert.equal(q.rows,0);assert.equal(q.statusBefore,'I');assert.equal(q.statusAfter,'I');}}
 Object.assign(result,{nativeClients:clients,diagnosticCodes,actualNodePgProtocol:true,writerOnlyAutocommit:true,allPhysicalCloseAcknowledged:true,defaultFactoryQualified:false,actualAuthentication:false,tlsQualified:false});const out=Buffer.from(JSON.stringify(result),'utf8');assert.ok(out.length<=131072);writeSync(1,out);
}catch{writeSync(2,'appended_owner_writer_boundary_unavailable\n');process.exitCode=1;}
finally{if(owner)try{await owner.shutdown();}catch{/* Ownership still retains uncertain slots; never forge close acknowledgement. */}}
