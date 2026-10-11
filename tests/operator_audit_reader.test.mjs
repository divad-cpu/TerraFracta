import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalOperatorAuditScope, createOperatorAuditReader, readOperatorAudit, OPERATOR_AUDIT_BYTES, OPERATOR_AUDIT_TIMEOUT_MS } from '../src/server/operator-audit-reader.ts';
import { audit, scope, id, bytes } from './helpers/operator_audit_fixture.mjs';
const held={kind:'unavailable'};

test('invalid scope selectors are refused before provider and unconfigured stays distinct', async () => {
  let calls=0;const read=createOperatorAuditReader(async()=>{calls++;return bytes(audit());});
  for(const value of [null,[],{}, {...scope(),sql:'PRIVATE'}, {...scope(),cursor:{latestRevision:2,headPublicationId:null,beforeRevision:3}}, {...scope(),runId:'../any'}, {...scope(),issueId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'}]) {
    assert.equal(canonicalOperatorAuditScope(value),null);assert.deepEqual(await read(value),{kind:'invalid_scope'});
  }
  assert.equal(calls,0);assert.deepEqual(await readOperatorAudit(scope()),{kind:'unconfigured'});
});
test('fresh trusted bounded metadata is decoded once, with immutable input and no cache', async () => {
  let calls=0,observedSignal;
  const read=createOperatorAuditReader(async(s,signal)=>{calls++;assert.deepEqual(s,scope());assert.ok(Object.isFrozen(s));observedSignal=signal;return bytes(audit());});
  const first=await read(scope());assert.equal(first.kind,'ok');assert.equal(first.report.history.latestRevision,2);
  assert.equal(observedSignal.aborted,true);assert.equal((await read(scope())).kind,'ok');assert.equal(calls,2);
});
test('detail-free absent and changed envelopes bind exact scope and do not contain partial reports', async () => {
  for(const status of ['not_found','changed']) {
    const input={...scope(),cursor:status==='changed'?{latestRevision:2,headPublicationId:id(6),beforeRevision:1}:null};
    const envelope={schemaVersion:1,status,requested:structuredClone(input)};
    assert.deepEqual(await createOperatorAuditReader(async()=>bytes(envelope))(input),{kind:status});
    envelope.requested.issueId=id(8);assert.deepEqual(await createOperatorAuditReader(async()=>bytes(envelope))(input),held);
  }
});
test('wrong report scope/cursor and forbidden fields withhold entire report', async () => {
  for(const mutate of [r=>r.requested.runId=id(9),r=>r.requested.issueId=id(9),r=>r.raw='PRIVATE_CANARY',r=>r.sources[0].sourceUrl='https://example.org/private']) {
    const r=audit();mutate(r);assert.deepEqual(await createOperatorAuditReader(async()=>bytes(r))(scope()),held);
  }
  assert.deepEqual(await createOperatorAuditReader(async()=>bytes(audit()))({...scope(),cursor:{latestRevision:2,headPublicationId:id(6),beforeRevision:1}}),held);
});
test('malformed UTF8 JSON scalar oversized and wrong transport types never expose errors', async () => {
  for(const value of [new Uint8Array([0xff,0xff]),new TextEncoder().encode('{broken'),bytes(null),bytes({}),new Uint8Array(OPERATOR_AUDIT_BYTES+1),new Uint8Array(1),new ArrayBuffer(10),'PRIVATE_CANARY']) {
    assert.deepEqual(await createOperatorAuditReader(async()=>value)(scope()),held);
  }
  assert.deepEqual(await createOperatorAuditReader(async()=>{throw new Error('PASSWORD_CANARY');})(scope()),held);
  const exact=bytes(JSON.stringify(audit())); // a JSON string is not a report
  assert.deepEqual(await createOperatorAuditReader(async()=>exact)(scope()),held);
  const padded=new TextEncoder().encode(JSON.stringify(audit())+' '.repeat(OPERATOR_AUDIT_BYTES-bytes(audit()).length));
  assert.equal((await createOperatorAuditReader(async()=>padded)(scope())).kind,'ok');
});
test('preabort and pending cancellation refuse late completion without retry or cache', async () => {
  let calls=0,finish,child;
  const read=createOperatorAuditReader(async(_scope,signal)=>{calls++;child=signal;return new Promise(resolve=>{finish=resolve;});});
  const pre=new AbortController();pre.abort();assert.deepEqual(await read(scope(),pre.signal),held);assert.equal(calls,0);
  const parent=new AbortController(),pending=read(scope(),parent.signal);await Promise.resolve();parent.abort();
  assert.deepEqual(await pending,held);assert.equal(calls,1);assert.equal(child.aborted,true);finish(bytes(audit()));await Promise.resolve();
});
test('fixed deadline abandons an unresponsive provider and signals cancellation', async t => {
  t.mock.timers.enable({apis:['setTimeout']});let child;
  const pending=createOperatorAuditReader(async(_scope,signal)=>{child=signal;return new Promise(()=>{});})(scope());
  await Promise.resolve();t.mock.timers.tick(OPERATOR_AUDIT_TIMEOUT_MS);
  assert.deepEqual(await pending,held);assert.equal(child.aborted,true);
});
test('elapsed clocks including late success negative and NaN never release metadata', async () => {
  for(const times of [[0,0,3000],[0,0,-1],[0,0,NaN],[NaN]]) {
    let index=0;assert.deepEqual(await createOperatorAuditReader(async()=>bytes(audit()),()=>times[Math.min(index++,times.length-1)])(scope()),held);
  }
});
