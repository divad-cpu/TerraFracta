import assert from 'node:assert/strict';import test from 'node:test';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import {admitHtmlAppendedIssueReview as admit} from '../src/server/html-appended-issue-review.ts';
import {admitAppendedIssueReview as oldAdmission} from '../src/server/appended-issue-review.ts';
import {canonicalProposalJson as canonical} from '../src/operator-proposal-capture.ts';
import {decodeProposalCapture} from '../src/server/proposal-capture.ts';
import {htmlAppendedIssueReviewVectors} from './helpers/html_appended_issue_review_vectors.mjs';
const fixture=htmlAppendedIssueReviewVectors(),sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const refuse=(b,e)=>assert.throws(()=>admit(b,e),/^Error: html_appended_issue_review_unavailable$/);
const reseal=(b,e,change)=>{const p=JSON.parse(b.compositionJson);change(p);b.compositionJson=canonical(p);e.compositionSha256=sha(b.compositionJson);};
const sample=()=>structuredClone(fixture.cases[0]);
test('fresh Python HTML compositions preserve every prior claim and strict exact unexecuted command',()=>{
 assert.deepEqual(JSON.parse(readFileSync(new URL('../fixtures/fictional-html-appended-issue-review.json',import.meta.url),'utf8')),fixture);
 for(const {bundle:b,expected:e}of fixture.cases){const r=admit(b,e),base=JSON.parse(b.baselineJson),p=decodeProposalCapture(b.proposalJson,sha(b.proposalJson)),candidate=JSON.parse(JSON.parse(b.candidateReportJson).payload_json);
 assert.deepEqual(p.snapshot.claims.slice(0,-1),base.snapshot.claims);assert.deepEqual(p.snapshot.claims.at(-1),candidate.snapshot.claims[0]);assert.equal(r.baselineClaimCount,base.snapshot.claims.length);
 assert.equal(r.capturePreparation.values[5],b.proposalJson);assert.equal(r.capturePreparation.values[4],base.id);assert.equal(r.capturePreparation.values.length,6);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.bundle)&&Object.isFrozen(r.capturePreparation.values));
 assert.match(r.evidenceState,/html_unverified_whole_issue_not_captured_or_publication_qualified/);assert.throws(()=>oldAdmission(b,e),/^Error: appended_issue_review_unavailable$/);}
 assert.equal(JSON.parse(fixture.cases[1].bundle.proposalJson).snapshot.claims[0].id,'ABCDEF00-0000-4000-8000-000000000950');assert.equal(JSON.parse(fixture.cases[2].bundle.proposalJson).snapshot.claims.length,30);
});
test('independent expected hashes intent observation and every exact part remain required',()=>{
 for(const key of ['compositionSha256','candidateReportSha256','baselineSha256','contextSha256']){const {bundle:b,expected:e}=sample();e[key]='f'.repeat(64);refuse(b,e);}
 for(const key of Object.keys(sample().bundle)){const{bundle:b,expected:e}=sample();b[key]+=' ';refuse(b,e);}
 const {bundle:b,expected:e}=sample();refuse(b,{...e,preparationIntentJson:'{}'});refuse(b,{...e,observedAt:'2026-10-15T00:00:00.000000Z'});assert.notEqual(b.baselineJson,b.canonicalBaselineJson);
});
test('coherently rehashed proposed claims cannot remove reorder replace duplicate or promote a source review',()=>{
 for(const change of[p=>p.snapshot.claims.shift(),p=>p.snapshot.claims.reverse(),p=>p.snapshot.claims[0].assertion='A replacement.',p=>p.snapshot.claims.push(p.snapshot.claims[0]),p=>p.dependencyManifest.sourceVersionIds.reverse(),p=>p.kind='accepted',p=>p.translation.status='not_required',p=>p.conflictCoverage='recorded_partial']){
 const{bundle:b,expected:e}=sample(),p=JSON.parse(b.proposalJson);change(p);b.proposalJson=canonical(p);reseal(b,e,c=>c.proposal_sha256=sha(b.proposalJson));refuse(b,e);}
});
test('six-part composition cannot relabel evidence or substitute full receipt or four historical parts',()=>{
 for(const change of[p=>p.kind='invented_appended_issue_review',p=>p.scope='invented_offline_rehearsal_only',p=>p.evidence_state='qualified',p=>p.candidate_full_receipt_sha256='f'.repeat(64),p=>p.candidate_part_sha256.reverse(),p=>p.preserved_claim_sha256.reverse(),p=>p.appended_claim_sha256='f'.repeat(64),p=>p.source_manifest_sha256='f'.repeat(64)]){const{bundle:b,expected:e}=sample();reseal(b,e,change);refuse(b,e);}
});
test('explicit whole-page context remains bounded calendar-valid unapproved and exact-head joined',()=>{
 for(const change of[c=>delete c.page.summary,c=>c.page.title='\u0085Boundary title',c=>c.page.summary='Interior\0summary',c=>c.page.last_evidence_review_on='0000-01-01',c=>c.review.translation.status='not_required',c=>c.review.translation.display_language='no',c=>c.review.conflict_coverage='recorded_partial',c=>c.baseline.head_changed_at='2020-01-01T00:00:00.000000Z']){
 const{bundle:b,expected:e}=sample(),c=JSON.parse(b.contextJson);change(c);b.contextJson=canonical(c);e.contextSha256=sha(b.contextJson);reseal(b,e,p=>{p.independent_context=c;p.context_raw_sha256=e.contextSha256;p.context_sha256=sha(canonical(c));});refuse(b,e);}
 const{bundle:b,expected:e}=sample(),p=JSON.parse(admit(b,e).capturePreparation.values[5]),c=JSON.parse(JSON.parse(b.candidateReportJson).payload_json);assert.notEqual(p.snapshot.title,c.snapshot.title);assert.notEqual(p.snapshot.summary,c.snapshot.summary);assert.equal(p.translation.status,'unreviewed');assert.equal(p.conflictCoverage,'not_recorded');
});
test('outer shapes never invoke getters and refuse symbols hidden values private errors and part caps',()=>{
 const{bundle:b,expected:e}=sample();let calls=0;
 for(const [object,key,peer] of [[b,'proposalJson',e],[e,'compositionSha256',b]]){const hostile={...object};Object.defineProperty(hostile,key,{enumerable:true,get(){calls++;throw Error('PRIVATE');}});if(object===b)refuse(hostile,peer);else refuse(peer,hostile);}
 assert.equal(calls,0);for(const input of[null,[],{...b,extra:'PRIVATE'},{...b,[Symbol('PRIVATE')]:true},Object.create(b)])refuse(input,e);
 const hidden={...b};Object.defineProperty(hidden,'extra',{value:'PRIVATE'});refuse(hidden,e);
 for(const[key,cap]of Object.entries({candidateReportJson:524288,baselineJson:24576,canonicalBaselineJson:24576,contextJson:32768,proposalJson:16384,compositionJson:65536}))for(const value of[Buffer.from('PRIVATE'),'\ud800','x'.repeat(cap+1)])refuse({...b,[key]:value},e);
});
