import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {prepareInitialCandidateLookup as prepare,parseInitialCandidateLookup as parse,INITIAL_CANDIDATE_LOOKUP_SQL as SQL} from "../src/server/initial-candidate-lookup.ts";
import {detachedPreparationReport} from "../src/server/detached-preparation-report.ts";
const AT="2026-10-16T11:16:21.000000Z",NATIVE="2026-10-16T11:16:20.000000Z",sha=s=>createHash("sha256").update(s).digest("hex"),held=fn=>assert.throws(fn,/^Error: initial_candidate_lookup_unavailable$/);
function fixture(){const f=JSON.parse(readFileSync(new URL("../fixtures/fictional-initial-candidate-capture.json",import.meta.url))),receipt=JSON.parse(f.rawReceiptJson),raw=Buffer.from(receipt.report_base64,"base64").toString(),e={...f.preparationExpected},command=prepare(raw,e,AT),value={schema_version:1,kind:"invented_initial_candidate_lookup",scope:{...command.scope},principal:"postgres",session_principal:"postgres",transaction_isolation:"repeatable read",transaction_read_only:true,preparation_matched:true,observed_at:NATIVE,matches:[{capture_id:f.id,preparation_operation_id:receipt.preparation_operation_id,stored_at:receipt.stored_at,intent_sha256:sha(f.retainedIntentJson)}]};return {f,raw,e,command,value};}
const receive=f=>parse(Buffer.from(JSON.stringify(f.value)),f.raw,f.e,AT);
test("initial metadata reuses eight exact original preparation operands and never queries appended association",t=>{
 t.mock.method(globalThis,"fetch",()=>assert.fail("No request"));const f=fixture(),r=JSON.parse(f.raw),m=JSON.parse(r.intent_json);
 assert.equal(f.command.sql,SQL);assert.deepEqual(f.command.values,[r.preparation.operation_id,r.preparation.artifact_id,r.preparation.stored_at,r.intent_json,m.payload_sha256,m.selection_sha256,m.provenance_sha256,m.context_raw_sha256]);
 assert.match(SQL,/from tf_initial_candidate\.captures c join preparation p/);assert.doesNotMatch(SQL,/tf_appended_review|\b(insert|update|delete|create|grant)\b/i);
 assert.equal(SQL.match(/\$4::([a-z]+)/)[1],"text");assert.ok(SQL.includes("p.input=($4::text)::jsonb")&&SQL.includes("sha256(pg_catalog.convert_to($4::text,'UTF8'))"));
 assert.ok(Object.isFrozen(f.command)&&Object.isFrozen(f.command.values)&&Object.isFrozen(f.command.scope));
});
test("known-base full preparation cannot enter the initial branch even with its correct independent expectation",()=>{
 const v=JSON.parse(readFileSync(new URL("../fixtures/fictional-recorded-capture-history.json",import.meta.url))),raw=v.preparationReportJson,e=v.preparationExpected;assert.notEqual(JSON.parse(JSON.parse(raw).parts.selection_json).basePublicationId,null);assert.notEqual(detachedPreparationReport(raw,e),null);held(()=>prepare(raw,e,AT));
});
test("one metadata candidate or genuine confirmed zero returns no full intent source body or implicit selection",()=>{
 const f=fixture(),r=receive(f);assert.equal(r.matches[0].captureId,f.f.id);assert.equal(r.matches[0].intentSha256,sha(f.f.retainedIntentJson));assert.match(r.evidenceState,/metadata_only_independent_capture_intent_required/);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.matches[0]));
 assert.doesNotMatch(JSON.stringify(r),/intentJson|intent_json|report|payload|provenance|source|selectedCapture/);
 f.value.matches=[];assert.deepEqual(receive(f).matches,[]);for(const mutate of [v=>v.preparation_matched=false,v=>v.principal="terra_reviewer",v=>v.session_principal="terra_reviewer",v=>v.transaction_isolation="read committed",v=>v.transaction_read_only=false]){const g=fixture();g.value.matches=[];mutate(g.value);held(()=>receive(g));}
});
test("all independently retained preparation scope fields and the distinct native kind are mandatory",()=>{
 for(const key of Object.keys(fixture().value.scope)){const f=fixture();f.value.scope[key]=key.includes("sha256")?"0".repeat(64):key.includes("stored_at")?AT:"00000000-0000-4000-8000-000000000997";held(()=>receive(f));}
 const f=fixture();f.value.kind="invented_appended_capture_lookup";held(()=>receive(f));f.value.kind="invented_initial_candidate_lookup";f.e.reportSha256="0".repeat(64);held(()=>receive(f));
});
test("second match foreign preparation and even one private extra field withhold the complete result",()=>{
 for(const mutate of [v=>v.matches.push({...v.matches[0]}),v=>v.matches[0].preparation_operation_id="00000000-0000-4000-8000-000000000997",v=>v.matches[0].intent_sha256="bad",v=>v.matches[0].report="PRIVATE_CANARY",v=>v.report="PRIVATE_CANARY"]){const f=fixture();mutate(f.value);held(()=>receive(f));}
});
test("metadata preserves SQL microseconds between original preparation association and independent after-read UTC",()=>{
 const f=fixture(),report=JSON.parse(f.raw);f.value.observed_at=AT;assert.equal(receive(f).observedAt,AT);f.value.observed_at="2026-10-16T11:16:21.000001Z";held(()=>receive(f));
 f.value.observed_at=NATIVE;f.value.matches[0].stored_at="2026-10-16T11:16:20.000001Z";held(()=>receive(f));f.value.matches=[];f.value.observed_at=report.observed_at;assert.deepEqual(receive(f).matches,[]);f.value.observed_at="2026-10-16T00:00:00.000000Z";held(()=>receive(f));
});
test("duplicate and escaped native key spellings cannot supply admitted initial metadata",()=>{
 const f=fixture(),raw=JSON.stringify(f.value);for(const changed of [raw.replace('"kind":','"kind":"invented_appended_capture_lookup","kind":'),raw.replace('"principal":','"princi\\u0070al":'),raw.replace('"capture_id":','"capture_id":"00000000-0000-4000-8000-000000000997","capture_id":')]){assert.notEqual(changed,raw);held(()=>parse(Buffer.from(changed),f.raw,f.e,AT));}
});
test("metadata byte input stays bounded native UTF8 and does not consult shadow byte length",()=>{
 const f=fixture(),valid=Buffer.from(JSON.stringify(f.value));for(const b of [valid.toString(),Buffer.alloc(4097),Buffer.from([255]),Buffer.concat([Buffer.from([239,187,191]),valid]),new Proxy(valid,{})])held(()=>parse(b,f.raw,f.e,AT));Object.defineProperty(valid,"byteLength",{get(){throw Error("PRIVATE_CANARY");}});assert.equal(parse(valid,f.raw,f.e,AT).matches.length,1);
});
