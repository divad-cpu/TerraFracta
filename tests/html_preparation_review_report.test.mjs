import assert from 'node:assert/strict';import test from 'node:test';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import {htmlPreparationReviewVectors} from './helpers/html_preparation_review_vectors.mjs';
import {htmlPreparationReviewReport as admit,htmlPreparationHistory as choices} from '../src/server/html-preparation-review-report.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
const fixture=htmlPreparationReviewVectors(),rows=fixture.reports,sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
function modified(row,mutate){const value=JSON.parse(row.reportJson);mutate(value);const raw=canonical(value);return{raw,expected:{...row.expected,reportSha256:sha(raw)}};}
test('two actual Python full-receipt projections preserve exact historical parts and explicit heads',()=>{
 assert.deepEqual(JSON.parse(readFileSync(new URL('../fixtures/fictional-html-preparation-history.json',import.meta.url),'utf8')),fixture);
 assert.equal(choices(canonical(fixture)).length,2);
 for(const row of rows){const r=admit(row.reportJson,row.expected);assert.ok(r);assert.ok(Object.isFrozen(r));assert.equal(r.preparation.operation_id,row.operationId);assert.equal(r.metadata.provenance_sha256,sha(JSON.parse(row.reportJson).provenance_json));
 assert.equal(r.selection.basePublicationId===null,row.label.startsWith('Empty'));assert.equal(r.snapshot.claims.length,1);assert.equal(r.extraction.proposal.review_state,'unverified');}
});
test('wrong digest, intent, duplicate keys and normalization withhold the whole report',()=>{
 const row=rows[0];for(const [raw,e] of [[row.reportJson,{...row.expected,reportSha256:'f'.repeat(64)}],[row.reportJson,{...row.expected,preparationIntentJson:'{}'}],
 [row.reportJson+' ',{...row.expected,reportSha256:sha(row.reportJson+' ')}],[row.reportJson.replace('"schema_version":1','"schema_version":1,"schema_version":1'),row.expected]])assert.equal(admit(raw,e),null);
});
test('coherently rehashed parts still cannot contradict independent source, context or historical time',()=>{
 const row=rows[0];for(const mutate of [r=>r.preparation.stored_at='2020-01-01T00:00:00.000000Z',r=>r.preparation.historical_artifact_observed_at=r.observed_at,
 r=>r.extraction.artifact.artifact_id='00000000-0000-4000-8000-000000000999',r=>r.extraction.proposal.proposed_assertion='A contradictory invented assertion.',r=>r.limits.publication_authorized=true]){
 const changed=modified(row,mutate);assert.equal(admit(changed.raw,changed.expected),null);}
 const value=JSON.parse(row.reportJson),proof=JSON.parse(value.provenance_json);proof.independent_context.support.assignment_state='verified';
 value.provenance_json=canonical(proof);const m=JSON.parse(value.intent_json);m.provenance_sha256=sha(value.provenance_json);value.intent_json=canonical(m);value.preparation.metadata_sha256=sha(value.intent_json);
 const raw=canonical(value);assert.equal(admit(raw,{reportSha256:sha(raw),preparationIntentJson:value.intent_json}),null);
});
test('hostile expected objects, oversized reports and missing full report are private refusals',()=>{
 const row=rows[0];let gets=0;const getter={preparationIntentJson:row.expected.preparationIntentJson};Object.defineProperty(getter,'reportSha256',{enumerable:true,get(){gets++;throw Error('PRIVATE');}});
 const symbol={...row.expected,[Symbol('PRIVATE')]:true},hidden={...row.expected};Object.defineProperty(hidden,'extra',{value:'PRIVATE'});
 for(const e of[getter,symbol,hidden,null])assert.equal(admit(row.reportJson,e),null);assert.equal(gets,0);
 assert.equal(admit('x'.repeat(524289),row.expected),null);assert.equal(admit({},row.expected),null);
});
test('choice inventory has exact bounded unique scope and does not admit or auto-select report bodies',()=>{
 const broken=structuredClone(fixture);broken.reports[1].reportJson='PRIVATE_CANARY';assert.equal(choices(canonical(broken)).length,2);
 assert.equal(admit(broken.reports[1].reportJson,broken.reports[1].expected),null);assert.ok(admit(broken.reports[0].reportJson,broken.reports[0].expected));
 for(const mutate of[f=>f.reports.push(f.reports[0]),f=>f.reports[1].operationId=f.reports[0].operationId,f=>{const m=JSON.parse(f.reports[1].expected.preparationIntentJson);m.extraction_artifact_id='00000000-0000-4000-8000-000000000999';f.reports[1].expected.preparationIntentJson=canonical(m);},f=>f.extra=true]){
 const f=structuredClone(fixture);mutate(f);assert.equal(choices(canonical(f)),null);}
 assert.equal(choices(fixture),null);
});
function resealedContext(mutate){
 const r=JSON.parse(rows[0].reportJson),m=JSON.parse(r.intent_json),p=JSON.parse(r.payload_json),proof=JSON.parse(r.provenance_json);
 mutate(proof.independent_context,p);proof.context_sha256=sha(canonical(proof.independent_context));proof.supplied_context_sha256=proof.context_sha256;m.context_raw_sha256=proof.context_sha256;
 r.payload_json=canonical(p);m.payload_sha256=sha(r.payload_json);proof.payload_sha256=m.payload_sha256;r.provenance_json=canonical(proof);m.provenance_sha256=sha(r.provenance_json);
 r.intent_json=canonical(m);r.preparation.metadata_sha256=sha(r.intent_json);const raw=canonical(r);return{raw,expected:{reportSha256:sha(raw),preparationIntentJson:r.intent_json}};
}
test('resealed independent context obeys Python text and real calendar grammar',()=>{
 const cases=[(c,p)=>{c.held.jurisdiction_id='fictional\0region';c.issue.jurisdiction_id=c.held.jurisdiction_id;},
 (c,p)=>{c.content.title='\u0085Invalid boundary title';p.snapshot.title=c.content.title;},
 (c,p)=>{c.content.summary='Invented\0summary';p.snapshot.summary=c.content.summary;},
 (c,p)=>{c.content.period_label='\u001cInvalid period';p.snapshot.claims[0].periodLabel=c.content.period_label;},
 (c,p)=>{c.content.publisher='Invalid\u000bpublisher';p.snapshot.claims[0].evidence[0].publisher=c.content.publisher;},
 (c,p)=>{c.content.source_title='Invalid title\u0085';p.snapshot.claims[0].evidence[0].title=c.content.source_title;},
 (c,p)=>{c.content.last_evidence_review_on='0000-01-01';p.snapshot.lastEvidenceReviewOn=c.content.last_evidence_review_on;},
 (c,p)=>{c.content.source_published_on='0000-01-01';p.snapshot.claims[0].evidence[0].sourcePublishedOn=c.content.source_published_on;}];
 for(const change of cases){const r=resealedContext(change);assert.equal(admit(r.raw,r.expected),null);}
 for(const title of['An interior\u0085separator','Title with\nline and\ttab','A'.repeat(239)+'😀']){const r=resealedContext((c,p)=>{c.content.title=title;p.snapshot.title=title;});assert.ok(admit(r.raw,r.expected));}
});
