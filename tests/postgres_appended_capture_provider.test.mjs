import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {getEventListeners} from "node:events";
import {createPostgresAppendedCaptureTransport as transport,POSTGRES_APPENDED_OWNER_GUARD_SQL as GUARD} from "../src/server/postgres-appended-capture-provider.ts";
import {createPostgresReadOwner} from "../src/server/postgres-read-owner.ts";
import {prepareAppendedCaptureLookup,parseAppendedCaptureLookup} from "../src/server/appended-capture-lookup.ts";
import {prepareAppendedIssueCaptureRead,APPENDED_CAPTURE_READ_SQL} from "../src/server/appended-issue-capture.ts";
import {createAppendedCaptureReader} from "../src/server/appended-capture-reader.ts";
const BEGIN="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const ack=command=>({command,rowCount:null,fields:[],rows:[]});
const cell=(column,value,oid=25)=>({command:"SELECT",rowCount:1,fields:[{name:column,dataTypeID:oid}],rows:[[value]]});
const config=()=>({host:"db.example.invalid",port:5432,database:"fictional",user:"postgres",password:"INVENTED_TEST_PASSWORD_NOT_A_CREDENTIAL",transport:{kind:"verified-tls"}});
function fixture(){const f=JSON.parse(readFileSync(new URL("../fixtures/fictional-appended-capture.json",import.meta.url),"utf8")),n=JSON.parse(f.rawReceiptJson),report=Buffer.from(n.parts_base64[0],"base64").toString(),expected={reportSha256:JSON.parse(f.retainedIntentJson).part_sha256[0],preparationIntentJson:JSON.parse(report).intent_json};const command=prepareAppendedCaptureLookup(report,expected,f.observedAt);return {f,n,report,expected,command,lookup:JSON.stringify({schema_version:1,kind:"invented_appended_capture_lookup",scope:command.scope,principal:"postgres",session_principal:"postgres",transaction_isolation:"repeatable read",transaction_read_only:true,preparation_matched:true,observed_at:f.observedAt,matches:[{capture_id:n.capture_id,preparation_operation_id:n.preparation_operation_id,stored_at:n.stored_at,intent_sha256:createHash("sha256").update(f.retainedIntentJson).digest("hex")}]})};}
class Client{
 constructor(f){this.f=f;this.queries=[];this.connected=0;this.ended=0;this.listeners=[];}
 async connect(){this.connected++;}
 on(_event,listener){this.listeners.push(listener);}
 async end(){this.ended++;}
 async query(q){this.queries.push(q);if(q.text===BEGIN)return ack("BEGIN");if(q.text==="ROLLBACK")return ack("ROLLBACK");if(q.text===GUARD)return cell("admitted",true,16);return q.text===APPENDED_CAPTURE_READ_SQL?cell("capture",this.f.f.rawReceiptJson):cell("lookup",this.f.lookup);}
}
function harness(makeClient,clock=()=>0){const f=fixture(),clients=[],configs=[];const owner=createPostgresReadOwner(config(),"terrafracta.operator-audit",true,async options=>{configs.push(options);const c=makeClient?makeClient(f):new Client(f);clients.push(c);return c;},clock);return {f,clients,configs,owner,t:transport(owner)};}
const signal=()=>new AbortController().signal,held={message:"read_unavailable"};
test("one existing owner drives fixed lookup and complete historical reader through RR owner guard rollback and close",async()=>{
 const h=harness(),{f}=h;const raw=await h.t.readLookup(f.report,f.expected,f.f.observedAt,signal());assert.equal(parseAppendedCaptureLookup(raw,f.report,f.expected,f.f.observedAt).matches[0].captureId,f.n.capture_id);
 const r=await createAppendedCaptureReader(h.t.readCapture,()=>0,async()=>"saved")({retainedIntentJson:f.f.retainedIntentJson,observedAt:f.f.observedAt});assert.equal(r.kind,"ok");assert.equal(r.stored.receiptSha256,f.f.receiptSha256);assert.equal(h.clients.length,2);
 for(const c of h.clients){assert.deepEqual(c.queries.map(q=>q.text),[BEGIN,GUARD,c===h.clients[0]?f.command.sql:APPENDED_CAPTURE_READ_SQL,"ROLLBACK"]);assert.ok(c.queries.every(q=>q.rowMode==="array"));assert.equal(c.ended,1);assert.equal(c.connected,1);assert.doesNotMatch(c.queries.map(q=>q.text).join("\n"),/SET.*ROLE|COMMIT|INSERT|UPDATE|DELETE/i);}
 assert.deepEqual(h.clients[0].queries[2].values,f.command.values);assert.deepEqual(h.clients[1].queries[2].values,[f.n.capture_id]);assert.equal(await h.owner.shutdown(),true);
});
test("invalid owner injection and malformed lookup or closed command never acquire a client",async()=>{
 const h=harness(),f=h.f;for(const owner of [null,{},Object.create(h.owner),{...h.owner,user:"terra_reviewer"},{...h.owner,sql:"PRIVATE_CANARY"}])assert.throws(()=>transport(owner),held);
 const good=prepareAppendedIssueCaptureRead(f.f.retainedIntentJson),inherited=Object.create(good),hidden={...good};Object.defineProperty(hidden,"sql",{enumerable:false});
 const extraArray=[...good.values];extraArray.extra="PRIVATE_CANARY";
 for(const c of [null,{},inherited,hidden,{...good,sql:"SELECT PRIVATE_CANARY"},{...good,values:[]},{...good,values:[...good.values,...good.values]},{...good,values:["PRIVATE_CANARY"]},{...good,values:extraArray},{...good,extra:true}])await assert.rejects(h.t.readCapture(c,signal()),held);
 await assert.rejects(h.t.readLookup(f.report,{...f.expected,reportSha256:"f".repeat(64)},f.f.observedAt,signal()),held);assert.equal(h.clients.length,0);assert.equal(await h.owner.shutdown(),true);
});
test("captured fixed command survives caller mutation and getters run once before owner admission",async()=>{
 const h=harness(),pending=deferred(),original=h.owner.run;let heldExecute,runCalls=0,getters=0;const owner=Object.freeze({user:"postgres",shutdown:h.owner.shutdown,run:(s,execute)=>{runCalls++;heldExecute=()=>original(s,execute);return pending.promise;}}),t=transport(owner),c={values:[h.f.n.capture_id]};Object.defineProperty(c,"sql",{enumerable:true,get(){getters++;return APPENDED_CAPTURE_READ_SQL;}});
 const reading=t.readCapture(c,signal());c.values[0]="00000000-0000-4000-8000-000000000999";await turn();pending.resolve(await heldExecute());assert.equal((await reading).length,Buffer.byteLength(h.f.f.rawReceiptJson));assert.equal(getters,1);assert.equal(runCalls,1);assert.deepEqual(h.clients[0].queries[2].values,[h.f.n.capture_id]);assert.equal(await h.owner.shutdown(),true);
});
test("malformed false or foreign owner guard cannot reach either private data query",async()=>{
 for(const result of [cell("admitted",false,16),cell("admitted",true),cell("other",true,16),{...cell("admitted",true,16),rowCount:2},{...cell("admitted",true,16),rows:[[true,true]]}]){
  const h=harness(f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>q.text===GUARD?(c.queries.push(q),result):query(q);return c;});await assert.rejects(h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),held);assert.deepEqual(h.clients[0].queries.map(q=>q.text),[BEGIN,GUARD]);assert.equal(h.clients[0].ended,1);assert.equal(await h.owner.shutdown(),true);
 }
});
test("exact BEGIN and ROLLBACK acknowledgement failures never release prior private bytes",async()=>{
 for(const phase of [BEGIN,"ROLLBACK"]){for(const broken of ["throw","wrongCommand","wrongRows","wrongFields"]){const h=harness(f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>{if(q.text!==phase)return query(q);c.queries.push(q);if(broken==="throw")throw Error("PRIVATE_CANARY");const a=ack(phase===BEGIN?"BEGIN":"ROLLBACK");if(broken==="wrongCommand")a.command="OTHER";if(broken==="wrongRows")a.rows=[["PRIVATE_CANARY"]];if(broken==="wrongFields")a.fields=[{name:"PRIVATE_CANARY",dataTypeID:25}];return a;};return c;});await assert.rejects(h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),held);assert.equal(h.clients[0].queries.at(-1).text,phase);assert.equal(h.clients[0].ended,1);assert.equal(await h.owner.shutdown(),true);}}
});
test("native onecell shape UTF8 scalar and actual perroute byte budgets are strict",async()=>{
 for(const route of ["lookup","capture"]){const maximum=route==="lookup"?4096:131072;for(const result of [cell(route,null),cell(route,Buffer.from("{}")),cell(route,"\ud800"),cell(route,"é".repeat(maximum/2+1)),cell("foreign","{}"),cell(route,"{}",3802),{...cell(route,"{}"),rows:[["{}","PRIVATE_CANARY"]]},{...cell(route,"{}"),fields:[{name:route,dataTypeID:25},{name:"extra",dataTypeID:25}]}]){
  const h=harness(f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>q.text===f.command.sql||q.text===APPENDED_CAPTURE_READ_SQL?(c.queries.push(q),result):query(q);return c;});await assert.rejects(route==="lookup"?h.t.readLookup(h.f.report,h.f.expected,h.f.f.observedAt,signal()):h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),held);assert.equal(h.clients[0].queries.at(-1).text,route==="lookup"?h.f.command.sql:APPENDED_CAPTURE_READ_SQL);assert.equal(await h.owner.shutdown(),true);
 }}
});
test("parent cancellation at every transaction phase stops later statements closes once and consumes late completion",async()=>{
 for(const phase of [BEGIN,GUARD,APPENDED_CAPTURE_READ_SQL,"ROLLBACK"]){const pending=deferred(),parent=new AbortController();let native;
 const h=harness(f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>{if(q.text!==phase)return query(q);c.queries.push(q);native=phase===BEGIN?ack("BEGIN"):phase==="ROLLBACK"?ack("ROLLBACK"):phase===GUARD?cell("admitted",true,16):cell("capture",f.f.rawReceiptJson);return pending.promise;};return c;});
 const reading=h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),parent.signal);await turn();parent.abort();await assert.rejects(reading,held);pending.resolve(native);await turn();assert.equal(h.clients[0].queries.at(-1).text,phase);assert.equal(h.clients[0].ended,1);assert.equal(getEventListeners(parent.signal,"abort").length,0);assert.equal(await h.owner.shutdown(),true);
 }
});
test("lookup and capture share the original two physical acquisition slots and never queue overflow",async()=>{
 const f=fixture(),pending=deferred(),clients=[];let acquisitions=0;const owner=createPostgresReadOwner(config(),"terrafracta.operator-audit",true,async()=>{acquisitions++;const c=new Client(f);clients.push(c);await pending.promise;return c;},()=>0),t=transport(owner),a=new AbortController(),b=new AbortController();
 const one=t.readLookup(f.report,f.expected,f.f.observedAt,a.signal),two=t.readCapture(prepareAppendedIssueCaptureRead(f.f.retainedIntentJson),b.signal);await turn();assert.equal(acquisitions,2);await assert.rejects(t.readCapture(prepareAppendedIssueCaptureRead(f.f.retainedIntentJson),signal()),held);assert.equal(acquisitions,2);a.abort();b.abort();await assert.rejects(one,held);await assert.rejects(two,held);
 await assert.rejects(t.readLookup(f.report,f.expected,f.f.observedAt,signal()),held);assert.equal(acquisitions,2);pending.resolve();await turn();assert.ok(clients.every(c=>c.connected===0&&c.ended===1));assert.equal(await owner.shutdown(),true);
});
test("unacknowledged sameclient close withholds data and physical slots across both operations",async()=>{
 const close=deferred(),h=harness(f=>{const c=new Client(f);c.end=async()=>{c.ended++;return close.promise;};return c;});
 await assert.rejects(h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),held);await assert.rejects(h.t.readLookup(h.f.report,h.f.expected,h.f.f.observedAt,signal()),held);assert.equal(h.clients.length,2);await assert.rejects(h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),held);assert.equal(h.clients.length,2);close.resolve();await turn();assert.equal(await h.owner.shutdown(),true);assert.ok(h.clients.every(c=>c.ended===1));
});
test("owner elapsed fences refuse late guard or rollback without changing the original reader budget",async()=>{
 for(const phase of [GUARD,"ROLLBACK"]){let now=0;const h=harness(f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>{const r=await query(q);if(q.text===phase)now=2500;return r;};return c;},()=>now);await assert.rejects(h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),held);assert.equal(h.clients[0].queries.at(-1).text,phase);assert.equal(await h.owner.shutdown(),true);}
 const h=harness(),c=new AbortController();c.abort();await assert.rejects(h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),c.signal),held);assert.equal(h.clients.length,0);assert.equal(await h.owner.shutdown(),true);
});

test("additional exact UTF8 capacity admits byte boundary independently from later content parsing",async()=>{
 for(const route of ["lookup","capture"]){const maximum=route==="lookup"?4096:131072,text="é".repeat(maximum/2);const h=harness(f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>q.text===f.command.sql||q.text===APPENDED_CAPTURE_READ_SQL?(c.queries.push(q),cell(route,text)):query(q);return c;});
 const bytes=await(route==="lookup"?h.t.readLookup(h.f.report,h.f.expected,h.f.f.observedAt,signal()):h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()));assert.equal(bytes.byteLength,maximum);assert.equal(Buffer.from(bytes).toString(),text);assert.equal(await h.owner.shutdown(),true);
 }
});
test("additional owner methods and full lookup operands are captured before reentrant owner admission",async()=>{
 const h=harness(),originalExpected={...h.f.expected};let runReads=0,userReads=0,shutdownReads=0,dispatches=0;
 const originalRun=(s,execute)=>{dispatches++;h.f.expected.preparationIntentJson="{}";h.f.expected.reportSha256="0".repeat(64);return h.owner.run(s,execute);};
 const own={};Object.defineProperties(own,{run:{enumerable:true,configurable:true,get(){runReads++;return originalRun;}},user:{enumerable:true,configurable:true,get(){userReads++;return "postgres";}},shutdown:{enumerable:true,configurable:true,get(){shutdownReads++;return h.owner.shutdown;}}});
 const t=transport(own);Object.defineProperty(own,"run",{value:()=>assert.fail("No redirected owner"),enumerable:true});Object.defineProperty(own,"user",{value:"terra_reviewer",enumerable:true});
 const bytes=await t.readLookup(h.f.report,h.f.expected,h.f.f.observedAt,signal());assert.equal(parseAppendedCaptureLookup(bytes,h.f.report,originalExpected,h.f.f.observedAt).matches.length,1);assert.equal(runReads,1);assert.equal(userReads,1);assert.equal(shutdownReads,1);assert.equal(dispatches,1);assert.equal(h.clients[0].queries[2].values[3],originalExpected.preparationIntentJson);assert.equal(await h.owner.shutdown(),true);
});
test("additional guard or data query exceptions close the shared client and disclose no private exception",async()=>{
 for(const phase of [GUARD,APPENDED_CAPTURE_READ_SQL]){const h=harness(f=>{const c=new Client(f),query=c.query.bind(c);c.query=async q=>{if(q.text!==phase)return query(q);c.queries.push(q);throw Error("PRIVATE_QUERY_CANARY");};return c;});await assert.rejects(h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),held);assert.equal(h.clients[0].queries.at(-1).text,phase);assert.equal(h.clients[0].ended,1);assert.equal(await h.owner.shutdown(),true);}
});
test("additional rejected sameclient close keeps physical capacity and shutdown reports undrained",async()=>{
 const h=harness(f=>{const c=new Client(f);c.end=async()=>{c.ended++;throw Error("PRIVATE_CLOSE_CANARY");};return c;});
 await assert.rejects(h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),held);await assert.rejects(h.t.readLookup(h.f.report,h.f.expected,h.f.f.observedAt,signal()),held);await assert.rejects(h.t.readCapture(prepareAppendedIssueCaptureRead(h.f.f.retainedIntentJson),signal()),held);assert.equal(h.clients.length,2);assert.ok(h.clients.every(c=>c.ended===1));assert.equal(await h.owner.shutdown(),false);
});
