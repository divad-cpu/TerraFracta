import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {pdfHeldProposalVectors} from './helpers/pdf_held_proposal_vectors.mjs';
import {pdfHeldPreparation} from '../src/server/pdf-held-preparation.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
const rows=pdfHeldProposalVectors(),sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const bundle=row=>Object.fromEntries(['payloadJson','selectionJson','provenanceJson','contextJson'].map(k=>[k,row[k]]));
const expected=b=>Object.fromEntries(Object.entries(b).map(([k,v])=>[k.replace('Json','Sha256'),sha(v)]));
const mutate=(fn)=>{const b=bundle(rows[0]),p=JSON.parse(b.provenanceJson),s=JSON.parse(b.selectionJson),payload=JSON.parse(b.payloadJson);fn(p,s,payload,b);
 b.payloadJson=canonical(payload);b.selectionJson=canonical(s);p.payload_sha256=sha(b.payloadJson);p.selection_sha256=sha(b.selectionJson);p.context_sha256=sha(canonical(p.independent_context));b.provenanceJson=canonical(p);return b;};

test('actual three producer bundles retain all four exact parts, head and astral assertion',()=>{
 for(const row of rows){const b=bundle(row),r=pdfHeldPreparation(b,expected(b));assert.ok(r,row.name);assert.deepEqual(r.parts,b);assert.equal(r.evidenceState,'invented_pdf_unverified_detached_not_captured');assert.equal(r.proof.limits.offset_space,'derived_page_utf8');assert.ok(Object.isFrozen(r.proof.independent_context.issue.head));assert.ok(Object.isFrozen(r.payload.snapshot.claims));assert.equal('capturePreparation'in r,false);assert.equal('sql'in r,false);}
 assert.equal(pdfHeldPreparation(bundle(rows[0]),expected(bundle(rows[0]))).selection.basePublicationId,null);
 const r=pdfHeldPreparation(bundle(rows[2]),expected(bundle(rows[2])));assert.equal(r.payload.snapshot.claims[0].assertion,'🙂'.repeat(600));
});
test('every independent part digest is mandatory and exact; no digest is adopted from the bundle',()=>{
 for(const key of Object.keys(expected(bundle(rows[0])))){const b=bundle(rows[0]),e=expected(b);e[key]='f'.repeat(64);assert.equal(pdfHeldPreparation(b,e),null);delete e[key];assert.equal(pdfHeldPreparation(b,e),null);}
 for(const key of Object.keys(bundle(rows[0]))){const b=bundle(rows[0]),e=expected(b);b[key]+=' ';assert.equal(pdfHeldPreparation(b,e),null);}
});
test('closed carriers refuse hooks, prototypes, symbols, missing parts and private oversize strings',()=>{
 for(const channel of ['bundle','expected'])for(const kind of ['getter','prototype','symbol','missing']){let b=bundle(rows[0]),e=expected(b),target=channel==='bundle'?b:e;let calls=0;
  const key=Object.keys(target)[0];if(kind==='getter')Object.defineProperty(target,key,{enumerable:true,get(){calls++;throw Error('PRIVATE');}});
  if(kind==='prototype')Object.setPrototypeOf(target,{private:'PRIVATE'});if(kind==='symbol')target[Symbol('PRIVATE')]='PRIVATE';if(kind==='missing')delete target[key];
  assert.equal(pdfHeldPreparation(b,e),null);assert.equal(calls,0);
 }
 for(const [key,max]of [['payloadJson',16384],['selectionJson',2048],['provenanceJson',65536],['contextJson',32768]]){const b=bundle(rows[0]);b[key]='x'.repeat(max+1);assert.equal(pdfHeldPreparation(b,expected(b)),null);}
});
test('context, selection, issue, held source and proposed support contradictions refuse even with matching outer hashes',()=>{
 for(const fn of [p=>p.kind='detached_private_extraction_proposal',p=>p.limits.offset_space='original_utf8',p=>p.limits.publication_authorized=true,
 p=>p.independent_context.held.disposition='approved',p=>p.independent_context.support.assignment_state='approved',p=>p.independent_context.support.assertion='A different invented assertion.',
 p=>p.independent_context.held.locator='foreign',p=>p.independent_context.issue.jurisdiction_id='foreign',p=>p.independent_context.translation.status='not_required',
 p=>p.independent_context.artifact.request_sha256='f'.repeat(64),(p,s)=>s.issueId='70000000-0000-4000-8000-000000000099',
 (p,s,payload)=>payload.snapshot.claims[0].evidence[0].sourceVersionId='70000000-0000-4000-8000-000000000099',
 p=>p.current.selected_pages[0].page_number=0,p=>p.current.selected_pages.push(p.current.selected_pages[0]),p=>p.previous.mapping_sha256='f'.repeat(64)]){
 const b=mutate(fn);assert.equal(pdfHeldPreparation(b,expected(b)),null,fn.toString());}
});
test('chronology and complete explicit head are checked without inferring missing history',()=>{
 for(const fn of [p=>p.artifact_stored_at='9999-01-01T00:00:00.000000Z',p=>p.independent_context.held.decided_at=p.artifact_prepared_at,
 p=>p.independent_context.issue.observed_at=p.artifact_prepared_at,p=>p.independent_context.content.last_evidence_review_on='9999-01-01',
 p=>p.independent_context.content.source_published_on='9999-01-01',p=>p.independent_context.issue.head.content_sha256='f'.repeat(64),
 p=>delete p.independent_context.issue.head,p=>p.previous=undefined]){const b=mutate(fn);assert.equal(pdfHeldPreparation(b,expected(b)),null,fn.toString());}
});
test('canonical proof and selection refuse duplicate/escaped key aliases and normalisation',()=>{
 for(const key of ['selectionJson','provenanceJson','payloadJson']){const b=bundle(rows[0]);b[key]=' '+b[key];assert.equal(pdfHeldPreparation(b,expected(b)),null);}
 const b=bundle(rows[0]);b.provenanceJson=b.provenanceJson.replace('"schema_version":1','"schema_version":1,"schema_version":1');assert.equal(pdfHeldPreparation(b,expected(b)),null);
});

test('first observation is explicit and a selected proposal locator must change from its supplied earlier page',()=>{
 let b=mutate(p=>p.previous=null);assert.ok(pdfHeldPreparation(b,expected(b)));
 b=mutate(p=>{const loc=p.independent_context.support.locator;const now=p.current.selected_pages.find(v=>v.locator===loc);p.previous.selected_pages.find(v=>v.locator===loc).page_text_sha256=now.page_text_sha256;});assert.equal(pdfHeldPreparation(b,expected(b)),null);
});

test('proposal assertion has the identical ten to six hundred scalar producer bound',()=>{
 for(const [value,valid]of [['Short',false],['x'.repeat(9),false],['x'.repeat(10),true],['🙂'.repeat(600),true],['🙂'.repeat(601),false]]){
 const b=mutate((p,s,payload)=>{p.independent_context.support.assertion=value;payload.snapshot.claims[0].assertion=value;});assert.equal(pdfHeldPreparation(b,expected(b))!==null,valid);
 }
});
