// Fixed invented native PostgreSQL protocol witness. Only the launcher-owned
// Unix directory is accepted; no environment/URL/default backend is selected.
import assert from 'node:assert/strict';
import {readSync,writeSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
import {createPostgresAppendedCaptureTransport,POSTGRES_APPENDED_OWNER_GUARD_SQL as GUARD} from '../src/server/postgres-appended-capture-provider.ts';
import {APPENDED_CAPTURE_LOOKUP_SQL as LOOKUP,prepareAppendedCaptureLookup,parseAppendedCaptureLookup} from '../src/server/appended-capture-lookup.ts';
import {APPENDED_CAPTURE_READ_SQL as CAPTURE,prepareAppendedIssueCaptureRead} from '../src/server/appended-issue-capture.ts';
import {createSelectedAppendedCaptureReader} from '../src/server/appended-capture-selection.ts';
const BEGIN='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',SLOT='SELECT 1::integer AS settled';
const instant=()=>new Date().toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const held=async promise=>{try{await promise;return 'unexpected_ok';}catch{return 'unavailable';}};
// Laboratory observation only: millisecond Date precision must not floor a
// same-tick PostgreSQL microsecond observation into an earlier post-read time.
// Wait for a genuinely observed later wall-clock tick, without rounding the
// native observation or synthesizing a future timestamp.
export async function observeAfterQuery(wall=()=>Date.now(),monotonic=()=>performance.now(),pause=()=>new Promise(resolve=>setTimeout(resolve,0))){
 const began=monotonic(),first=wall();
 if(!Number.isFinite(began)||!Number.isSafeInteger(first)||first<0)throw Error('protocol_clock_unavailable');
 let previous=began,previousWall=first;
 for(;;){
  await pause();const tick=monotonic(),observed=wall();
  if(!Number.isFinite(tick)||tick<previous||tick-began>=20||!Number.isSafeInteger(observed)||observed<previousWall)throw Error('protocol_clock_unavailable');
  previous=tick;previousWall=observed;
  if(observed>first)return new Date(observed).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');
 }
}
const owners=[];
try{
 const b=Buffer.alloc(294913);let n=0;while(n<b.length){const k=readSync(0,b,n,b.length-n,null);if(!k)break;n+=k;}
 assert.ok(n>=2&&n<=294912);const raw=b.subarray(0,n),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(raw);assert.ok(Buffer.from(text,'utf8').equals(raw));
 const v=JSON.parse(text);assert.deepEqual(Object.keys(v).sort(),['captureIntentJson','context','expectedReceiptSHA256','mode','socketDirectory']);assert.ok(v.mode==='read'||v.mode==='blocked');
 const socket=v.socketDirectory,parent=new URL('..',import.meta.url);assert.equal(typeof socket,'string');assert.match(socket,/^\/tmp\/tf-feed-postgres-trial-\d{8}T\d{6}Z-[a-f0-9]{8}\/protocol-socket$/);assert.ok(Buffer.byteLength(socket+'/.s.PGSQL.5432')<104);
 // The runtime cwd is the exact frozen inputs tree beside the bound socket.
 const proof=process.cwd().replace(/\/inputs$/,'');assert.equal(process.cwd(),proof+'/inputs');assert.equal(socket,proof+'/protocol-socket');assert.equal(realpathSync(proof),proof);assert.equal(realpathSync(socket),socket);
 for(const [path,mode]of[[proof,0o700],[socket,0o1777]]){const s=lstatSync(path);assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.equal(s.uid,process.getuid());assert.equal(s.mode&0o7777,mode);}
 assert.ok(lstatSync(socket+'/.s.PGSQL.5432').isSocket());assert.equal(process.env.NODE_ENV,'development');
 for(const name of Object.keys(process.env))assert.ok(['PATH','LANG','TZ','NODE_ENV'].includes(name));
 assert.equal(typeof v.context.report,'string');assert.match(v.expectedReceiptSHA256,/^[a-f0-9]{64}$/);
 const captured=prepareAppendedIssueCaptureRead(v.captureIntentJson),lookup=prepareAppendedCaptureLookup(v.context.report,v.context.expected,instant());
 const all=[];
 function harness(onGuard){
  const records=[],calls=[];let submitted=0,readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});
  const config={host:'127.0.0.1',port:5432,database:'postgres',user:'postgres',password:'INVENTED_LOCAL_NONSECRET_PLACEHOLDER',transport:{kind:'loopback-development'}};
  const factory=async options=>{
   assert.deepEqual(Object.keys(options).sort(),['application_name','binary','client_encoding','connectionTimeoutMillis','database','enableChannelBinding','fallback_application_name','host','idle_in_transaction_session_timeout','lock_timeout','options','password','pipeline','port','query_timeout','replication','ssl','sslnegotiation','statement_timeout','user'].sort());
   assert.equal(options.host,'127.0.0.1');assert.equal(options.port,5432);assert.equal(options.database,'postgres');assert.equal(options.user,'postgres');assert.equal(options.ssl,false);assert.equal(options.binary,false);assert.equal(options.replication,false);assert.equal(options.pipeline,false);assert.equal(options.sslnegotiation,'postgres');assert.equal(options.enableChannelBinding,true);assert.equal(options.client_encoding,'UTF8');
   assert.equal(options.connectionTimeoutMillis,1000);assert.equal(options.statement_timeout,2000);assert.equal(options.query_timeout,2250);assert.equal(options.lock_timeout,500);assert.equal(options.idle_in_transaction_session_timeout,2000);assert.equal(options.application_name,'terrafracta.operator-audit');assert.equal(options.fallback_application_name,'terrafracta.operator-audit');assert.equal(options.options,'-c default_transaction_read_only=on -c search_path=pg_catalog,pg_temp -c client_connection_check_interval=100');assert.equal(typeof options.password,'string');assert.ok(options.password.length>0);
   const client=new Client({...options,host:socket,port:5432});assert.equal(client.host,socket);assert.equal(client.binary,false);assert.ok(client.replication===false||client.replication===undefined);assert.equal(client.connectionParameters.isDomainSocket,true);
   const r={pid:null,closeCalls:0,closeAcknowledged:false,queries:[],endPromise:undefined};records.push(r);all.push(r);
   const connect=client.connect.bind(client),query=client.query.bind(client),end=client.end.bind(client);
   client.connect=async()=>{await connect();assert.ok(Number.isInteger(client.processID)&&client.processID>0);r.pid=client.processID;};
   client.query=async q=>{
    assert.deepEqual(Object.keys(q).sort(),['rowMode','text','values']);assert.equal(q.rowMode,'array');let phase;
    if(q.text===BEGIN||q.text==='ROLLBACK'){phase=q.text===BEGIN?'begin':'rollback';assert.deepEqual(q.values,[]);}
    else if(q.text===GUARD){phase='guard';assert.deepEqual(q.values,[]);}
    else if(q.text===LOOKUP){phase='lookup';assert.deepEqual(q.values,[...lookup.values]);}
    else if(q.text===CAPTURE){phase='capture';assert.deepEqual(q.values,[...captured.values]);}
    else if(q.text===SLOT){phase='slot_probe';assert.deepEqual(q.values,[]);}
    else throw Error('foreign_protocol_statement');
    const item={phase,valueCount:q.values.length};r.queries.push(item);calls.push(item);
    // Forward the exact actual fixed query and values to the locked driver.
    const pending=query(q);if(phase==='capture'&&++submitted===2)readyResolve();
    try{
     const out=await pending;item.command=out.command;item.rowCount=out.rowCount;item.fields=out.fields.map(f=>({name:f.name,dataTypeID:f.dataTypeID}));item.rows=out.rows.length;
     if(phase==='guard'&&onGuard)onGuard();return out;
    }catch(error){item.failureCode=error?.code==='55P03'?'55P03':'native_failure';throw error;}
   };
   client.end=()=>{r.closeCalls++;assert.equal(r.closeCalls,1);r.endPromise=end().then(()=>{r.closeAcknowledged=true;});return r.endPromise;};return client;
  };
  const owner=createPostgresReadOwner(config,'terrafracta.operator-audit',false,factory);owners.push(owner);return {owner,t:createPostgresAppendedCaptureTransport(owner),records,calls,ready};
 }
 let result;
 if(v.mode==='read'){
  const h=harness(),signal=()=>new AbortController().signal;
  const before=h.records.length,pre=new AbortController();pre.abort();assert.equal(await held(h.t.readCapture(captured,pre.signal)),'unavailable');assert.equal(h.records.length,before);
  const lookupBytes=await h.t.readLookup(v.context.report,v.context.expected,instant(),signal()),postLookup=await observeAfterQuery(),metadata=parseAppendedCaptureLookup(lookupBytes,v.context.report,v.context.expected,postLookup);assert.equal(metadata.matches.length,1);assert.equal(metadata.matches[0].captureId,captured.values[0]);
  const receipt=await h.t.readCapture(captured,signal());assert.equal(sha(receipt),v.expectedReceiptSHA256);
  const selection={preparationReportJson:v.context.report,preparationReportSha256:v.context.expected.reportSha256,preparationIntentJson:v.context.expected.preparationIntentJson,lookupRaw:lookupBytes,captureId:captured.values[0],captureIntentJson:v.captureIntentJson,observedAt:await observeAfterQuery()};
  const diagnostics=[],reader=createSelectedAppendedCaptureReader(h.t.readCapture,undefined,code=>diagnostics.push(code));const selected=await reader(selection);assert.equal(selected.kind,'ok');assert.equal(selected.stored.receiptSha256,v.expectedReceiptSHA256);assert.deepEqual(diagnostics,[]);
  const acquired=h.records.length;assert.equal((await reader({...selection,captureId:'00000000-0000-4000-8000-000000000999'})).kind,'invalid_scope');assert.equal(h.records.length,acquired);
  assert.ok(h.records.every(r=>r.closeAcknowledged&&r.closeCalls===1));assert.equal(await h.owner.shutdown(),true);
  for(const r of h.records){assert.deepEqual(r.queries.map(q=>q.phase),['begin','guard',r.queries[2].phase,'rollback']);assert.deepEqual(r.queries[0].fields,[]);assert.equal(r.queries[0].rowCount,null);assert.deepEqual(r.queries[1].fields,[{name:'admitted',dataTypeID:16}]);assert.deepEqual(r.queries[2].fields,[{name:r.queries[2].phase,dataTypeID:25}]);assert.deepEqual(r.queries[3].fields,[]);assert.equal(r.queries[3].rowCount,null);}
  const parent=new AbortController(),c=harness(()=>parent.abort());assert.equal(await held(c.t.readCapture(captured,parent.signal)),'unavailable');assert.equal(await c.owner.shutdown(),true);assert.equal(c.records.length,1);assert.deepEqual(c.records[0].queries.map(q=>q.phase),['begin','guard']);
  result={state:'PASS_INVENTED_NATIVE_OWNER_PROTOCOL',actualDatabaseConnection:true,selectedReceiptSha256:selected.stored.receiptSha256,lookupBytes:lookupBytes.length,captureBytes:receipt.length,preabortAcquisitions:0,foreignChoiceAcquisitions:0,guardCancellation:'unavailable',guardCancelledCaptureQueries:0};
 }else{
  const h=harness(),signal=()=>new AbortController().signal,one=held(h.t.readCapture(captured,signal())),two=held(h.t.readCapture(captured,signal()));
  await Promise.race([h.ready,Promise.all([one,two]).then(()=>{throw Error('two_native_capture_submissions_unavailable');})]);assert.equal(h.records.length,2);const before=h.records.length;assert.equal(await held(h.t.readCapture(captured,signal())),'unavailable');assert.equal(h.records.length,before);
  assert.deepEqual(await Promise.all([one,two]),['unavailable','unavailable']);await Promise.all(h.records.map(r=>r.endPromise));assert.equal(h.records.length,2);const blockedPids=h.records.map(r=>r.pid);assert.equal(new Set(blockedPids).size,2);assert.ok(h.records.every(r=>r.closeAcknowledged&&r.queries.some(q=>q.phase==='capture'&&q.failureCode==='55P03')));
  const reused=await h.owner.run(signal(),async(client,active)=>{active();const r=await client.query({text:SLOT,values:[],rowMode:'array'});active();assert.deepEqual(r.rows,[[1]]);assert.equal(r.fields[0].dataTypeID,23);return true;});assert.equal(reused,true);assert.equal(h.records.length,3);assert.equal(await h.owner.shutdown(),true);
  result={state:'PASS_INVENTED_NATIVE_OWNER_PROTOCOL_CONTENTION',blockedBackendPids:blockedPids,lockTimeouts:2,overflow:'unavailable',overflowAcquisitions:0,acquisitionsBeforeRetirement:2,reusedAfterClose:true,shutdown:true};
 }
 assert.ok(all.every(r=>r.closeCalls===1&&r.closeAcknowledged));result.allPhysicalCloseAcknowledged=true;result.nativeClients=all.map(({endPromise,...r})=>r);result.defaultFactoryQualified=false;result.actualAuthentication=false;result.tlsQualified=false;
 const encoded=Buffer.from(JSON.stringify(result),'utf8');assert.ok(encoded.length<=131072);writeSync(1,encoded);
}catch{writeSync(2,'appended_owner_protocol_boundary_unavailable\n');process.exitCode=1;}
finally{for(const owner of owners){try{await owner.shutdown();}catch{/* Each actual owned client retains its own close attempt. */}}}
