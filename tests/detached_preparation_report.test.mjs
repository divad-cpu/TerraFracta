import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {detachedPreparationReport as parse} from '../src/server/detached-preparation-report.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
const raw=()=>readFileSync(new URL('../fixtures/fictional-detached-preparation.json',import.meta.url),'utf8');
const expected=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-detached-preparation-expected.json',import.meta.url),'utf8'));
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const receive=(r,e=expected())=>{const body=canonical(r);return parse(body,{...e,reportSha256:sha(body)});};
test('actual full Python report admits exact original strings with independent intent and fresh/historical observations',()=>{
 const r=parse(raw(),expected());assert.ok(r);const original=JSON.parse(raw());assert.deepEqual(r.parts,original.parts);
 assert.notEqual(r.parts.context_json,canonical(JSON.parse(r.parts.context_json)));assert.equal(r.metadata.operation_id,original.preparation.operation_id);
 assert.equal(r.extraction.selected_passages[0].earlier[0].text,'Original exact invented passage.');assert.equal(r.snapshot.claims[0].assertion,r.extraction.proposal.proposed_assertion);
 assert.ok(r.preparation.stored_at<r.extraction.observed_at);assert.match(r.evidenceState,/not_current_qualification_or_held_capture/);
 assert.equal(JSON.stringify(original),raw());assert.equal(sha(raw()),expected().reportSha256);
});
test('independent whole fingerprint and retained intent refuse altered or self selected preparation',()=>{
 const e=expected();assert.equal(parse(raw(),{...e,reportSha256:'f'.repeat(64)}),null);assert.equal(parse(raw(),{...e,preparationIntentJson:'{}'}),null);
 assert.equal(parse(raw()+' ',e),null);assert.equal(parse(Buffer.from(raw()),e),null);
 const r=JSON.parse(raw());r.preparation.operation_id='00000000-0000-4000-8000-000000000999';assert.equal(receive(r),null);
});
test('each of four raw parts is byte bound and context spelling cannot be silently canonicalized',()=>{
 for(const key of ['payload_json','selection_json','provenance_json','context_json']){const r=JSON.parse(raw());r.parts[key]+=' ';assert.equal(receive(r),null);}
 const r=JSON.parse(raw());r.parts.context_json=canonical(JSON.parse(r.parts.context_json));assert.equal(receive(r),null);
});
test('nested extraction and proposed snapshot correspondence refuses whole even with new report fingerprint',()=>{
 for(const mutate of [r=>r.extraction_report.proposal.proposed_assertion='A different unverified candidate assertion.',r=>r.extraction_report.proposal.proposed_claim_type='funding',
  r=>r.extraction_report.proposal.source_date_text='Contradicting raw date',r=>r.extraction_report.artifact.output_sha256='f'.repeat(64),
  r=>r.extraction_report.request.request_sha256='f'.repeat(64),r=>r.extraction_report.current.artifact_id='00000000-0000-4000-8000-000000000999']){
  const r=JSON.parse(raw());mutate(r);assert.equal(receive(r),null);
 }
});
test('historical preparation chronology and exact microsecond boundaries remain distinct',()=>{
 for(const mutate of [r=>r.preparation.historical_artifact_observed_at=r.preparation.stored_at,r=>r.preparation.stored_at='2026-10-15T00:00:49.999999Z',
   r=>r.preparation.stored_at='2026-10-15T00:01:10.000001Z',r=>r.observed_at='2026-10-15T00:01:09.999999Z',r=>r.preparation.prepared_at='0000-01-01T00:00:00.000000Z']){
  const r=JSON.parse(raw());mutate(r);assert.equal(receive(r),null);
 }
});
test('closed report expected primitives and capacity prevent partial private admission',()=>{
 for(const mutate of [r=>r.review_state='approved',r=>r.scope='operational',r=>r.evidence_state='held_capture',r=>r.schema_version=true,r=>r.extra='PRIVATE_CANARY',
   r=>delete r.extraction_report,r=>r.parts.context_json='\ud800',r=>r.parts.provenance_json='x'.repeat(65537)]){
  const r=JSON.parse(raw());mutate(r);assert.equal(receive(r),null);
 }
 assert.equal(parse('x'.repeat(262145),expected()),null);assert.equal(parse(raw(),{...expected(),extra:true}),null);
});
