import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';import {detachedPreparationChoices as parse,selectedDetachedPreparation as selected} from '../src/server/detached-preparation-choices.ts';
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-detached-preparation-history.json',import.meta.url),'utf8'));
const sha=s=>createHash('sha256').update(s).digest('hex');const reseal=(r,b)=>{const raw=canonical(r);return [raw,{...b.expectedChoices,reportSha256:sha(raw)}];};
test('real retained native inventory projects two metadata choices and both explicitly retained reports',()=>{
 const b=fixture(),r=parse(b.choicesJson,b.expectedChoices);assert.ok(r);assert.equal(r.candidates.length,2);assert.ok(r.artifactObservedAt<r.inventoryObservedAt);
 for(const report of b.reports){const result=selected(b.choicesJson,b.expectedChoices,report.operationId,report.reportJson,report.expected);assert.ok(result);assert.equal(result.candidate.operation_id,report.operationId);assert.equal(result.report.preparation.artifact_id,result.candidate.artifact_id);}
 assert.equal(selected(b.choicesJson,b.expectedChoices,undefined,b.reports[0].reportJson,b.reports[0].expected),null);
});
test('metadata is not a full report or independent retained intent and unknown or mismatched explicit selections hold',()=>{
 const b=fixture(),first=b.reports[0],second=b.reports[1];
 for(const [id,raw,expected] of [[undefined,first.reportJson,first.expected],['00000000-0000-4000-8000-000000000999',first.reportJson,first.expected],
   [first.operationId,second.reportJson,second.expected],[first.operationId,first.reportJson,{...first.expected,preparationIntentJson:'{}'}],[first.operationId,undefined,undefined]])
  assert.equal(selected(b.choicesJson,b.expectedChoices,id,raw,expected),null);
});
test('closed primitives, independent fingerprints, original canonical bytes and fifty row ceiling hold whole',()=>{
 const b=fixture();assert.equal(parse(b.choicesJson,{...b.expectedChoices,reportSha256:'f'.repeat(64)}),null);assert.equal(parse(b.choicesJson+' ',b.expectedChoices),null);
 assert.equal(parse(Buffer.from(b.choicesJson),b.expectedChoices),null);assert.equal(parse('x'.repeat(98305),b.expectedChoices),null);
 for(const mutate of [r=>r.review_state='qualified',r=>r.schema_version=true,r=>r.extra='PRIVATE_CANARY',r=>r.candidates[0].extra=true,
   r=>r.candidates.push(...Array(50).fill(r.candidates[0])),r=>r.lookup_scope_json='{}']){const r=JSON.parse(b.choicesJson);mutate(r);assert.equal(parse(...reseal(r,b)),null);}
});
test('duplicates ordering scope references and microsecond chronology are checked for metadata alone',()=>{
 const b=fixture();for(const mutate of [r=>r.candidates[1].operation_id=r.candidates[0].operation_id,r=>r.candidates[1].artifact_id=r.candidates[0].artifact_id,
   r=>r.candidates.reverse(),r=>r.candidates[0].prepared_at='2027-01-01T00:00:00.000000Z',r=>r.artifact_observed_at='2027-01-01T00:00:00.000000Z',
   r=>{const m=JSON.parse(r.candidates[0].metadata_intent_json);m.extraction_output_sha256='f'.repeat(64);r.candidates[0].metadata_intent_json=canonical(m);},
   r=>r.candidates[0].metadata_intent_json+=' ']){const r=JSON.parse(b.choicesJson);mutate(r);assert.equal(parse(...reseal(r,b)),null);}
});
test('metadata may be later than artifact observation but explicit full selection requires fresher originals',()=>{
 const b=fixture(),r=JSON.parse(b.choicesJson);r.artifact_observed_at=r.artifact_stored_at;const [raw,expected]=reseal(r,b);assert.ok(parse(raw,expected));
 assert.equal(selected(raw,expected,b.reports[0].operationId,b.reports[0].reportJson,b.reports[0].expected),null);
});
test('empty metadata has no selection while exact fifty is a bounded list without a default',()=>{
 const b=fixture(),r=JSON.parse(b.choicesJson),original=r.candidates[0],stored=r.candidates[1].stored_at;
 r.candidates=[];assert.equal(parse(...reseal(r,b)).candidates.length,0);
 for(let i=0;i<50;i++){const op=`00000000-0000-4000-8000-${String(2000+i).padStart(12,'0')}`,artifact=`00000000-0000-4000-8000-${String(3000+i).padStart(12,'0')}`,m=JSON.parse(original.metadata_intent_json);m.operation_id=op;r.candidates.push({...original,operation_id:op,artifact_id:artifact,stored_at:stored,metadata_intent_json:canonical(m)});}
 const [raw,e]=reseal(r,b);assert.equal(parse(raw,e).candidates.length,50);assert.equal(selected(raw,e,undefined,undefined,undefined),null);
});
