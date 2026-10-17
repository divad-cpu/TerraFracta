import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalOperatorAuditScope, createOperatorAuditReader, readOperatorAudit } from '../src/server/operator-audit-reader.ts';
import { audit, scope, id, bytes } from './helpers/operator_audit_fixture.mjs';

const poison = Symbol('invented_untrusted_scope');
function throwingField(target, key) {
  Object.defineProperty(target, key, { enumerable: true, configurable: true, get() { throw poison; } });
  return target;
}
function faultyScopes() {
  return [
    ...['runId','issueId','cursor'].map(key => () => throwingField(scope(),key)),
    ...['latestRevision','headPublicationId','beforeRevision'].map(key => () => ({ ...scope(), cursor: throwingField({latestRevision:2,headPublicationId:id(6),beforeRevision:1},key) })),
    () => new Proxy(scope(), {ownKeys() {throw poison;}}),
    () => new Proxy(scope(), {get(target,key,receiver) {if(key==='runId') throw poison; return Reflect.get(target,key,receiver);}}),
    () => {const {proxy,revoke}=Proxy.revocable(scope(),{});revoke();return proxy;},
  ];
}

test('unknown audit scope observation faults receive the existing null refusal', () => {
  for (const make of faultyScopes()) assert.equal(canonicalOperatorAuditScope(make()),null);
});

test('faulty audit scopes are refused before provider clock recorder or signal observation', async () => {
  let effects=0;
  const forbidden=()=>{effects++;throw new Error('invented_forbidden_effect');};
  const read=createOperatorAuditReader(forbidden,forbidden,forbidden);
  const signal=new Proxy({}, {get:forbidden});
  for (const make of faultyScopes()) assert.deepEqual(await read(make(),signal),{kind:'invalid_scope'});
  assert.equal(effects,0);
  for (const make of faultyScopes()) assert.deepEqual(await readOperatorAudit(make()),{kind:'invalid_scope'});
});

test('normal audit scope grammar frozen copies and read outcomes retain their meaning', async () => {
  const input={...scope(),cursor:{latestRevision:2,headPublicationId:id(6),beforeRevision:1}};
  const checked=canonicalOperatorAuditScope(input);
  assert.deepEqual(checked,input);assert.notEqual(checked,input);assert.notEqual(checked.cursor,input.cursor);
  assert.ok(Object.isFrozen(checked));assert.ok(Object.isFrozen(checked.cursor));
  assert.equal(canonicalOperatorAuditScope({...scope(),extra:'invented'}),null);
  assert.equal(canonicalOperatorAuditScope({...scope(),runId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'}),null);
  assert.equal(canonicalOperatorAuditScope({...input,cursor:{...input.cursor,beforeRevision:3}}),null);
  assert.deepEqual(await readOperatorAudit(scope()),{kind:'unconfigured'});
  let calls=0,observed;
  const read=createOperatorAuditReader(async (s,signal)=>{calls++;observed=signal;assert.deepEqual(s,scope());assert.ok(Object.isFrozen(s));return bytes(audit());},()=>0,()=>assert.fail('unexpected diagnostic'));
  const result=await read(scope());assert.equal(result.kind,'ok');assert.equal(result.report.history.latestRevision,2);
  assert.equal(calls,1);assert.ok(observed instanceof AbortSignal);assert.equal(observed.aborted,true);
});
