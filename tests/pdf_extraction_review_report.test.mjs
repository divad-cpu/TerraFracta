import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pdfExtractionReviewReport as parse } from '../src/server/pdf-extraction-review-report.ts';
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-extraction-review.json',import.meta.url),'utf8'));
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const resign=r=>{
 const c=r.current;
 r.request.selected_payload_sha256=sha(JSON.stringify({schema_version:1,kind:'private_changed_passages',source_key:c.source_key,item_key:c.item_key,
  source_version_id:c.source_version_id,content_sha256:c.content_sha256,mapping_sha256:c.mapping_sha256,language_code:c.language_code,
  passages:r.selected_passages.map(({text,text_sha256,locators})=>({text,text_sha256,locators}))}));
 return r;
};

test('actual invented producer fixture joins selected text, physical page, exact payload and unverified proposal',()=>{
 const r=parse(fixture());assert.ok(r);assert.equal(r.review_state,'unverified');assert.equal(r.proposal.review_state,'unverified');
 assert.deepEqual(r.selected_passages[0].page_numbers,[1]);assert.equal(r.current.selected_pages.length,2);
 assert.equal(r.selected_passages.length,1);assert.equal(r.selected_passages[0].earlier[0].text,'Earlier invented selected text.');
 assert.notEqual(r.current.content_sha256,r.previous.content_sha256);assert.equal(r.context.storage,'not_observed');
 assert.equal(r.context.publication,'not_authorized');
});

test('closed fields and qualification/body escalations refuse atomically',()=>{
 for(const mutate of [r=>r.extra='PRIVATE',r=>r.current.extra='PRIVATE',r=>r.proposal.extra='PRIVATE',r=>r.limits.extra='PRIVATE',
  r=>r.artifact.output_base64='PRIVATE',r=>r.review_state='approved',r=>r.proposal.review_state='approved',r=>r.context.storage='authenticated',
  r=>r.context.rights='approved',r=>r.context.publication='authorized',r=>r.limits.rendered_visibility_verified=true,
  r=>r.limits.whole_page_selection=false,r=>r.limits.unchanged_text_included=true]){
  const r=fixture();mutate(r);assert.equal(parse(r),null);
 }
});

test('proposal source, language, unchanged and unselected locators cannot cross join',()=>{
 for(const mutate of [r=>r.proposal.source_sha256=r.previous.content_sha256,r=>r.proposal.source_version_id=r.previous.source_version_id,
  r=>r.proposal.language_code='no',r=>r.proposal.locator='section-two',r=>r.proposal.locator='unselected',
  r=>r.previous.source_url='https://example.org/other.pdf',r=>r.previous.mapping_sha256='f'.repeat(64),r=>r.previous.item_key='other',
  r=>r.previous.source_version_id=r.current.source_version_id,r=>r.previous.content_sha256=r.current.content_sha256]){
  const r=fixture();mutate(r);assert.equal(parse(r),null);
 }
});

test('exact page ordering, whole-page hashes and earlier wording are checked against the independent selected map',()=>{
 for(const mutate of [r=>r.selected_passages[0].page_numbers[0]=2,r=>r.selected_passages[0].page_numbers.push(2),
  r=>r.selected_passages[0].text='PRIVATE_ALTERED_TEXT',r=>r.selected_passages[0].earlier[0].text='PRIVATE_ALTERED_PRIOR',
  r=>r.selected_passages[0].earlier[0].page_number=2,r=>r.selected_passages[0].earlier[0]=null,
  r=>r.current.selected_pages.reverse(),r=>r.previous.selected_pages[0].page_number=2,
  r=>r.current.selected_pages[1].locator='section-one',r=>r.current.selected_pages[1].page_number=1,
  r=>r.current.selected_pages[1].page_text_sha256='f'.repeat(64),r=>r.selected_passages.push(structuredClone(r.selected_passages[0]))]){
  const r=fixture();mutate(r);assert.equal(parse(resign(r)),null);
 }
});

test('explicit first observation requires all selected pages and null earlier wording',()=>{
 const r=fixture();r.previous=null;r.current.selected_pages.pop();r.selected_passages[0].earlier=[null];
 assert.ok(parse(resign(r)));
 const missing=fixture();missing.previous=null;missing.selected_passages[0].earlier=[null];assert.equal(parse(resign(missing)),null);
 const falsePrior=structuredClone(r);falsePrior.selected_passages[0].earlier=[fixture().selected_passages[0].earlier[0]];assert.equal(parse(resign(falsePrior)),null);
});

test('all selected changed occurrences remain, and selected payload framing cannot be replaced by an opaque digest',()=>{
 const r=fixture();r.request.selected_payload_sha256='f'.repeat(64);assert.equal(parse(r),null);
 const partial=fixture();partial.current.selected_pages[1].page_text_sha256='e'.repeat(64);assert.equal(parse(resign(partial)),null);
 const wrong=fixture();wrong.selected_passages[0].locators[0]='foreign';assert.equal(parse(resign(wrong)),null);
});

test('UTC microseconds, original/preparation/reopening order and receipt bounds are exact',()=>{
 for(const mutate of [r=>r.recorded_observed_at=r.reopened_at,r=>r.prepared_at='2026-10-16T00:00:00.000000Z',
  r=>r.reopened_at=r.recorded_observed_at,r=>r.current.retrieved_at=r.reopened_at,
  r=>r.previous.retrieved_at=r.recorded_observed_at,r=>r.recorded_observed_at=r.recorded_observed_at.replace('Z','+00:00'),
  r=>r.reopened_at='0000-01-01T00:00:00.000000Z',r=>r.artifact.output_bytes=true,r=>r.artifact.output_bytes=8193,
  r=>r.artifact.packet_bytes=2097153,r=>r.request.request_bytes=131073,r=>r.request.maximum_output_tokens=0]){
  const r=fixture();mutate(r);assert.equal(parse(r),null);
 }
 const equal=fixture();equal.prepared_at=equal.recorded_observed_at;equal.reopened_at=equal.prepared_at;assert.ok(parse(equal));
});

test('proposal Unicode follows the shared Python codepoint and strip rules',()=>{
 const r=fixture();r.proposal.proposed_assertion='😀'.repeat(600);r.proposal.source_date_text='𐐀'.repeat(80);assert.ok(parse(r));
 r.proposal.proposed_assertion='😀'.repeat(601);assert.equal(parse(r),null);
 for(const text of ['\u0085An invented assertion', 'An invented assertion\u0085', 'PRIVATE\ud800CANARY', 'Assertion\u000bhere']){
  const r=fixture();r.proposal.proposed_assertion=text;assert.equal(parse(r),null);
 }
 for(const text of ['\ufeffAn invented assertion', 'An\u0085invented assertion', 'An\t\ninvented assertion']){
  const r=fixture();r.proposal.proposed_assertion=text;assert.ok(parse(r));
 }
});

test('data-property capture refuses accessor, prototype, symbol, cyclic, sparse and array extras without invoking hooks',()=>{
 let calls=0;
 for(const mutate of [r=>Object.defineProperty(r,'current',{enumerable:true,get(){calls++;throw Error('PRIVATE');}}),
  r=>Object.defineProperty(r.selected_passages[0],'text',{enumerable:true,get(){calls++;throw Error('PRIVATE');}}),
  r=>r[Symbol('private')]='PRIVATE',r=>r.selected_passages.extra='PRIVATE',r=>delete r.selected_passages[0],
  r=>r.self=r,r=>Object.setPrototypeOf(r,{private:'PRIVATE'}),r=>r.proposal.toJSON=()=>{calls++;throw Error('PRIVATE');}]){
  const r=fixture();mutate(r);assert.equal(parse(r),null);
 }
 assert.equal(calls,0);
});

test('omitted packet/output/request digests remain supplied references rather than authentication',()=>{
 const r=fixture();r.artifact.packet_sha256='a'.repeat(64);r.artifact.output_sha256='b'.repeat(64);
 r.request.request_sha256='c'.repeat(64);r.current.inspection_sha256='d'.repeat(64);r.current.derivation_sha256='e'.repeat(64);
 const admitted=parse(r);assert.ok(admitted);assert.equal(admitted.context.factual_support,'not_assessed');
});
