// Fixed invented Unix-only metadata -> separately explicit full record witness.
import assert from 'node:assert/strict';
import {readSync,writeSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
import {createPostgresReadOwner} from '../src/server/postgres-read-owner.ts';
import {createPostgresInitialCandidateCaptureTransport,POSTGRES_INITIAL_CANDIDATE_OWNER_GUARD_SQL as GUARD} from '../src/server/postgres-initial-candidate-capture-provider.ts';
import {prepareInitialCandidateLookup,parseInitialCandidateLookup} from '../src/server/initial-candidate-lookup.ts';
import {prepareInitialCandidateCaptureRead,parseStoredInitialCandidateCapture,INITIAL_CANDIDATE_CAPTURE_READ_SQL as READ} from '../src/server/initial-candidate-capture.ts';
const BEGIN='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',sha=b=>createHash('sha256').update(b).digest('hex');
// Existing genuine next-wall-tick observer: never round native SQL time down
// or invent a future trusted UTC to accommodate millisecond Date flooring.
async function observeAfterQuery(){const began=performance.now(),first=Date.now();assert.ok(Number.isFinite(began)&&Number.isSafeInteger(first)&&first>=0);let previous=began,wall=first;for(;;){await new Promise(r=>setTimeout(r,0));const n=performance.now(),w=Date.now();assert.ok(Number.isFinite(n)&&n>=previous&&n-began<20&&Number.isSafeInteger(w)&&w>=wall);previous=n;wall=w;if(w>first)return new Date(w).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z');}}
let owner,stage='startup';
try{
 const input=Buffer.alloc(294913);let size=0;while(size<input.length){const n=readSync(0,input,size,input.length-size,null);if(!n)break;size+=n;}assert.ok(size>=2&&size<=294912);const raw=input.subarray(0,size),text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(raw);assert.ok(Buffer.from(text).equals(raw));const v=JSON.parse(text);
 assert.deepEqual(Object.keys(v).sort(),['mode','report','expected','retainedIntentJson','observedAt','socketDirectory'].sort());assert.ok(['lookup','lookup_unmatched','capture'].includes(v.mode));
 const proof=process.cwd().replace(/\/inputs$/,''),socket=v.socketDirectory;assert.equal(process.cwd(),proof+'/inputs');assert.equal(socket,proof+'/protocol-socket');assert.match(socket,/^\/tmp\/tf-feed-postgres-trial-\d{8}T\d{6}Z-[a-f0-9]{8}\/protocol-socket$/);assert.equal(realpathSync(proof),proof);assert.equal(realpathSync(socket),socket);assert.ok(Buffer.byteLength(socket+'/.s.PGSQL.5432')<104);
 for(const[path,mode]of[[proof,0o700],[socket,0o1777]]){const s=lstatSync(path);assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.equal(s.uid,process.getuid());assert.equal(s.mode&0o7777,mode);}assert.ok(lstatSync(socket+'/.s.PGSQL.5432').isSocket());assert.equal(process.env.NODE_ENV,'development');for(const name of Object.keys(process.env))assert.ok(['PATH','LANG','TZ','NODE_ENV'].includes(name));
 const lookup=prepareInitialCandidateLookup(v.report,v.expected,v.observedAt),read=prepareInitialCandidateCaptureRead(v.retainedIntentJson),clients=[];
 const factory=async options=>{
  assert.equal(options.host,'127.0.0.1');assert.equal(options.port,5432);assert.equal(options.database,'postgres');assert.equal(options.user,'postgres');assert.equal(options.application_name,'terrafracta.operator-audit');assert.equal(options.fallback_application_name,'terrafracta.operator-audit');assert.equal(options.ssl,false);assert.equal(options.binary,false);assert.equal(options.replication,false);assert.equal(options.pipeline,false);assert.equal(options.client_encoding,'UTF8');assert.equal(options.connectionTimeoutMillis,1000);assert.equal(options.statement_timeout,2000);assert.equal(options.query_timeout,2250);assert.equal(options.lock_timeout,500);assert.equal(options.idle_in_transaction_session_timeout,2000);assert.equal(options.options,'-c default_transaction_read_only=on -c search_path=pg_catalog,pg_temp -c client_connection_check_interval=100');
  const c=new Client({...options,host:socket,port:5432}),record={pid:null,queries:[],closeCalls:0,closeAcknowledged:false},connect=c.connect.bind(c),query=c.query.bind(c),end=c.end.bind(c);assert.equal(c.host,socket);assert.equal(c.connectionParameters.isDomainSocket,true);clients.push(record);
  c.connect=async()=>{await connect();record.pid=c.processID;assert.ok(Number.isInteger(record.pid)&&record.pid>0);assert.equal(c.getTransactionStatus(),'I');};
  c.query=async q=>{
   assert.deepEqual(Object.keys(q).sort(),['rowMode','text','values']);assert.equal(q.rowMode,'array');let phase;
   if(q.text===BEGIN||q.text==='ROLLBACK'){phase=q.text===BEGIN?'begin':'rollback';assert.deepEqual(q.values,[]);}else if(q.text===GUARD){phase='guard';assert.deepEqual(q.values,[]);}else if(q.text===lookup.sql){phase='lookup';assert.notEqual(v.mode,'capture');assert.deepEqual(q.values,[...lookup.values]);}else if(q.text===READ){phase='capture';assert.equal(v.mode,'capture');assert.deepEqual(q.values,[...read.values]);}else throw Error('foreign_initial_lookup_statement');
   const before=c.getTransactionStatus(),r=await query(q),fields=r.fields.map(f=>({name:f.name,dataTypeID:f.dataTypeID})),item={phase,command:r.command,rowCount:r.rowCount,fields,rows:r.rows.length,statusBefore:before,statusAfter:c.getTransactionStatus(),valueCount:q.values.length};record.queries.push(item);
   if(phase==='begin'||phase==='rollback'){assert.equal(r.command,phase==='begin'?'BEGIN':'ROLLBACK');assert.equal(r.rowCount,null);assert.deepEqual(fields,[]);assert.deepEqual(r.rows,[]);assert.equal(item.statusAfter,phase==='begin'?'T':'I');}
   else{assert.equal(r.command,'SELECT');assert.equal(r.rowCount,1);assert.equal(r.rows.length,1);assert.equal(r.rows[0].length,1);assert.deepEqual(fields,[{name:phase==='guard'?'admitted':phase,dataTypeID:phase==='guard'?16:25}]);if(phase==='guard')assert.deepEqual(r.rows,[[true]]);else assert.equal(typeof r.rows[0][0],'string');assert.equal(item.statusAfter,'T');}return r;
  };
  c.end=()=>{record.closeCalls++;assert.equal(record.closeCalls,1);return end().then(()=>{record.closeAcknowledged=true;});};return c;
 };
 owner=createPostgresReadOwner({host:'127.0.0.1',port:5432,database:'postgres',user:'postgres',password:'INVENTED_LOCAL_NONSECRET_PLACEHOLDER',transport:{kind:'loopback-development'}},'terrafracta.operator-audit',false,factory);const transport=createPostgresInitialCandidateCaptureTransport(owner),signal=new AbortController().signal;
 stage=v.mode;const bytes=v.mode==='capture'?await transport.readCapture(read,signal):await transport.readLookup(v.report,v.expected,v.observedAt,signal);const observedAt=await observeAfterQuery();let parsed;
 if(v.mode==='capture'){const p=parseStoredInitialCandidateCapture(bytes,v.retainedIntentJson,v.expected,observedAt);parsed={captureId:p.capture.captureId,preparationOperationId:p.preparation.preparation.operation_id,receiptSha256:p.receiptSha256,reportJson:p.reportJson};}
 else if(v.mode==='lookup_unmatched'){const native=JSON.parse(Buffer.from(bytes).toString('utf8'));assert.equal(native.preparation_matched,false);assert.deepEqual(native.matches,[]);assert.throws(()=>parseInitialCandidateLookup(bytes,v.report,v.expected,observedAt),/^Error: initial_candidate_lookup_unavailable$/);parsed={unmatchedPreparationRefused:true,nativeEmptyWasNotAdmitted:true};}
 else parsed=parseInitialCandidateLookup(bytes,v.report,v.expected,observedAt);
 assert.equal(await owner.shutdown(),true);assert.equal(clients.length,1);assert.ok(clients.every(c=>c.closeCalls===1&&c.closeAcknowledged));assert.deepEqual(clients[0].queries.map(q=>q.phase),['begin','guard',v.mode==='capture'?'capture':'lookup','rollback']);
 const result={mode:v.mode,lookupCommand:lookup,rawBase64:Buffer.from(bytes).toString('base64'),rawBytes:bytes.length,rawSha256:sha(bytes),observedAt,parsed,clients,allPhysicalCloseAcknowledged:true,sourceOrModelCalls:0,defaultFactoryQualified:false,actualAuthentication:false,publication:false};writeSync(1,JSON.stringify(result)+'\n');
}catch{try{if(owner)await owner.shutdown();}catch{}writeSync(2,JSON.stringify({kind:'initial_lookup_native_failed',stage})+'\n');process.exitCode=1;}
