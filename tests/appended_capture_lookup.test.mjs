import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {prepareAppendedCaptureLookup as prepare,parseAppendedCaptureLookup as parse,APPENDED_CAPTURE_LOOKUP_SQL} from "../src/server/appended-capture-lookup.ts";
const report=()=>readFileSync(new URL("../fixtures/fictional-detached-preparation.json",import.meta.url),"utf8");
const expected=()=>JSON.parse(readFileSync(new URL("../fixtures/fictional-detached-preparation-expected.json",import.meta.url),"utf8"));
const sha=s=>createHash("sha256").update(s,"utf8").digest("hex"),AT="2026-10-15T00:02:00.000000Z",NATIVE="2026-10-15T00:01:30.000000Z",STORED="2026-10-15T00:01:20.000000Z";
const refuse=fn=>assert.throws(fn,/^Error: appended_capture_lookup_unavailable$/);
function fixture(){const raw=report(),e=expected(),prepared=prepare(raw,e,AT);return {raw,e,prepared,value:{schema_version:1,kind:"invented_appended_capture_lookup",scope:{...prepared.scope},principal:"postgres",session_principal:"postgres",transaction_isolation:"repeatable read",transaction_read_only:true,preparation_matched:true,observed_at:NATIVE,matches:[{capture_id:"00000000-0000-4000-8000-000000000998",preparation_operation_id:prepared.scope.preparation_operation_id,stored_at:STORED,intent_sha256:"f".repeat(64)}]}};}
const receive=f=>parse(Buffer.from(JSON.stringify(f.value)),f.raw,f.e,AT);
test("complete independent preparation creates exactly8 immutable parameters and fixed owner read-only RR confirmation query",t=>{
 t.mock.method(globalThis,"fetch",()=>assert.fail("No request"));const f=fixture(),p=JSON.parse(f.raw),m=JSON.parse(p.intent_json),c=f.prepared;
 assert.equal(c.sql,APPENDED_CAPTURE_LOOKUP_SQL);assert.equal(c.values.length,8);assert.deepEqual(c.values,[p.preparation.operation_id,p.preparation.artifact_id,p.preparation.stored_at,p.intent_json,m.payload_sha256,m.selection_sha256,m.provenance_sha256,m.context_raw_sha256]);assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.values)&&Object.isFrozen(c.scope));
 for(const fragment of ["p.operation_id=$1::uuid","p.artifact_id=$2::uuid","p.stored_at=$3::timestamptz","p.input=($4::text)::jsonb","pg_catalog.sha256(p.payload_raw)","pg_catalog.sha256(p.selection_raw)","pg_catalog.sha256(p.provenance_raw)","pg_catalog.sha256(p.context_raw)","current_user=session_user","session_user='postgres'","transaction_isolation","repeatable read","transaction_read_only","limit 2","preparation_matched"])assert.ok(c.sql.includes(fragment),fragment);
 assert.doesNotMatch(c.sql,/\b(insert|update|delete|create|grant|set role)\b/i);assert.ok(!c.sql.includes(p.parts.payload_json));assert.ok(!c.sql.includes(p.intent_json));
});
test("actual checked report cannot be replaced by cached pointers foreign fingerprints changed parts or invented intent",()=>{
 const r=report(),e=expected();for(const [raw,exp]of [[{},e],[Buffer.from(r),e],[r,{...e,reportSha256:"f".repeat(64)}],[r,{...e,preparationIntentJson:"{}"}],[r+" ",e]])refuse(()=>prepare(raw,exp,AT));
 for(const name of ["payload_json","selection_json","provenance_json","context_json"]){const p=JSON.parse(r);p.parts[name]+=" ";const changed=JSON.stringify(p);refuse(()=>prepare(changed,{...e,reportSha256:sha(changed)},AT));}
 const f=fixture();refuse(()=>parse(Buffer.from(JSON.stringify(f.value)),{},f.e,AT));refuse(()=>prepare(r,e,"2026-10-15T00:00:00.000000Z"));refuse(()=>prepare(r,e,"2026-10-15T00:02:00Z"));
});
test("confirmed empty and single historical association are distinct metadata-only results without inferred selection",()=>{
 const f=fixture(),r=receive(f);assert.equal(r.matches.length,1);assert.equal(r.matches[0].captureId,f.value.matches[0].capture_id);assert.equal(r.matches[0].intentSha256,"f".repeat(64));assert.equal(r.observedAt,NATIVE);assert.match(r.evidenceState,/metadata.*independent_capture_intent_required/);
 const output=JSON.stringify(r);assert.doesNotMatch(output,/intent_json|intentJson|raw|payload|provenance|source|proposed_assertion|preparation_matched/);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.preparation)&&Object.isFrozen(r.matches)&&Object.isFrozen(r.matches[0]));
 f.value.matches=[];const empty=receive(f);assert.deepEqual(empty.matches,[]);assert.equal(empty.preparation.operationId,r.preparation.operationId);
});
test("unconfirmed preparation role substitution and wrong native transaction cannot masquerade as legitimate empty",()=>{
 for(const mutate of [v=>v.preparation_matched=false,v=>v.preparation_matched=0,v=>v.principal="tf_feed_lab_owner",v=>v.session_principal="tf_feed_lab_owner",v=>v.transaction_isolation="read committed",v=>v.transaction_read_only=false,v=>v.transaction_read_only="on"]){const f=fixture();f.value.matches=[];mutate(f.value);refuse(()=>receive(f));}
});
test("all8 independent scope fields reject foreign native bindings",()=>{
 for(const key of Object.keys(fixture().value.scope)){const f=fixture();f.value.scope[key]=key.includes("sha256")?"0".repeat(64):key.includes("stored_at")?AT:"00000000-0000-4000-8000-000000000999";refuse(()=>receive(f));}
});
test("duplicate or foreign association keys invalid chronology and extra private fields hold the complete result",()=>{
 for(const mutate of [v=>v.matches.push(v.matches[0]),v=>v.matches.push({...v.matches[0],capture_id:"00000000-0000-4000-8000-000000000997"}),v=>v.matches[0].preparation_operation_id="00000000-0000-4000-8000-000000000999",v=>v.matches[0].intent_sha256="bad",v=>v.matches[0].stored_at="2026-10-15T00:00:00.000000Z",v=>v.matches[0].stored_at="2026-10-15T00:01:30.000001Z",v=>v.matches[0].intent_raw="PRIVATE_CANARY",v=>v.extra="PRIVATE_CANARY"]){const f=fixture();mutate(f.value);refuse(()=>receive(f));}
});
test("native observation must follow full report and contain association through exact microsecond upper bounds",()=>{
 const f=fixture();f.value.observed_at=STORED;assert.equal(receive(f).matches.length,1);f.value.observed_at="2026-10-15T00:01:19.999999Z";refuse(()=>receive(f));
 f.value.matches=[];f.value.observed_at=JSON.parse(f.raw).observed_at;assert.deepEqual(receive(f).matches,[]);f.value.observed_at="2026-10-15T00:00:00.000000Z";refuse(()=>receive(f));f.value.observed_at="2026-10-15T00:02:00.000001Z";refuse(()=>receive(f));
});
test("duplicate and escaped alias native keys cannot disappear during JSON parsing",()=>{
 const f=fixture(),raw=JSON.stringify(f.value);for(const mutate of [s=>s.replace('"schema_version":1','"schema_version":false,"schema_version":1'),s=>s.replace('"principal":','"princi\\u0070al":"postgres","principal":'),s=>s.replace('"capture_id":','"capture_id":"00000000-0000-4000-8000-000000000999","capture_id":'),s=>s.replace('"preparation_operation_id":','"preparation_operation_id":"00000000-0000-4000-8000-000000000999","preparation_operation_id":')]){const changed=mutate(raw);assert.notEqual(changed,raw);refuse(()=>parse(Buffer.from(changed),f.raw,f.e,AT));}
});
test("native byte capacity brands UTF8 and BOM are measured without consulting shadowed metadata",()=>{
 const f=fixture(),valid=Buffer.from(JSON.stringify(f.value));for(const raw of [null,{},valid.toString(),Buffer.from([255]),Buffer.alloc(4097),Buffer.concat([Buffer.from([239,187,191]),valid]),new Proxy(valid,{})])refuse(()=>parse(raw,f.raw,f.e,AT));
 Object.defineProperty(valid,"byteLength",{get(){throw Error("PRIVATE_CANARY");}});assert.equal(parse(valid,f.raw,f.e,AT).matches.length,1);
});

test("parameter4 stays text at its first occurrence before JSONB comparison and independent original intent hashing",()=>{
 // This lexical regression preserves the native separately reproduced type
 // inference contract; it does not itself execute PostgreSQL's parser.
 const f=fixture(),sql=f.prepared.sql;
 assert.equal(sql.match(/\$4::([a-z]+)/)[1],"text");
 assert.ok(sql.includes("p.input=($4::text)::jsonb"));
 assert.ok(sql.includes("pg_catalog.sha256(pg_catalog.convert_to($4::text,'UTF8'))"));
 assert.equal(f.prepared.scope.preparation_intent_sha256,sha(f.prepared.values[3]));
 assert.equal(f.prepared.values[3],f.e.preparationIntentJson);
});
