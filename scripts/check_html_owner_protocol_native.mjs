// Fixed fresh-laboratory witness. No configured backend or operational identity.
import assert from 'node:assert/strict';
import {readSync,writeSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
import {createPostgresHtmlAppendedWorkTransport,POSTGRES_HTML_APPENDED_WORK_SQL as WRITE} from '../src/server/postgres-html-appended-work-transport.ts';
import {createPostgresHtmlAppendedCaptureTransport,POSTGRES_HTML_APPENDED_OWNER_GUARD_SQL as GUARD} from '../src/server/postgres-html-appended-capture-provider.ts';
import {prepareHtmlAppendedIssueCaptureForWork} from '../src/server/html-appended-capture-work.ts';
import {prepareHtmlAppendedIssueCaptureRead,HTML_APPENDED_CAPTURE_READ_SQL as READ} from '../src/server/html-appended-issue-capture.ts';
import {prepareHtmlAppendedCaptureLookup,parseHtmlAppendedCaptureLookup,HTML_APPENDED_CAPTURE_LOOKUP_SQL as LOOKUP} from '../src/server/html-appended-capture-lookup.ts';
import {createSelectedHtmlAppendedCaptureReader} from '../src/server/html-appended-capture-selection.ts';
const BEGIN='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const SETS=['SET default_transaction_read_only = off',"SET default_transaction_isolation = 'read committed'"];
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const instant=()=>new Date().toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');
// Observe a genuinely later wall tick; never round PG microseconds forward or
// invent a future observation to accommodate the JS clock's lower precision.
async function observeAfterQuery(){
 const began=performance.now(),first=Date.now();let previous=began,wall=first;
 if(!Number.isFinite(began)||!Number.isSafeInteger(first)||first<0)throw Error();
 for(;;){
  await new Promise(resolve=>setTimeout(resolve,0));const tick=performance.now(),observed=Date.now();
  if(!Number.isFinite(tick)||tick<previous||tick-began>=20||!Number.isSafeInteger(observed)||observed<wall)throw Error();
  previous=tick;wall=observed;
  if(observed>first)return new Date(observed).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');
 }
}
const owners=[];
try{
 const input=Buffer.alloc(294913);let size=0;
 while(size<input.length){const n=readSync(0,input,size,input.length-size,null);if(!n)break;size+=n;}
 assert.ok(size>=2&&size<=294912);
 const raw=input.subarray(0,size),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(raw);
 assert.ok(Buffer.from(text,'utf8').equals(raw));const v=JSON.parse(text);
 const first=v.mode==='capture-unobserved';
 assert.ok(first||['recover-read','read','refuse-work'].includes(v.mode));
 assert.deepEqual(Object.keys(v).sort(),(first?['mode','socketDirectory','work','bundle','expected','captureIntentJson','context']:['mode','socketDirectory','work','context','captureIntentJson','expectedReceiptSHA256']).sort());
 assert.deepEqual(Object.keys(v.context).sort(),['expected','report']);
 const socket=v.socketDirectory,proof=process.cwd().replace(/\/inputs$/,'');
 assert.equal(process.cwd(),proof+'/inputs');assert.equal(socket,proof+'/protocol-socket');
 assert.match(socket,/^\/tmp\/tf-feed-postgres-trial-\d{8}T\d{6}Z-[a-f0-9]{8}\/protocol-socket$/);
 assert.ok(Buffer.byteLength(socket+'/.s.PGSQL.5432')<104);
 assert.equal(realpathSync(proof),proof);assert.equal(realpathSync(socket),socket);
 for(const [path,mode]of[[proof,0o700],[socket,0o1777]]){const s=lstatSync(path);assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.equal(s.uid,process.getuid());assert.equal(s.mode&0o7777,mode);}
 assert.ok(lstatSync(socket+'/.s.PGSQL.5432').isSocket());assert.equal(process.env.NODE_ENV,'development');
 assert.deepEqual(Object.keys(process.env).sort(),['LANG','NODE_ENV','PATH','TZ']);
 const command=prepareHtmlAppendedIssueCaptureRead(v.captureIntentJson),lookup=prepareHtmlAppendedCaptureLookup(v.context.report,v.context.expected,instant());
 if(first){
  assert.equal(v.bundle.candidateReportJson,v.context.report);
  assert.equal(v.expected.candidateReportSha256,v.context.expected.reportSha256);
  assert.equal(v.expected.preparationIntentJson,v.context.expected.preparationIntentJson);
  assert.equal(prepareHtmlAppendedIssueCaptureForWork(v.work,v.bundle,v.expected).capture.intentJson,v.captureIntentJson);
 }else assert.match(v.expectedReceiptSHA256,/^[a-f0-9]{64}$/);
 const records=[],diagnostics=[];let lastReceipt;
 let expectedAssociationValues=first?[...prepareHtmlAppendedIssueCaptureForWork(v.work,v.bundle,v.expected).capture.values]:undefined;
 const config={host:'127.0.0.1',port:5432,database:'postgres',user:'postgres',password:'INVENTED_LOCAL_NONSECRET_PLACEHOLDER',transport:{kind:'loopback-development'}};
 const factory=async options=>{
  assert.deepEqual(Object.keys(options).sort(),['application_name','binary','client_encoding','connectionTimeoutMillis','database','enableChannelBinding','fallback_application_name','host','idle_in_transaction_session_timeout','lock_timeout','options','password','pipeline','port','query_timeout','replication','ssl','sslnegotiation','statement_timeout','user'].sort());
  assert.equal(options.host,'127.0.0.1');assert.equal(options.port,5432);assert.equal(options.database,'postgres');assert.equal(options.user,'postgres');assert.equal(options.ssl,false);assert.equal(options.binary,false);assert.equal(options.replication,false);assert.equal(options.pipeline,false);
  assert.equal(options.sslnegotiation,'postgres');assert.equal(options.enableChannelBinding,true);assert.equal(options.client_encoding,'UTF8');
  assert.equal(options.connectionTimeoutMillis,1000);assert.equal(options.statement_timeout,2000);assert.equal(options.query_timeout,2250);assert.equal(options.lock_timeout,500);assert.equal(options.idle_in_transaction_session_timeout,2000);
  assert.equal(options.application_name,'terrafracta.proposal-worker');assert.equal(options.fallback_application_name,'terrafracta.proposal-worker');
  assert.equal(options.options,'-c default_transaction_read_only=on -c search_path=pg_catalog,pg_temp -c client_connection_check_interval=100');
  const client=new Client({...options,host:socket,port:5432});
  assert.equal(client.host,socket);assert.equal(client.connectionParameters.isDomainSocket,true);assert.equal(client.binary,false);assert.ok(client.replication===false||client.replication===undefined);
  const r={pid:null,closeCalls:0,closeAcknowledged:false,queries:[]};records.push(r);
  const connect=client.connect.bind(client),query=client.query.bind(client),end=client.end.bind(client);
  client.connect=async()=>{await connect();assert.ok(Number.isInteger(client.processID)&&client.processID>0);r.pid=client.processID;};
  client.query=async q=>{
   assert.deepEqual(Object.keys(q).sort(),['rowMode','text','values']);assert.equal(q.rowMode,'array');let phase;
   if(q.text===BEGIN||q.text==='ROLLBACK'){phase=q.text===BEGIN?'begin':'rollback';assert.deepEqual(q.values,[]);}
   else if(q.text===GUARD){phase='guard';assert.deepEqual(q.values,[]);}
   else if(q.text===LOOKUP){phase='lookup';assert.deepEqual(q.values,[...lookup.values]);}
   else if(q.text===READ){phase='capture';assert.deepEqual(q.values,[...command.values]);}
   else if(SETS.includes(q.text)){phase='set';assert.deepEqual(q.values,[]);}
   else if(q.text===WRITE){phase='write';assert.equal(q.values.length,10);assert.equal(q.values[0],v.work.runId);assert.equal(q.values[1],v.work.requestFingerprint);assert.equal(q.values[2],v.work.workClaimId);assert.ok(expectedAssociationValues);assert.deepEqual(q.values.slice(3),expectedAssociationValues);}
   else throw Error('foreign_html_protocol_statement');
   const item={phase,text:q.text,values:[...q.values]};r.queries.push(item);
   try{
    const result=await query(q);item.command=result.command;item.rowCount=result.rowCount;item.fields=result.fields.map(f=>({name:f.name,dataTypeID:f.dataTypeID}));item.rows=result.rows.length;
    if(phase==='write'&&result.rows[0]?.[0]===true&&typeof result.rows[0]?.[1]==='string')lastReceipt=Buffer.from(result.rows[0][1],'utf8');
    if(phase==='capture'&&typeof result.rows[0]?.[0]==='string')lastReceipt=Buffer.from(result.rows[0][0],'utf8');
    return result;
   }catch(error){item.failureCode=['23514','23505','40001','55P03'].includes(error?.code)?error.code:'native_failure';throw error;}
  };
  client.end=()=>{r.closeCalls++;assert.equal(r.closeCalls,1);return end().then(()=>{r.closeAcknowledged=true;});};
  return client;
 };
 const owner=createPostgresReadOwner(config,'terrafracta.proposal-worker',false,factory);owners.push(owner);
 const record=async code=>{diagnostics.push(code);return 'saved';};
 let result;
 if(first){
  const writer=createPostgresHtmlAppendedWorkTransport(owner,()=>{throw Error('invented_postwrite_observation_unavailable');},record);
  const outcome=await writer.capture(v.work,v.bundle,v.expected,new AbortController().signal);
  assert.deepEqual(outcome,{kind:'outcome_unknown'});assert.ok(lastReceipt?.length>0);assert.deepEqual(diagnostics,['proposal_capture_write']);
  assert.equal(records.length,1);assert.deepEqual(records[0].queries.map(q=>q.phase),['set','set','write']);
  result={state:'PASS_INVENTED_HTML_OWNER_PROTOCOL_WRITE_UNKNOWN',outcome:outcome.kind,receiptSha256:sha(lastReceipt),rawReceiptBase64:lastReceipt.toString('base64'),captureIntentJson:v.captureIntentJson};
 }else{
  const t=createPostgresHtmlAppendedCaptureTransport(owner),signal=()=>new AbortController().signal;
  const pre=new AbortController();pre.abort();await assert.rejects(t.readCapture(command,pre.signal));assert.equal(records.length,0);
  const lookupRaw=await t.readLookup(v.context.report,v.context.expected,instant(),signal()),metadata=parseHtmlAppendedCaptureLookup(lookupRaw,v.context.report,v.context.expected,await observeAfterQuery());
  assert.equal(metadata.matches.length,1);assert.equal(metadata.matches[0].captureId,command.values[0]);
  const full=await t.readCapture(command,signal());assert.equal(sha(full),v.expectedReceiptSHA256);
  const selection={preparationReportJson:v.context.report,preparationReportSha256:v.context.expected.reportSha256,preparationIntentJson:v.context.expected.preparationIntentJson,lookupRaw,captureId:command.values[0],captureIntentJson:v.captureIntentJson,observedAt:await observeAfterQuery()};
  const reader=createSelectedHtmlAppendedCaptureReader(t.readCapture,undefined,record),selected=await reader(selection);
  assert.equal(selected.kind,'ok');assert.equal(selected.stored.receiptSha256,v.expectedReceiptSHA256);assert.equal(selected.stored.intentJson,v.captureIntentJson);
  const before=records.length;assert.equal((await reader({...selection,captureId:'00000000-0000-4000-8000-000000000999'})).kind,'invalid_scope');assert.equal(records.length,before);
  const storedRaw=Buffer.from(full);assert.ok(lastReceipt.equals(storedRaw));
  result={state:'PASS_INVENTED_HTML_OWNER_PROTOCOL_READ',selectedReceiptSha256:selected.stored.receiptSha256,selectedPreparationReceiptSha256:JSON.parse(selected.stored.bundle.candidateReportJson).preparation.receipt_sha256,
   rawReceiptBase64:storedRaw.toString('base64'),captureIntentJson:v.captureIntentJson,matchCount:metadata.matches.length,explicitChoice:true,preabortAcquisitions:0,foreignChoiceAcquisitions:0};
  if(v.mode==='recover-read'||v.mode==='refuse-work'){
   const fullNative=JSON.parse(storedRaw.toString('utf8'));assert.equal(fullNative.intent_base64,Buffer.from(v.captureIntentJson,'utf8').toString('base64'));
   expectedAssociationValues=[fullNative.intent_base64,...fullNative.parts_base64];assert.equal(expectedAssociationValues.length,7);
   const writer=createPostgresHtmlAppendedWorkTransport(owner,observeAfterQuery,record);
   // Only the actual full getter's owned bytes plus separately retained intent
   // and an explicit work identity reach recovery. No warm bundle is supplied.
   const recovered=await writer.recover(v.work,storedRaw,v.captureIntentJson,selected.stored.observedAt,signal());
   if(v.mode==='recover-read'){
    assert.equal(recovered.kind,'confirmed');assert.equal(recovered.stored.receiptSha256,v.expectedReceiptSHA256);assert.equal(recovered.stored.intentJson,v.captureIntentJson);assert.ok(lastReceipt.equals(storedRaw));
    result.state='PASS_INVENTED_HTML_OWNER_PROTOCOL_READ_RECOVERY';result.recoveryReceiptSha256=recovered.stored.receiptSha256;
   }else{
    assert.deepEqual(recovered,{kind:'outcome_unknown'});assert.equal(records.at(-1).queries.at(-1).failureCode,'23514');
    result.state='PASS_INVENTED_HTML_OWNER_PROTOCOL_WORK_REFUSAL';result.outcome=recovered.kind;result.expectedRefusalCodes=['23514'];
   }
  }
  assert.deepEqual(diagnostics,[]);
  for(const r of records.filter(r=>r.queries[0]?.phase==='begin'))assert.deepEqual(r.queries.map(q=>q.phase),['begin','guard',r.queries[2].phase,'rollback']);
 }
 assert.equal(await owner.shutdown(),true);assert.ok(records.every(r=>r.closeCalls===1&&r.closeAcknowledged));
 result.nativeClients=records;result.allPhysicalCloseAcknowledged=true;result.actualDatabaseConnection=true;
 result.defaultFactoryQualified=false;result.actualAuthentication=false;result.tlsQualified=false;result.publicationQualified=false;
 const encoded=Buffer.from(JSON.stringify(result),'utf8');assert.ok(encoded.length<=131072);writeSync(1,encoded);
}catch{writeSync(2,'html_owner_protocol_boundary_unavailable\n');process.exitCode=1;}
finally{for(const owner of owners){try{await owner.shutdown();}catch{/* Independent actual owned-client cleanup retains its own acknowledgement. */}}}
