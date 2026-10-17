import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {admitPdfAppendedIssueReview as admit} from '../src/server/pdf-appended-issue-review.ts';
import {admitAppendedIssueReview as plain} from '../src/server/appended-issue-review.ts';
import {admitHtmlAppendedIssueReview as html} from '../src/server/html-appended-issue-review.ts';
import {pdfPreparationReviewReport} from '../src/server/pdf-preparation-review-report.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {decodeProposalCapture} from '../src/server/proposal-capture.ts';
import {pdfAppendedIssueReviewVector} from './helpers/pdf_appended_issue_review_vectors.mjs';
const fixture=pdfAppendedIssueReviewVector(),sample=()=>structuredClone(fixture),sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const refuse=(b,e)=>assert.throws(()=>admit(b,e),/^Error: pdf_appended_issue_review_unavailable$/);
const seal=(b,e,change)=>{const proof=JSON.parse(b.compositionJson);change(proof);b.compositionJson=canonical(proof);e.compositionSha256=sha(b.compositionJson);};
function candidateExpected(e){return{reportSha256:e.candidateReportSha256,preparationIntentJson:e.preparationIntentJson,preparationArtifactId:e.preparationArtifactId,preparationStoredAt:e.preparationStoredAt,observedAt:e.observedAt};}
// Explicit manually resealed correspondence vectors, NOT new Python producer
// outputs or custody/authentication evidence. They target downstream semantics
// after the original generated vector has passed all actual format checks.
function resealCandidate(b,e,change){
 const report=JSON.parse(b.candidateReportJson),p=JSON.parse(report.parts.provenance_json),s=JSON.parse(report.parts.selection_json),payload=JSON.parse(report.parts.payload_json),ctx=JSON.parse(report.parts.context_json);
 change({report,p,s,payload,ctx});report.parts.context_json=canonical(ctx);p.independent_context=ctx;p.context_sha256=sha(canonical(ctx));p.supplied_context_sha256=sha(report.parts.context_json);
 report.parts.payload_json=canonical(payload);report.parts.selection_json=canonical(s);p.payload_sha256=sha(report.parts.payload_json);p.selection_sha256=sha(report.parts.selection_json);report.parts.provenance_json=canonical(p);
 const metadata=JSON.parse(report.intent_json);for(const[k,field]of[['payload_sha256','payload_json'],['selection_sha256','selection_json'],['provenance_sha256','provenance_json'],['context_raw_sha256','context_json']])metadata[k]=sha(report.parts[field]);
 report.intent_json=canonical(metadata);report.preparation.intent_sha256=sha(report.intent_json);b.candidateReportJson=canonical(report);e.preparationIntentJson=report.intent_json;e.candidateReportSha256=sha(b.candidateReportJson);
 seal(b,e,proof=>{proof.candidate_report_sha256=e.candidateReportSha256;proof.candidate_preparation_intent_sha256=sha(report.intent_json);proof.candidate_part_sha256=[metadata.payload_sha256,metadata.selection_sha256,metadata.provenance_sha256,metadata.context_raw_sha256];});
}
function resealBaseline(b,e,change){
 const base=JSON.parse(b.baselineJson);change(base);b.baselineJson=JSON.stringify(base,null,2)+'\n';b.canonicalBaselineJson=canonical(base);e.baselineSha256=sha(b.baselineJson);
 const c=JSON.parse(b.contextJson);c.baseline.content_sha256=e.baselineSha256;b.contextJson=canonical(c);e.contextSha256=sha(b.contextJson);
 resealCandidate(b,e,({ctx})=>{ctx.issue.head.content_sha256=e.baselineSha256;});
 seal(b,e,proof=>{proof.baseline_sha256=e.baselineSha256;proof.canonical_baseline_sha256=sha(b.canonicalBaselineJson);proof.independent_context=c;proof.context_raw_sha256=e.contextSha256;proof.context_sha256=sha(canonical(c));});
 return base;
}
test('one actual Python PDF composition admits six private parts and preserves exact prior claims without a generic command',()=>{
 assert.deepEqual(fixture.producer,{fixtureAndCompositionChildren:10,allChildrenExitedAndThreePipesClosed:true});
 const{bundle:b,expected:e}=sample(),r=admit(b,e),base=JSON.parse(b.baselineJson),candidate=JSON.parse(JSON.parse(b.candidateReportJson).parts.payload_json),proposal=decodeProposalCapture(r.encodedProposal.proposalJson,r.encodedProposal.proposalSha256);
 assert.deepEqual(proposal.snapshot.claims.slice(0,-1),base.snapshot.claims);assert.deepEqual(proposal.snapshot.claims.at(-1),candidate.snapshot.claims[0]);assert.deepEqual(r.bundle,b);
 assert.equal(r.baselineClaimCount,2);assert.equal(r.appendedClaimCount,1);assert.notEqual(b.baselineJson,b.canonicalBaselineJson);
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.bundle)&&Object.isFrozen(r.selection)&&Object.isFrozen(r.encodedProposal));
 assert.equal(r.encodedProposal.proposalJson,b.proposalJson);assert.equal(r.selection.basePublicationId,base.id);assert.equal(r.snapshotIntent,'append_only_whole_issue_technical_review_not_publication');
 for(const key of ['capturePreparation','values','sql','statement'])assert.equal(Object.hasOwn(r,key),false);
 assert.match(r.evidenceState,/pdf_unverified_whole_issue_not_captured_or_publication_qualified/);assert.throws(()=>plain(b,e));assert.throws(()=>html(b,e));
});
test('all eight independent selectors and every raw part remain mandatory',()=>{
 for(const key of ['compositionSha256','candidateReportSha256','baselineSha256','contextSha256']){const{bundle:b,expected:e}=sample();e[key]='f'.repeat(64);refuse(b,e);}
 for(const[key,value]of[['preparationIntentJson','{}'],['preparationArtifactId','cd000000-0000-4000-8000-000000000999'],['preparationStoredAt','2026-10-17T00:00:00.000000Z'],['observedAt','2026-10-17T00:00:00.000000Z']]){const{bundle:b,expected:e}=sample();e[key]=value;refuse(b,e);}
 for(const key of Object.keys(sample().bundle)){const{bundle:b,expected:e}=sample();b[key]+=' ';refuse(b,e);}
 for(const key of Object.keys(sample().expected)){const{bundle:b,expected:e}=sample();delete e[key];refuse(b,e);}
});
test('coherently rehashed proposed text cannot remove reorder replace duplicate or promote prior content',()=>{
 for(const change of[p=>p.snapshot.claims.shift(),p=>p.snapshot.claims.reverse(),p=>p.snapshot.claims[0].assertion='An invented replacement.',p=>p.snapshot.claims.push(p.snapshot.claims[0]),p=>p.dependencyManifest.sourceVersionIds.reverse(),p=>p.kind='accepted',p=>p.translation.status='not_required',p=>p.conflictCoverage='recorded_partial']){
 const{bundle:b,expected:e}=sample(),p=JSON.parse(b.proposalJson);change(p);b.proposalJson=canonical(p);seal(b,e,c=>c.proposal_sha256=sha(b.proposalJson));refuse(b,e);}
});
test('format scope private limits receipt four parts and source manifest cannot be relabeled or substituted',()=>{
 for(const change of[p=>p.kind='invented_html_appended_issue_review',p=>p.scope='invented_offline_rehearsal_only',p=>p.evidence_state='qualified',p=>p.candidate_full_receipt_sha256='f'.repeat(64),p=>p.candidate_part_sha256.reverse(),p=>p.preserved_claim_sha256.reverse(),p=>p.appended_claim_sha256='f'.repeat(64),p=>p.source_manifest_sha256='f'.repeat(64)]){const{bundle:b,expected:e}=sample();seal(b,e,change);refuse(b,e);}
 const{bundle:b,expected:e}=sample();resealCandidate(b,e,({report})=>report.limits.publication_authorized=true);refuse(b,e);
});
test('known head explicit complete-page metadata and exact report observation remain separate requirements',()=>{
 for(const change of[c=>delete c.page.summary,c=>c.page.title='\u0085Boundary title',c=>c.page.summary='Interior\0summary',c=>c.page.last_evidence_review_on='0000-01-01',c=>c.review.translation.status='not_required',c=>c.review.translation.display_language='no',c=>c.review.conflict_coverage='recorded_partial',c=>c.baseline.head_changed_at='2020-01-01T00:00:00.000000Z']){
 const{bundle:b,expected:e}=sample(),c=JSON.parse(b.contextJson);change(c);b.contextJson=canonical(c);e.contextSha256=sha(b.contextJson);seal(b,e,p=>{p.independent_context=c;p.context_raw_sha256=e.contextSha256;p.context_sha256=sha(canonical(c));});refuse(b,e);}
 const{bundle:b,expected:e}=sample();e.observedAt=e.observedAt.replace(/000000Z$/,'000001Z');seal(b,e,p=>p.observed_at=e.observedAt);refuse(b,e);
 const n=sample();resealCandidate(n.bundle,n.expected,({ctx,s})=>{ctx.issue.head={publication_id:null,content_sha256:null,changed_at:null};s.basePublicationId=null;});refuse(n.bundle,n.expected);
});
test('matching manual correspondence cannot hide source aliases or duplicate original identities',()=>{
 for(const change of[base=>base.snapshot.claims[1].id=base.snapshot.claims[0].id,base=>{base.snapshot.claims[1].evidence[0].sourceVersionId=base.snapshot.claims[0].evidence[0].sourceVersionId;base.dependencyManifest.sourceVersionIds.pop();},base=>base.dependencyManifest.sourceVersionIds.push('cd000000-0000-4000-8000-000000000999')]){
 const{bundle:b,expected:e}=sample();resealBaseline(b,e,change);refuse(b,e);}
 const{bundle:b,expected:e}=sample(),candidate=JSON.parse(JSON.parse(b.candidateReportJson).parts.payload_json).snapshot.claims[0];
 const base=resealBaseline(b,e,old=>{old.snapshot.claims[0].evidence=[structuredClone(candidate.evidence[0])];old.dependencyManifest.sourceVersionIds[0]=candidate.evidence[0].sourceVersionId;});
 const p=JSON.parse(b.proposalJson);p.snapshot.claims=[...base.snapshot.claims,candidate];p.dependencyManifest.sourceVersionIds=[candidate.evidence[0].sourceVersionId,base.dependencyManifest.sourceVersionIds[1]];b.proposalJson=canonical(p);
 seal(b,e,c=>{c.proposal_sha256=sha(b.proposalJson);c.preserved_claim_sha256=base.snapshot.claims.map(x=>sha(canonical(x)));c.source_manifest_sha256=sha(canonical(p.dependencyManifest));});
 assert.equal(admit(b,e).baselineClaimCount,2);assert.equal(JSON.parse(b.proposalJson).dependencyManifest.sourceVersionIds.length,2);
});
test('critical capture UUID1 remains invalid even when broad passive PDF report correspondence is resealed',()=>{
 for(const[field,group,key]of[['captureId','content','capture_id'],['runId','held','run_id'],['decisionId','held','decision_id'],['issueId','issue','issue_id']]){
 const{bundle:b,expected:e}=sample(),bad='cd000000-0000-1000-8000-000000000999';resealCandidate(b,e,({s,ctx})=>{s[field]=bad;ctx[group][key]=bad;});
 assert.notEqual(pdfPreparationReviewReport(b.candidateReportJson,candidateExpected(e)),null);refuse(b,e);}
});
test('closed data descriptors never call getters and reject symbols hidden keys inherited state nonstrings and overflow',()=>{
 const{bundle:b,expected:e}=sample();let calls=0;
 for(const[object,key,isBundle]of[[b,'proposalJson',true],[e,'compositionSha256',false]]){const hostile={...object};Object.defineProperty(hostile,key,{enumerable:true,get(){calls++;throw Error('PRIVATE');}});isBundle?refuse(hostile,e):refuse(b,hostile);}
 assert.equal(calls,0);
 for(const object of[b,e])for(const mutate of[o=>o[Symbol('PRIVATE')]='x',o=>Object.defineProperty(o,'PRIVATE',{value:'x'}),o=>Object.setPrototypeOf(o,{PRIVATE:'x'}),o=>o.PRIVATE='x']){const x={...object};mutate(x);object===b?refuse(x,e):refuse(b,x);}
 for(const value of[null,[],Object.create(b),new String('PRIVATE')])refuse(value,e);
 for(const[key,cap]of Object.entries({candidateReportJson:262144,baselineJson:24576,canonicalBaselineJson:24576,contextJson:32768,proposalJson:16384,compositionJson:65536}))for(const value of[Buffer.from('PRIVATE'),'\ud800','x'.repeat(cap+1)])refuse({...b,[key]:value},e);
 assert.deepEqual(admit(Object.assign(Object.create(null),b),Object.assign(Object.create(null),e)).bundle,b);
});
