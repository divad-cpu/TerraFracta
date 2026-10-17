import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {admitAppendedIssueReview as admit} from '../src/server/appended-issue-review.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {decodeProposalCapture} from '../src/server/proposal-capture.ts';
const vectors=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-issue-review.json',import.meta.url),'utf8')).cases;
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const refuse=(b,e)=>assert.throws(()=>admit(b,e),/^Error: appended_issue_review_unavailable$/);
const sealProof=(b,e,mutate)=>{const p=JSON.parse(b.compositionJson);mutate(p);b.compositionJson=canonical(p);e.compositionSha256=sha(b.compositionJson);};
test('four real Python compositions admit through existing full schemas and exact unexecuted six-value command',()=>{
 for(const {name,bundle:b,expected:e,expectedBaselineClaimCount:n} of vectors()){
  const r=admit(b,e),base=JSON.parse(b.canonicalBaselineJson),candidate=JSON.parse(JSON.parse(b.candidateReportJson).parts.payload_json),p=JSON.parse(b.proposalJson);
  assert.equal(r.baselineClaimCount,n,name);assert.equal(r.appendedClaimCount,1);assert.deepEqual(p.snapshot.claims.slice(0,-1),base.snapshot.claims);
  assert.deepEqual(p.snapshot.claims.at(-1),candidate.snapshot.claims[0]);assert.equal(r.capturePreparation.values[5],b.proposalJson);
  assert.equal(r.capturePreparation.values[4],base.id);assert.equal(r.capturePreparation.values.length,6);assert.deepEqual(decodeProposalCapture(b.proposalJson,sha(b.proposalJson)),p);
  assert.deepEqual(r.bundle,b);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.bundle)&&Object.isFrozen(r.capturePreparation.values));
  assert.equal(r.snapshotIntent,'append_only_whole_issue_technical_review_not_publication');assert.match(r.evidenceState,/not_captured_or_publication_qualified/);
 }
});
test('baseline UUID spelling and source occurrence multiplicity survive while manifests contain exact unique identities',()=>{
 const cases=vectors(),upper=JSON.parse(admit(cases[1].bundle,cases[1].expected).capturePreparation.values[5]);
 assert.equal(upper.snapshot.claims[0].id,'ABCDEF00-0000-4000-8000-000000000950');assert.equal(upper.dependencyManifest.sourceVersionIds[0],'ABCDEF00-0000-4000-8000-000000000960');
 const same=JSON.parse(admit(cases[2].bundle,cases[2].expected).capturePreparation.values[5]);assert.deepEqual(same.snapshot.claims[0].evidence,same.snapshot.claims.at(-1).evidence);
 assert.equal(same.dependencyManifest.sourceVersionIds.length,2);assert.equal(new Set(same.dependencyManifest.sourceVersionIds).size,2);
 const max=JSON.parse(admit(cases[3].bundle,cases[3].expected).capturePreparation.values[5]);assert.equal(max.snapshot.claims.length,30);assert.ok(Buffer.byteLength(cases[3].bundle.proposalJson)<16384);
});
test('independently expected report intent raw head context and composition hashes cannot be substituted',()=>{
 for(const key of ['compositionSha256','candidateReportSha256','baselineSha256','contextSha256']){const {bundle:b,expected:e}=vectors()[0];e[key]='f'.repeat(64);refuse(b,e);}
 const {bundle:b,expected:e}=vectors()[0];refuse(b,{...e,preparationIntentJson:'{}'});refuse(b,{...e,observedAt:'2026-10-15T00:01:11.999999Z'});
});
test('every exact raw part refuses changed representation rather than silently normalizing it',()=>{
 for(const key of Object.keys(vectors()[0].bundle)){const {bundle:b,expected:e}=vectors()[0];b[key]+=' ';refuse(b,e);}
 const {bundle:b,expected:e}=vectors()[0];assert.notEqual(b.baselineJson,b.canonicalBaselineJson);b.baselineJson=b.canonicalBaselineJson;refuse(b,e);
});
test('coherently rehashed proposed payload cannot remove reorder rewrite or duplicate preserved baseline content',()=>{
 for(const mutate of [p=>p.snapshot.claims.shift(),p=>p.snapshot.claims.reverse(),p=>p.snapshot.claims[0].assertion='A replacement baseline assertion.',p=>p.snapshot.claims.push(p.snapshot.claims[0]),
  p=>p.dependencyManifest.sourceVersionIds.reverse(),p=>p.kind='accepted',p=>p.translation.status='not_required',p=>p.conflictCoverage='recorded_partial']){
  const {bundle:b,expected:e}=vectors()[0],p=JSON.parse(b.proposalJson);mutate(p);b.proposalJson=canonical(p);sealProof(b,e,proof=>proof.proposal_sha256=sha(b.proposalJson));refuse(b,e);
 }
});
test('composition proof cannot promote intent state support historical originals or preserved claim identities',()=>{
 for(const mutate of [p=>p.snapshot_intent='single_claim_technical_review_not_issue_replacement',p=>p.evidence_state='qualified',p=>p.candidate_full_receipt_sha256='f'.repeat(64),
  p=>p.candidate_part_sha256.reverse(),p=>p.preserved_claim_sha256.reverse(),p=>p.appended_claim_sha256='f'.repeat(64),p=>p.source_manifest_sha256='f'.repeat(64),p=>p.canonical_baseline_sha256='f'.repeat(64)]){
  const {bundle:b,expected:e}=vectors()[0];sealProof(b,e,mutate);refuse(b,e);
 }
});
test('explicit whole-page metadata and conservative language conflict review requirements remain separate from single claim',()=>{
 for(const mutate of [c=>delete c.page.summary,c=>c.review.translation.status='not_required',c=>c.review.translation.display_language='no',c=>c.review.conflict_coverage='recorded_partial',
  c=>c.page.last_evidence_review_on='2026-10-16',c=>c.page.title=' padded title',c=>c.baseline.head_changed_at='2026-10-15T00:00:00.000000Z']){
  const {bundle:b,expected:e}=vectors()[0],c=JSON.parse(b.contextJson);mutate(c);b.contextJson=canonical(c);e.contextSha256=sha(b.contextJson);
  sealProof(b,e,p=>{p.independent_context=c;p.context_raw_sha256=e.contextSha256;p.context_sha256=sha(canonical(c));});refuse(b,e);
 }
 const {bundle:b,expected:e}=vectors()[0],p=JSON.parse(admit(b,e).capturePreparation.values[5]),candidate=JSON.parse(JSON.parse(b.candidateReportJson).parts.payload_json);
 assert.notEqual(p.snapshot.title,candidate.snapshot.title);assert.notEqual(p.snapshot.summary,candidate.snapshot.summary);assert.equal(p.translation.status,'unreviewed');assert.equal(p.conflictCoverage,'not_recorded');
});
test('closed primitive six-part and expected shapes refuse bounded overflow and private errors',()=>{
 const original=vectors()[0];for(const input of [null,[],{...original.bundle,extra:'PRIVATE_CANARY'}])refuse(input,original.expected);
 for(const [key,cap] of Object.entries({candidateReportJson:262144,baselineJson:24576,canonicalBaselineJson:24576,contextJson:32768,proposalJson:16384,compositionJson:65536})){
  for(const value of [Buffer.from('PRIVATE_CANARY'),new String('PRIVATE_CANARY'),'\ud800','x'.repeat(cap+1)]){const {bundle:b,expected:e}=vectors()[0];b[key]=value;refuse(b,e);}
 }
 refuse(original.bundle,{...original.expected,extra:true});refuse(original.bundle,null);
});
