import assert from 'node:assert/strict';import test from 'node:test';
import {prepareHtmlAppendedCaptureLookup as prepare,parseHtmlAppendedCaptureLookup as parse,HTML_APPENDED_CAPTURE_LOOKUP_SQL as SQL} from '../src/server/html-appended-capture-lookup.ts';
import {htmlCaptureFixture as fixture,hash} from './helpers/html_capture_transport_fixture.mjs';
const receive=f=>parse(Buffer.from(JSON.stringify(f.lookup)),f.bundle.candidateReportJson,f.expected,f.f.observedAt);
const refuse=fn=>assert.throws(fn,/^Error: html_appended_capture_lookup_unavailable$/);
test('HTML lookup binds exact bytea metadata and four full part hashes using eight values with no new SQL object',()=>{
 const f=fixture(),c=prepare(f.bundle.candidateReportJson,f.expected,f.f.observedAt),p=f.report.preparation,m=f.metadata;
 assert.equal(c.sql,SQL);assert.deepEqual(c.values,[p.operation_id,p.artifact_id,p.stored_at,f.report.intent_json,m.payload_sha256,m.selection_sha256,m.provenance_sha256,m.context_raw_sha256]);assert.deepEqual(c.scope,f.lookup.scope);
 assert.ok(SQL.includes("p.metadata=pg_catalog.convert_to($4::text,'UTF8')"));assert.match(SQL,/from tf_html_review.captures/);assert.doesNotMatch(SQL,/tf_detached|tf_appended|p.input|CREATE |INSERT |UPDATE |DELETE |GRANT /i);assert.match(SQL,/limit 2/);assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.values));
});
test('zero or one HTML historical match exposes only metadata and cannot supply the independent capture intent',()=>{
 const f=fixture(),r=receive(f);assert.equal(r.matches[0].captureId,f.native.capture_id);assert.equal(r.matches[0].intentSha256,hash(f.f.retainedIntentJson));assert.match(r.evidenceState,/independent_html_capture_intent_required/);assert.doesNotMatch(JSON.stringify(r),/intent_json|intentJson|payload|provenance|source|proposed_assertion/);
 f.lookup.matches=[];assert.deepEqual(receive(f).matches,[]);
});
test('HTML lookup independently readmits report and exact intent on every call without normalizing metadata',()=>{
 const f=fixture();for(const [raw,e,at] of [[f.bundle.candidateReportJson+' ',f.expected,f.f.observedAt],[f.bundle.candidateReportJson,{...f.expected,reportSha256:'0'.repeat(64)},f.f.observedAt],[f.bundle.candidateReportJson,{...f.expected,preparationIntentJson:f.report.intent_json+' '},f.f.observedAt],[f.bundle.candidateReportJson,f.expected,'0000-01-01T00:00:00.000000Z']])refuse(()=>prepare(raw,e,at));
});
test('unmatched preparation role and transaction substitution cannot be returned as an empty match',()=>{
 for(const change of [v=>v.preparation_matched=false,v=>v.principal='terra_reviewer',v=>v.session_principal='terra_operator',v=>v.transaction_isolation='read committed',v=>v.transaction_read_only=false]){const f=fixture();f.lookup.matches=[];change(f.lookup);refuse(()=>receive(f));}
});
test('all eight scope fields overflow rows foreign associations and exact native chronology hold complete lookup',()=>{
 const base=fixture();for(const k of Object.keys(base.lookup.scope)){const f=fixture();f.lookup.scope[k]=k.includes('sha256')?'0'.repeat(64):k.includes('stored_at')?'2026-10-18T02:00:19.000000Z':'00000000-0000-4000-8000-000000000999';refuse(()=>receive(f));}
 for(const change of [v=>v.matches.push(v.matches[0]),v=>v.matches[0].preparation_operation_id='00000000-0000-4000-8000-000000000999',v=>v.matches[0].stored_at='2026-10-18T02:00:20.000001Z',v=>v.observed_at='2026-10-18T02:00:21.000001Z',v=>v.observed_at='2026-10-16T02:00:12.000000Z']){const f=fixture();change(f.lookup);refuse(()=>receive(f));}
});
test('duplicate escaped keys BOM wrong byte brands and overflow cannot be hidden by JSON parsing',()=>{
 const f=fixture(),raw=JSON.stringify(f.lookup);for(const body of [raw.replace('"schema_version":1','"schema_version":false,"schema_version":1'),raw.replace('"principal":','"princi\\u0070al":"postgres","principal":')])refuse(()=>parse(Buffer.from(body),f.bundle.candidateReportJson,f.expected,f.f.observedAt));
 for(const body of [raw,Buffer.alloc(4097),Buffer.from([255]),Buffer.concat([Buffer.from([239,187,191]),Buffer.from(raw)])])refuse(()=>parse(body,f.bundle.candidateReportJson,f.expected,f.f.observedAt));
});
