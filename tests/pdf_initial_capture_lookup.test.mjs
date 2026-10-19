import assert from 'node:assert/strict';
import test from 'node:test';
import {preparePdfInitialCandidateCaptureLookup as prepare,parsePdfInitialCandidateCaptureLookup as parse,PDF_INITIAL_CANDIDATE_CAPTURE_LOOKUP_SQL as SQL} from '../src/server/pdf-initial-candidate-capture-lookup.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {initialPdfLookupFixture as fixture,hash} from './helpers/pdf_initial_selection_fixture.mjs';
const receive=f=>parse(Buffer.from(JSON.stringify(f.lookup)),f.reportJson,f.reportExpected,f.f.observedAt);
const refuse=fn=>assert.throws(fn,/^Error: pdf_initial_candidate_capture_lookup_unavailable$/);
test('fixed PDF lookup binds immutable preparation intent portable packet and complete native receipt without new SQL objects',()=>{
 const f=fixture(),c=prepare(f.reportJson,f.reportExpected,f.f.observedAt),p=f.report.preparation;
 assert.equal(c.sql,SQL);assert.deepEqual(c.values,[p.operation_id,p.artifact_id,p.stored_at,f.report.intent_json,p.packet_sha256,p.receipt_sha256]);assert.deepEqual(c.scope,f.lookup.scope);
 assert.match(SQL,/p.intent=pg_catalog.convert_to\(\$4::text,'UTF8'\)/);assert.match(SQL,/sha256\(p.packet\)/);assert.match(SQL,/preparation_receipt\(p.operation_id\)::text/);assert.match(SQL,/from tf_pdf_initial_candidate.captures/);assert.match(SQL,/limit 2/);assert.doesNotMatch(SQL,/tf_html|tf_appended|CREATE |INSERT |UPDATE |DELETE |GRANT /i);assert.ok(Object.isFrozen(c)&&Object.isFrozen(c.values)&&Object.isFrozen(c.scope));
});
test('zero or one metadata match cannot supply the original capture intent or independent five',()=>{
 const f=fixture(),r=receive(f);assert.equal(r.matches[0].captureId,f.native.capture_id);assert.equal(r.matches[0].intentSha256,hash(f.f.intentJson));assert.equal(r.preparation.packetSha256,f.report.preparation.packet_sha256);assert.equal(r.preparation.receiptSha256,f.report.preparation.receipt_sha256);assert.match(r.evidenceState,/independent_pdf_capture_intent_and_five_selectors_required/);assert.doesNotMatch(JSON.stringify(r),/intent_json|intentJson|payload|provenance|source|assertion/);assert.ok(Object.isFrozen(r.matches[0]));f.lookup.matches=[];assert.deepEqual(receive(f).matches,[]);
});
test('all five independent preparation selectors are mandatory on every public call',()=>{
 const f=fixture();for(const key of Object.keys(f.reportExpected)){const e={...f.reportExpected};delete e[key];refuse(()=>prepare(f.reportJson,e,f.f.observedAt));refuse(()=>parse(Buffer.from(JSON.stringify(f.lookup)),f.reportJson,e,f.f.observedAt));}
 for(const e of [{...f.reportExpected,reportSha256:'0'.repeat(64)},{...f.reportExpected,preparationIntentJson:f.report.intent_json+' '},{...f.reportExpected,preparationStoredAt:f.f.observedAt},{...f.reportExpected,preparationArtifactId:'00000000-0000-4000-8000-000000000999'},{...f.reportExpected,observedAt:f.f.observedAt}])refuse(()=>prepare(f.reportJson,e,f.f.observedAt));
 for(const at of ['0000-01-01T00:00:00.000000Z','2026-02-30T00:00:00.000000Z','2000-01-01T00:00:00.000000Z'])refuse(()=>prepare(f.reportJson,f.reportExpected,at));
 let calls=0;const expected={...f.reportExpected};Object.defineProperty(expected,'reportSha256',{enumerable:true,get(){calls++;throw Error('PRIVATE');}});refuse(()=>prepare(f.reportJson,expected,f.f.observedAt));assert.equal(calls,0);
});
test('a malformed or modified complete preparation remains refused even when a caller reseals its report hash',()=>{
 const f=fixture();for(const change of [r=>r.parts.payload_json='{}',r=>r.parts.selection_json='{}',r=>r.parts.provenance_json='{}',r=>r.parts.context_json='{}',r=>r.preparation.operation_id='00000000-0000-4000-8000-000000000999',r=>r.limits.source_authenticated=true]){
  const r=structuredClone(f.report);change(r);const raw=canonical(r);refuse(()=>prepare(raw,{...f.reportExpected,reportSha256:hash(raw)},f.f.observedAt));
 }
});
test('unmatched preparation principal and transaction substitution are never an empty historical match',()=>{
 for(const change of [v=>v.preparation_matched=false,v=>v.principal='terra_reviewer',v=>v.session_principal='terra_operator',v=>v.transaction_isolation='read committed',v=>v.transaction_read_only=false]){const f=fixture();f.lookup.matches=[];change(f.lookup);refuse(()=>receive(f));}
});
test('every scope identity exact microsecond chronology ambiguity and foreign association remains material',()=>{
 const base=fixture();for(const k of Object.keys(base.lookup.scope)){const f=fixture();f.lookup.scope[k]=k.includes('sha256')?'0'.repeat(64):k.includes('stored_at')?f.f.observedAt:'00000000-0000-4000-8000-000000000999';refuse(()=>receive(f));}
 for(const change of [v=>v.matches.push(v.matches[0]),v=>v.matches[0].preparation_operation_id='00000000-0000-4000-8000-000000000999',v=>v.matches[0].stored_at='2099-01-01T00:00:00.000000Z',v=>v.matches[0].stored_at='2000-01-01T00:00:00.000000Z',v=>v.observed_at='2099-01-01T00:00:00.000000Z',v=>v.observed_at='2000-01-01T00:00:00.000000Z',v=>v.matches[0].capture_id=v.matches[0].capture_id.slice(0,14)+'1'+v.matches[0].capture_id.slice(15)]){const f=fixture();change(f.lookup);refuse(()=>receive(f));}
});
test('duplicate escaped alias numeric version BOM wrong byte brands and overflow refuse full lookup',()=>{
 const f=fixture(),raw=JSON.stringify(f.lookup);for(const body of [raw.replace('"schema_version":1','"schema_version":false,"schema_version":1'),raw.replace('"schema_version":1','"schema_version":1e0'),raw.replace('"principal":','"princi\\u0070al":')]){assert.notEqual(body,raw);refuse(()=>parse(Buffer.from(body),f.reportJson,f.reportExpected,f.f.observedAt));}
 for(const body of [raw,Buffer.alloc(4097),Buffer.from([255]),Buffer.concat([Buffer.from([239,187,191]),Buffer.from(raw)])])refuse(()=>parse(body,f.reportJson,f.reportExpected,f.f.observedAt));
});

test('known-base appended preparation cannot be mistaken for initial null-head lookup',async()=>{
 const {readFileSync}=await import('node:fs');
 const f=JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-appended-capture.json',import.meta.url),'utf8'));
 const n=JSON.parse(Buffer.from(f.receiptBase64,'base64')),raw=Buffer.from(n.parts_base64[0],'base64').toString('utf8'),report=JSON.parse(raw);
 const e={reportSha256:hash(raw),preparationIntentJson:f.expected.preparationIntentJson,preparationArtifactId:f.expected.preparationArtifactId,preparationStoredAt:f.expected.preparationStoredAt,observedAt:report.observed_at};
 refuse(()=>prepare(raw,e,f.observedAt));
});
