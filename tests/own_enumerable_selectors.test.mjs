import assert from 'node:assert/strict';
import test from 'node:test';
import { captureOwnEnumerableSelectors as capture } from '../src/own-enumerable-selectors.ts';
test('native own data avoids Proxy get while owned accessors receive their caller exactly once', () => {
  const input = { q: 'Norway' }; const proxy = new Proxy(input, { get() { assert.fail('Own data uses its native descriptor'); } });
  assert.equal(capture(proxy, ['q']).q, 'Norway');
  let calls = 0; const getter = { get q() { assert.equal(this, getter); calls++; return 'Norway'; } };
  const values = capture(getter, ['q']); assert.equal(values.q, 'Norway'); assert.equal(calls, 1); assert.equal(Object.getPrototypeOf(values), null);
});
test('descriptor failure and removed or hidden fields refuse with no prototype getter observation', () => {
  let borrowed = 0; const input = Object.create({ get q() { borrowed++; return 'PRIVATE_CANARY'; } });
  assert.equal(capture(input, ['q']), null); assert.equal(borrowed, 0);
  assert.equal(capture(new Proxy({ q: 'Norway' }, { getOwnPropertyDescriptor() { throw Error('PRIVATE_CANARY'); } }), ['q']), null);
  assert.equal(capture(Object.defineProperty({}, 'q', { value: 'Norway' }), ['q']), null);
});
test('string-only capture stops at the first non-string before later values and optional data keeps undefined', () => {
  const input = { q: ['PRIVATE_CANARY'], get runId() { assert.fail('First invalid string stops capture'); } };
  assert.equal(capture(input, ['q', 'runId'], true), null);
  assert.equal(capture({ q: undefined }, ['q']).q, undefined);
  assert.equal(capture({ set q(value) {} }, ['q']).q, undefined);
  assert.equal(capture({ q: undefined }, ['q'], true), null);
});
