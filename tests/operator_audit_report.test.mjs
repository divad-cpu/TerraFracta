import assert from 'node:assert/strict';
import test from 'node:test';
import { operatorAuditReportSchema, operatorAuditEnvelopeSchema } from '../src/operator-audit-report.ts';
import { audit, id } from './helpers/operator_audit_fixture.mjs';
const accepts = value => operatorAuditReportSchema.safeParse(value).success;

test('recorded run/check/revision metadata is accepted without public-health inference', () => {
  const report = audit();assert.equal(accepts(report),true);
  report.sources[0].registrationState='suspended';report.sources[0].fetchEnabled=false;
  report.sources[0].reviewedAt='2026-10-05T09:59:00Z';
  assert.equal(accepts(report),true); // current suspension can follow a recorded unchanged check.
  report.history.publications[0].publicationKind='draft';assert.equal(accepts(report),true);
});
test('unknown expected set with no recorded checks and empty history stays a valid unknown audit', () => {
  const report=audit();report.expectedSourcesKnown=false;report.sources=[];
  Object.assign(report.history,{latestRevision:0,headPublicationId:null,headRevision:null,publications:[]});
  assert.equal(accepts(report),true);
  report.expectedSourcesKnown=true;assert.equal(accepts(report),false);
});
test('private/raw fields are refused at every metadata boundary', () => {
  for(const path of [[],['requested'],['run'],['sources',0],['history'],['history','publications',0]]) {
    const report=audit();let target=report;for(const key of path)target=target[key];
    target.raw_snapshot='PRIVATE_CANARY';assert.equal(accepts(report),false);
  }
  const held={schemaVersion:1,status:'changed',requested:{...audit().requested,cursor:{latestRevision:2,headPublicationId:id(6),beforeRevision:1}}};
  assert.equal(operatorAuditEnvelopeSchema.safeParse(held).success,true);
  held.report=audit();assert.equal(operatorAuditEnvelopeSchema.safeParse(held).success,false);
});
test('source check identities/outcomes/order and permission flags remain consistent', () => {
  const mutations=[r=>r.sources.push({...r.sources[0]}),r=>r.sources[0].sourceVersionId=null,
    r=>r.sources[0].outcome='failed',r=>r.sources[0].checkedAt=null,
    r=>r.sources[0].allowFetch=false,r=>r.sources[0].registrationState='candidate',
    r=>r.sources[0].reviewedAt=null,r=>{r.expectedSourcesKnown=false;Object.assign(r.sources[0],{outcome:'not_recorded',checkedAt:null,sourceVersionId:null});},
    r=>r.sources.unshift({...r.sources[0],registrationId:id(10),sourceKey:'zzz:source'}),
    r=>r.sources=Array.from({length:51},(_,n)=>({...r.sources[0],registrationId:id(n+100),sourceKey:`source:${String(n).padStart(3,'0')}`}))];
  for(const mutate of mutations){const r=audit();mutate(r);assert.equal(accepts(r),false);}
  for(const outcome of ['failed','deferred','not_recorded']) {
    const r=audit();Object.assign(r.sources[0],{outcome,sourceVersionId:null,...outcome==='not_recorded'?{checkedAt:null}:{}});
    assert.equal(accepts(r),true);
  }
});
test('microsecond future and predecessor timelines are refused without format exceptions', () => {
  for(const mutate of [r=>r.observedAt='invalid',r=>r.observedAt='2026-02-30T10:00:00Z',
    r=>r.sources[0].checkedAt='2026-10-05T10:00:00.000003Z',
    r=>r.sources[0].reviewedAt='2026-10-05T10:00:00.000003Z',
    r=>r.run.finishedAt='2026-10-05T08:59:59.999999Z',
    r=>r.history.publications[0].createdAt='2026-10-05T10:00:00.000003Z',
    r=>r.history.publications[1].createdAt='2026-10-05T09:03:00.000001Z']) {
    const r=audit();mutate(r);assert.doesNotThrow(()=>accepts(r));assert.equal(accepts(r),false);
  }
});
test('scope, head, revision order, duplicates and self supersession cannot pass', () => {
  for(const mutate of [r=>r.run.runId=id(100),r=>r.history.issueId=id(100),
    r=>r.history.headPublicationId=null,r=>r.history.headRevision=1,
    r=>r.history.publications[0].isHead=false,r=>r.history.latestRevision=3,
    r=>r.history.publications.reverse(),r=>r.history.publications[0].supersedesPublicationId=id(6),
    r=>r.history.publications[1].publicationId=id(6),r=>r.history.nextCursor={latestRevision:2,headPublicationId:id(6),beforeRevision:1}]) {
    const r=audit();mutate(r);assert.equal(accepts(r),false);
  }
});
test('history pagination anchors both latest stored revision and head without forcing consecutive revisions', () => {
  const r=audit();r.history.latestRevision=100;
  r.history.publications=Array.from({length:20},(_,n)=>({publicationId:id(100+n),revision:100-n*2,supersedesPublicationId:null,publicationKind:'draft',createdAt:'2026-10-05T09:05:00Z',isHead:false}));
  r.history.nextCursor={latestRevision:100,headPublicationId:id(6),beforeRevision:62};
  assert.equal(accepts(r),true);
  r.requested.cursor={latestRevision:100,headPublicationId:id(6),beforeRevision:62};
  r.history.publications=[{...r.history.publications[0],revision:60}];r.history.nextCursor=null;
  assert.equal(accepts(r),true);
  r.requested.cursor.headPublicationId=id(99);assert.equal(accepts(r),false);
  r.requested.cursor.headPublicationId=id(6);r.requested.cursor.latestRevision=101;assert.equal(accepts(r),false);
});
