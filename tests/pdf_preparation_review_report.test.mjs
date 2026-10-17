import assert from 'node:assert/strict';
import test from 'node:test';
import {pdfPreparationReviewReport} from '../src/server/pdf-preparation-review-report.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {pdfPreparationReviewFixtures,sha,instantAfter,resignReport,resignIntent} from './helpers/pdf_preparation_review_fixture.mjs';
const rows=pdfPreparationReviewFixtures(),fixture=()=>structuredClone(rows[0]);
const read=f=>pdfPreparationReviewReport(f.raw,f.expected);

test('three actual underlying PDF preparations retain four exact historical parts within invented storage envelopes',()=>{
 for(const f of rows){const r=read(f);assert.ok(r,f.name);assert.equal(r.report.preparation.artifact_id,f.expected.preparationArtifactId);assert.equal(r.report.observed_at,f.expected.observedAt);
  assert.deepEqual(r.bundle,{payloadJson:f.report.parts.payload_json,selectionJson:f.report.parts.selection_json,provenanceJson:f.report.parts.provenance_json,contextJson:f.report.parts.context_json});
  assert.equal(r.candidate.proof.evidence_state,'unverified_not_captured_no_durable_association');assert.equal(r.evidenceState,'supplied_historical_pdf_preparation_not_current_qualification_or_capture');assert.equal('sql'in r,false);assert.equal('capturePreparation'in r,false);}
 assert.equal(read(rows[0]).candidate.selection.basePublicationId,null);assert.notEqual(read(rows[1]).candidate.selection.basePublicationId,null);assert.equal([...read(rows[2]).candidate.payload.snapshot.claims[0].assertion].length,600);
});
test('all five independent expectations are mandatory and exact',()=>{
 for(const key of Object.keys(rows[0].expected)){let f=fixture();delete f.expected[key];assert.equal(read(f),null,key);
  f=fixture();f.expected[key]=key.endsWith('At')?instantAfter(f.expected[key],1):key==='preparationIntentJson'?f.expected[key]+' ':key==='preparationArtifactId'?'90000000-0000-4000-8000-000000000099':'f'.repeat(64);assert.equal(read(f),null,key);}
});
test('outer native joins cannot be repaired by resigning only the supplied report',()=>{
 for(const key of ['operation_id','result_operation_id','prepared_at','intent_sha256']){const f=fixture();f.report.preparation[key]=key==='prepared_at'?instantAfter(f.report.preparation[key],-1):key.endsWith('sha256')?'f'.repeat(64):'90000000-0000-4000-8000-000000000099';resignReport(f);assert.equal(read(f),null,key);}
 const f=fixture();f.report.intent_json+=' ';resignReport(f);assert.equal(read(f),null);
});
test('native chronology holds independently of the report hash and observed selector',()=>{
 for(const mode of ['stored-before-prepared','observed-before-stored','different-prepared','invalid-date']){const f=fixture();
  if(mode==='stored-before-prepared')f.report.preparation.stored_at=f.expected.preparationStoredAt=instantAfter(f.report.preparation.prepared_at,-1);
  if(mode==='observed-before-stored')f.report.observed_at=f.expected.observedAt=instantAfter(f.report.preparation.stored_at,-1);
  if(mode==='different-prepared'){const m=JSON.parse(f.expected.preparationIntentJson);m.prepared_at=instantAfter(m.prepared_at,-1);f.report.preparation.prepared_at=m.prepared_at;resignIntent(f,m);}
  if(mode==='invalid-date')f.report.preparation.stored_at=f.expected.preparationStoredAt='2026-02-30T00:00:00.000000Z';
  resignReport(f);assert.equal(read(f),null,mode);}
 const f=fixture();f.report.observed_at=f.expected.observedAt=instantAfter(f.report.observed_at,100);resignReport(f);assert.ok(read(f));
});
test('all four part bytes must agree with the independently expected canonical intent',()=>{
 for(const key of Object.keys(rows[0].report.parts)){const f=fixture();f.report.parts[key]+=' ';resignReport(f);assert.equal(read(f),null,key);}
 for(const key of ['payload_sha256','selection_sha256','provenance_sha256','context_raw_sha256','extraction_request_sha256','extraction_output_sha256','extraction_artifact_id']){const f=fixture(),m=JSON.parse(f.expected.preparationIntentJson);m[key]=key.endsWith('_id')?'90000000-0000-4000-8000-000000000099':'f'.repeat(64);resignIntent(f,m);assert.equal(read(f),null,key);}
});
test('matching outer identities never admit rewritten candidate support or publication qualifiers',()=>{
 for(const mutate of [p=>p.limits.publication_authorized=true,p=>p.independent_context.support.assignment_state='approved',p=>p.current.selected_pages[0].page_number=0]){
  const f=fixture(),p=JSON.parse(f.report.parts.provenance_json);mutate(p);f.report.parts.provenance_json=canonical(p);const m=JSON.parse(f.expected.preparationIntentJson);m.provenance_sha256=sha(f.report.parts.provenance_json);resignIntent(f,m);assert.equal(read(f),null);}
 for(const key of Object.keys(rows[0].report.limits)){const f=fixture();f.report.limits[key]=true;resignReport(f);assert.equal(read(f),null,key);}
});
test('closed report, metadata and nested namespaces refuse extras, omissions and wrong primitive types',()=>{
 for(const target of ['report','preparation','parts','limits'])for(const mode of ['extra','missing','bool']){const f=fixture(),value=target==='report'?f.report:f.report[target];if(mode==='extra')value.PRIVATE='PRIVATE';if(mode==='missing')delete value[Object.keys(value)[0]];if(mode==='bool')value[Object.keys(value)[0]]=true;resignReport(f);assert.equal(read(f),null,target+mode);}
 const f=fixture(),m=JSON.parse(f.expected.preparationIntentJson);m.PRIVATE='PRIVATE';resignIntent(f,m);assert.equal(read(f),null);
});
test('expectation snapshot refuses accessors, symbols, foreign prototypes and nonenumerable keys without invoking getters',()=>{
 for(const mode of ['getter','symbol','prototype','hidden','extra']){const f=fixture();let calls=0;
  if(mode==='getter')Object.defineProperty(f.expected,'reportSha256',{enumerable:true,get(){calls++;throw Error('PRIVATE');}});
  if(mode==='symbol')f.expected[Symbol('PRIVATE')]='PRIVATE';if(mode==='prototype')Object.setPrototypeOf(f.expected,{PRIVATE:'PRIVATE'});
  if(mode==='hidden')Object.defineProperty(f.expected,'PRIVATE',{value:'PRIVATE'});if(mode==='extra')f.expected.PRIVATE='PRIVATE';
  assert.equal(read(f),null,mode);assert.equal(calls,0);}
 const f=fixture();f.expected=Object.assign(Object.create(null),f.expected);assert.ok(read(f));
});
test('canonical framing refuses duplicates, aliases, whitespace, malformed text and private oversize',()=>{
 for(const mutation of [s=>' '+s,s=>s+'\n',s=>s.replace('"schema_version":1','"schema_version":1,"schema_version":1'),s=>s.replace('"schema_version":1','"schema_\\u0076ersion":1'),s=>s.slice(0,-1),()=> 'PRIVATE'.repeat(40000),()=> '\ud800']){const f=fixture();f.raw=mutation(f.raw);f.expected.reportSha256=sha(f.raw);assert.equal(read(f),null);}
 const f=fixture(),m=JSON.parse(f.expected.preparationIntentJson);f.expected.preparationIntentJson=' '+canonical(m);f.report.intent_json=f.expected.preparationIntentJson;f.report.preparation.intent_sha256=sha(f.report.intent_json);resignReport(f);assert.equal(read(f),null);
});
test('each native component budget refuses before exposing partial report state',()=>{
 for(const [key,max] of [['payload_json',16384],['selection_json',2048],['provenance_json',65536],['context_json',32768]]){const f=fixture();f.report.parts[key]='PRIVATE'+ 'x'.repeat(max);resignReport(f);assert.equal(read(f),null,key);}
 const f=fixture();f.expected.preparationIntentJson='x'.repeat(4097);assert.equal(read(f),null);
});
test('accepted output is deeply frozen and supplied receipt and packet hashes remain references only',()=>{
 const f=fixture();f.report.preparation.receipt_sha256='c'.repeat(64);f.report.preparation.packet_sha256='d'.repeat(64);resignReport(f);const r=read(f);assert.ok(r);
 for(const v of [r,r.report,r.report.parts,r.report.preparation,r.report.limits,r.candidate,r.candidate.proof.independent_context.issue.head,r.candidate.payload.snapshot.claims,r.expected,r.bundle,r.identity])assert.ok(Object.isFrozen(v));
 assert.equal(r.report.limits.full_preparation_receipt_included,false);assert.equal(r.report.limits.source_authenticated,false);
 f.expected.preparationArtifactId='foreign';f.report.parts.payload_json='PRIVATE';assert.notEqual(r.expected.preparationArtifactId,'foreign');assert.notEqual(r.report.parts.payload_json,'PRIVATE');
});
