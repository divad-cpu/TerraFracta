import { readerWrapperLifetime } from "./helpers/reader_wrapper_lifetime.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { interpretConnectedStatus } from '../src/connected-reader-status.ts';
import { startConnectedReaderWatch } from '../src/connected-reader-watch.ts';
import { loadTsx } from './helpers/tsx_loader.mjs';

const id = n => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const expected = () => ({ generation: 1, executionId: id(1), observedAt: '2026-01-01T12:00:00Z', state: 'active', publicationId: id(2) });
const next = () => ({ ...expected(), generation: 2, executionId: id(3), publicationId: id(4) });
const payload = identity => ({ schemaVersion: 1, kind: 'current', ...identity });
const turn = () => new Promise(resolve => setImmediate(resolve));
function controls() {
  let token = 0; const intervals = new Map(), timeouts = new Map();
  return { intervals, timeouts, visible: () => true, now: () => 0,
    interval(fn, delay) { assert.equal(delay, 15000); intervals.set(++token, fn); return token; },
    clearInterval(key) { intervals.delete(key); },
    timeout(fn, delay) { assert.equal(delay, 3000); timeouts.set(++token, fn); return token; },
    clearTimeout(key) { timeouts.delete(key); } };
}

test('connected read-port mutation cannot make a successor current for an earlier rendered edition', async () => {
  const owner = expected(), c = controls(), updates = []; let request, reads = 0;
  const watch = startConnectedReaderWatch(owner, value => updates.push(value), async identity => {
    request = identity; reads++; Object.assign(identity, next()); return payload(next());
  }, c);
  await turn(); assert.deepEqual(updates, [{ kind: 'unavailable' }]);
  assert.deepEqual(owner, expected()); assert.notEqual(request, owner);
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
  await watch.check(); assert.equal(reads, 1); watch.stop();
});

test('external connected identity drift during a pending read cannot retain the old edition', async () => {
  const owner = expected(), c = controls(), updates = []; let settle, signal;
  const watch = startConnectedReaderWatch(owner, value => updates.push(value), async (_identity, selected) => { signal = selected; return new Promise(resolve => { settle = resolve; }); }, c);
  Object.assign(owner, next()); settle(payload(next())); await turn();
  assert.deepEqual(updates, [{ kind: 'unavailable' }]); assert.equal(signal.aborted, true);
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0); watch.stop();
});

test('a recorded successor generation is compared with the watch initial generation', async () => {
  const owner = expected(), c = controls(), updates = []; let settle;
  const watch = startConnectedReaderWatch(owner, value => updates.push(value), async () => new Promise(resolve => { settle = resolve; }), c);
  owner.generation = 2; settle({ schemaVersion: 1, kind: 'changed', currentGeneration: 2 }); await turn();
  assert.deepEqual(updates, [{ kind: 'changed', currentGeneration: 2 }]);
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0); watch.stop();
});

test('connected checks receive separate copies without changing the current comparison owner', async () => {
  const owner = expected(), c = controls(), updates = [], requests = [];
  const watch = startConnectedReaderWatch(owner, value => updates.push(value), async identity => {
    requests.push(identity); identity.publicationId = id(9); return payload(expected());
  }, c);
  await turn(); await watch.check(); assert.deepEqual(updates, []);
  assert.equal(requests.length, 2); assert.notEqual(requests[0], requests[1]);
  assert.deepEqual(owner, expected()); assert.equal(c.intervals.size, 1); assert.equal(c.timeouts.size, 0);
  watch.stop(); assert.equal(c.intervals.size, 0);
});

test('connected invalid or first-faulting identity is unavailable before read-port dispatch', async () => {
  const fault = Object.defineProperty(expected(), 'executionId', { enumerable: true, get() { throw Error('PRIVATE_CONNECTED_IDENTITY_FAULT'); } });
  for (const owner of [{ ...expected(), generation: 0 }, { ...expected(), private: 'PRIVATE_EXTRA' }, fault]) {
    const c = controls(), updates = []; let reads = 0;
    const watch = startConnectedReaderWatch(owner, value => updates.push(value), async () => { reads++; return payload(expected()); }, c);
    await turn(); assert.deepEqual(updates, [{ kind: 'unavailable' }]); assert.equal(reads, 0);
    assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
    await watch.check(); watch.stop(); assert.equal(reads, 0);
  }
});

test('actual connected-edition wrapper withholds the whole old subtree after identity drift', async () => {
  const priorDocument = globalThis.document, c = controls(), owner = expected(), listeners = new Map();
  let state = { kind: 'current' }, effect, settle; const lifetime = readerWrapperLifetime(callback => { effect = callback; });
  globalThis.document = { visibilityState: 'visible', addEventListener: (key, callback) => listeners.set(key, callback), removeEventListener: key => listeners.delete(key) };
  try {
    const Component = loadTsx(new URL('../app/connected-preview/CurrentConnectedEdition.tsx', import.meta.url), name => name === 'react'
      ? { useState: () => [state, value => { state = value; }], ...lifetime }
      : name === '../../src/connected-reader-watch'
        ? { startConnectedReaderWatch: (identity, changed) => startConnectedReaderWatch(identity, changed, () => new Promise(resolve => { settle = resolve; }), c) } : undefined).CurrentConnectedEdition;
    const props = { expected: owner, children: createElement('div', null, 'OLD_CONNECTED_CLAIM_CANARY', createElement('a', { href: '#evidence' }, 'OLD_CONNECTED_SOURCE_CANARY'), createElement('textarea', { defaultValue: 'UNSENT_CONNECTED_DRAFT_CANARY' })) };
    assert.match(renderToStaticMarkup(Component(props)), /OLD_CONNECTED_CLAIM_CANARY/);
    const cleanup = effect(); Object.assign(owner, next()); settle(payload(next())); await turn();
    const html = renderToStaticMarkup(Component(props)); assert.equal(state.kind, 'unavailable');
    assert.match(html, /Update temporarily unavailable/); assert.match(html, /href="\/connected-preview\/overview"/);
    assert.doesNotMatch(html, /OLD_CONNECTED_CLAIM_CANARY|OLD_CONNECTED_SOURCE_CANARY|UNSENT_CONNECTED_DRAFT_CANARY|<textarea|PRIVATE_/);
    cleanup(); assert.equal(listeners.size, 0); assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
  } finally { globalThis.document = priorDocument; }
});

test('ordinary active and suppressed identities retain the established closed connected verdicts and bytes', () => {
  for (const owner of [expected(), { ...expected(), state: 'suppressed', publicationId: null }]) {
    const original = JSON.stringify(owner);
    for (const [value, verdict] of [[payload(owner), { kind: 'current' }], [{ schemaVersion: 1, kind: 'changed', currentGeneration: 2 }, { kind: 'changed', currentGeneration: 2 }], [{ schemaVersion: 1, kind: 'changed', currentGeneration: 1 }, { kind: 'unavailable' }], [{ schemaVersion: 1, kind: 'unavailable' }, { kind: 'unavailable' }], [{ ...payload(owner), executionId: id(9) }, { kind: 'unavailable' }], [{ ...payload(owner), private: 'PRIVATE_PAYLOAD' }, { kind: 'unavailable' }]]) {
      const bytes = JSON.stringify(value); assert.deepEqual(interpretConnectedStatus(value, owner), verdict); assert.equal(JSON.stringify(value), bytes);
    }
    assert.equal(JSON.stringify(owner), original);
  }
});
