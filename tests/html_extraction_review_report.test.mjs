import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { htmlExtractionReviewReport as parse } from '../src/server/html-extraction-review-report.ts';
import { htmlExtractionReviewVectors } from './helpers/html_extraction_review_vectors.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-html-extraction-review.json',import.meta.url),'utf8'));
const vectors=htmlExtractionReviewVectors();

test('fixture is the actual pure Python projection of synthetic full receipts and exact changed locator',()=>{
  assert.deepEqual(fixture(),vectors.base);const r=parse(fixture());assert.ok(r);
  assert.equal(r.proposal.locator,'article:one');assert.equal(r.review_state,'unverified');
  assert.equal(r.artifact.request_sha256,r.inspection.request.request_sha256);
  assert.equal(r.artifact.request_bytes,r.inspection.request.body_bytes);
  assert.notEqual(r.originals.current.operation_id,r.originals.previous.operation_id);
  assert.equal(r.context.server_authentication,'not_established');assert.equal(r.context.publication,'not_authorized');
});

test('real Python scalar/codepoint/model whitespace vectors cross the new closed consumer',()=>{
  for(const [name,r]of Object.entries(vectors))assert.ok(parse(r),name);
  assert.equal([...vectors.unicode.proposal.proposed_assertion].length,600);
  assert.equal([...vectors.unicode.proposal.source_date_text].length,80);
  assert.ok(parse(vectors.bom).proposal.proposed_assertion.startsWith('\ufeff'));
  assert.ok(parse(vectors.whitespace).proposal.proposed_assertion.includes('\u0085'));
});

test('unknown fields and any trust or body escalation withhold every private part',()=>{
  for(const mutate of[r=>r.extra='PRIVATE_CANARY',r=>r.proposal.extra='PRIVATE_CANARY',r=>r.originals.current.extra='PRIVATE_CANARY',
    r=>r.artifact.raw_html='<script>PRIVATE_CANARY</script>',r=>r.review_state='approved',r=>r.proposal.review_state='approved',
    r=>r.context.publication='authorized',r=>r.context.server_authentication='verified',r=>r.context.rights='approved',r=>r.limits.review_decision_included=true]){
    const r=fixture();mutate(r);assert.equal(parse(r),null);
  }
});

test('result, request and proposal cannot cross-join another scope or unchanged locator',()=>{
  for(const mutate of[r=>r.artifact.request_sha256='f'.repeat(64),r=>r.artifact.request_bytes++,r=>r.proposal.locator='context:one',
    r=>r.proposal.source_version_id=r.inspection.previous.source_version_id,r=>r.proposal.source_sha256=r.inspection.previous.content_sha256,
    r=>r.proposal.language_code='no',r=>r.originals.previous.operation_id=r.originals.current.operation_id,
    r=>r.originals.previous.artifact_id=r.originals.current.artifact_id,r=>r.inspection.previous=null,r=>r.inspection.request=null]){
    const r=fixture();mutate(r);assert.equal(parse(r),null);
  }
});

test('UUID, UTC6 microsecond chronology and separate observations remain exact',()=>{
  for(const mutate of[r=>r.artifact.artifact_id='not-a-uuid',r=>r.originals.current.operation_id='A'.repeat(36),
    r=>r.artifact.stored_at=r.originals.current.stored_at,
    r=>r.prepared_at='2026-10-16T00:00:00.000000Z',r=>r.originals.previous.stored_at='2026-10-16T05:00:00.000000Z',
    r=>r.inspection.observed_at='2026-10-16T02:00:02.000001Z',r=>r.observed_at='0000-01-01T00:00:00.000000Z',r=>r.prepared_at=r.prepared_at.replace('Z','+00:00')]){
    const r=fixture();mutate(r);assert.equal(parse(r),null);
  }
  const r=fixture();r.artifact.stored_at=r.prepared_at;assert.ok(parse(r),'equal preparation/storage UTC is allowed');
});

test('byte counts, scalar bounds, dense own JSON and privacy limit are enforced',()=>{
  for(const mutate of[r=>r.artifact.request_bytes=true,r=>r.artifact.output_bytes=8193,r=>r.proposal.proposed_assertion='😀'.repeat(601),
    r=>r.proposal.proposed_assertion='\ud800'.repeat(12),r=>r.proposal.proposed_assertion='\u0085An invented statement',r=>r.proposal.source_date_text='a'.repeat(81),
    r=>Object.defineProperty(r,'length',{enumerable:true,get(){assert.fail('getter must not run');}}),r=>r[Symbol('hidden')]='PRIVATE_CANARY']){
    const r=fixture();mutate(r);assert.equal(parse(r),null);
  }
  const cyclic=fixture();cyclic.self=cyclic;assert.equal(parse(cyclic),null);
  const sparse=fixture();delete sparse.inspection.current.passages[0];assert.equal(parse(sparse),null);
  const r=fixture();r.proposal.proposed_assertion='x'.repeat(393217);assert.equal(parse(r),null);
});

test('opaque receipt/output identities are syntax and joins, never omitted-byte authentication',()=>{
  const r=fixture();r.artifact.output_sha256='e'.repeat(64);r.artifact.receipt_sha256='d'.repeat(64);r.originals.current.metadata_sha256='c'.repeat(64);
  const admitted=parse(r);assert.ok(admitted);assert.equal(admitted.context.factual_support,'not_assessed');
  assert.equal(admitted.context.server_authentication,'not_established');assert.equal(admitted.limits.output_body_included,false);
});
