import assert from 'node:assert/strict';import test from 'node:test';import {createHash} from 'node:crypto';
import {encodeProposalCapture,decodeProposalCapture,parseCapturedProposalEnvelope} from '../src/server/proposal-capture.ts';
import {PROPOSAL_PAYLOAD_BYTES} from '../src/operator-proposal-capture.ts';
import {proposedPayload,proposalReport,proposalId} from './helpers/proposal_fixture.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
test('exact review-only capture bytes/digest survive canonical reordering, preserve wording and never become publication approval',()=>{
 const p=proposedPayload(),a=encodeProposalCapture(p),b=encodeProposalCapture(Object.fromEntries(Object.entries(p).reverse()));
 assert.deepEqual(a,b);assert.equal(a.proposalSha256,hash(a.proposalJson));assert.deepEqual(decodeProposalCapture(a.proposalJson,a.proposalSha256),p);
 assert.equal(JSON.parse(a.proposalJson).kind,'review_only');assert.equal(Object.isFrozen(a),true);
});
test('unknown keys, dependency mismatch/duplication, duplicate claims and wrong target/source bindings reject',()=>{
 for(const change of [p=>p.approved=true,p=>p.snapshot.claims[0].secret='PRIVATE_CANARY',p=>p.dependencyManifest.sourceVersionIds.pop(),
  p=>p.dependencyManifest.sourceVersionIds.push(proposalId(4)),p=>p.snapshot.claims.push(structuredClone(p.snapshot.claims[0])),
  p=>p.translation.status='approved',p=>p.kind='accepted']){const p=proposedPayload();change(p);assert.throws(()=>encodeProposalCapture(p));}
 for(const change of [r=>r.requested.decisionId=proposalId(99),r=>r.target.issueSlug='another-issue',r=>r.decision.evidenceLocator='another row',
  r=>r.decision.sourceVersionId=proposalId(99),r=>r.sourceReceipts.pop(),r=>r.sourceReceipts[1]=r.sourceReceipts[0]]){
  const r=proposalReport();change(r);assert.throws(()=>parseCapturedProposalEnvelope(r));}
});
test('whitespace normalization, duplicate/escaped JSON aliases, changed payload digest and byte overflow reject',()=>{
 const p=proposedPayload();p.snapshot.summary='  PRIVATE_CANARY  ';assert.throws(()=>encodeProposalCapture(p));
 const a=encodeProposalCapture(proposedPayload());
 for(const raw of [a.proposalJson+' ',a.proposalJson.replace('"kind":"review_only"','"kind":"accepted","kind":"review_only"'),
  a.proposalJson.replace('"kind"','"\\u006bind"')])assert.throws(()=>decodeProposalCapture(raw,hash(raw)));
 assert.throws(()=>decodeProposalCapture(a.proposalJson,'b'.repeat(64)));
 const large=proposedPayload();large.snapshot.claims=Array.from({length:25},(_,i)=>({...large.snapshot.claims[0],id:proposalId(100+i),assertion:'語'.repeat(1200)}));
 assert.ok(JSON.stringify(large).length>PROPOSAL_PAYLOAD_BYTES);assert.throws(()=>encodeProposalCapture(large));
});
test('base identity/hash/issue and complete witnessed absence are bound without fabricating a public current-head envelope',()=>{
 assert.equal(parseCapturedProposalEnvelope(proposalReport()).status,'ok');
 const empty=proposalReport();empty.base=null;empty.capture.basePublicationId=null;empty.capture.baseContentSha256=null;empty.capture.baseHeadChangedAt=null;
 assert.equal(parseCapturedProposalEnvelope(empty).base,null);
 for(const change of [r=>r.base=null,r=>r.capture.baseContentSha256='b'.repeat(64),r=>r.capture.basePublicationId=proposalId(99),
  r=>r.target.issueId=proposalId(99),r=>r.base.publicationJson=r.base.publicationJson.replace('7.5','9.9')]){
  const r=proposalReport();change(r);assert.throws(()=>parseCapturedProposalEnvelope(r));}
});
test('translation none requires actual language metadata; unknown/unreviewed cannot claim clearance',()=>{
 for(const status of ['not_recorded','unreviewed']){const r=proposalReport(),p=proposedPayload();p.translation.status=status;Object.assign(r.capture,encodeProposalCapture(p));assert.equal(parseCapturedProposalEnvelope(r).status,'ok');}
 const r=proposalReport(),p=proposedPayload();p.translation.status='not_required';Object.assign(r.capture,encodeProposalCapture(p));
 assert.throws(()=>parseCapturedProposalEnvelope(r));r.sourceReceipts.forEach(s=>s.languageCode='en');assert.equal(parseCapturedProposalEnvelope(r).status,'ok');
});
test('microsecond capture/decision/observation/base chronology and future evidence reject',()=>{
 for(const change of [r=>r.capture.capturedAt='2026-09-28T06:30:00.000000Z',r=>r.observedAt='2026-09-28T07:00:00.000000Z',
  r=>r.capture.baseHeadChangedAt='2026-09-28T07:00:00.000002Z']){const r=proposalReport();change(r);assert.throws(()=>parseCapturedProposalEnvelope(r));}
 const r=proposalReport(),p=proposedPayload();p.snapshot.claims[0].evidence[0].retrievedAt='2026-09-29T00:00:00Z';Object.assign(r.capture,encodeProposalCapture(p));assert.throws(()=>parseCapturedProposalEnvelope(r));
});
test('exact source receipts bind all hashes, retrieval instants and offsets; fractional rounding cannot hide a changed receipt',()=>{
 for(const change of [r=>r.sourceReceipts[0].contentSha256='c'.repeat(64),r=>r.sourceReceipts[1].retrievedAt='2026-09-28T06:00:00.000002Z',
  r=>r.sourceReceipts[1].retrievedAt='2026-09-28T07:00:00.000002Z']){const r=proposalReport();change(r);assert.throws(()=>parseCapturedProposalEnvelope(r));}
 for(const time of ['2026-09-28T08:00:00.000001+02:00','2026-09-28T06:00:00.000001Z']){
  const r=proposalReport(),p=proposedPayload();p.snapshot.claims[0].evidence[0].retrievedAt=time;Object.assign(r.capture,encodeProposalCapture(p));assert.equal(parseCapturedProposalEnvelope(r).status,'ok');}
 for(const time of ['2026-09-28T06:00:00.000002Z','2026-09-28T06:00:00.0000011Z']){
  const r=proposalReport(),p=proposedPayload();p.snapshot.claims[0].evidence[0].retrievedAt=time;Object.assign(r.capture,encodeProposalCapture(p));assert.throws(()=>parseCapturedProposalEnvelope(r));}
});
test('partial conflict coverage requires captured contradiction; unknown coverage does not invent a clearance',()=>{
 const p=proposedPayload();p.snapshot.claims[0].evidence[1].relation='context';assert.throws(()=>encodeProposalCapture(p));
 p.conflictCoverage='not_recorded';assert.equal(decodeProposalCapture(...Object.values(encodeProposalCapture(p))).conflictCoverage,'not_recorded');
});
