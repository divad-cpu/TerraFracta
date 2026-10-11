import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { interpretCurrentIssueStatus } from '../src/current-issue-status.ts';
import { startCurrentIssueWatch } from '../src/current-issue-watch.ts';
import { loadTsx } from './helpers/tsx_loader.mjs';

const id = n => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const expected = () => ({ jurisdictionSlug: 'invented-country', issueSlug: 'invented-issue', issueId: id(1), publicationId: id(2), revision: 1 });
const next = () => ({ ...expected(), publicationId: id(3), revision: 2 });
const payload = value => ({ schemaVersion: 1, kind: 'current', ...value });
const turn = () => new Promise(resolve => setImmediate(resolve));
function varying(first, later) {
  const reads = Object.fromEntries(Object.keys(first).map(key => [key, 0]));
  const value = {};
  for (const key of Object.keys(first)) Object.defineProperty(value, key, { enumerable: true, get() {
    reads[key]++; return reads[key] === 1 ? first[key] : later[key];
  } });
  return { value, reads };
}
function controls() {
  let token = 0; const intervals = new Map(), timeouts = new Map();
  return { intervals, timeouts, visible: () => true, now: () => 0,
    interval(fn, delay) { assert.equal(delay, 15000); intervals.set(++token, fn); return token; },
    clearInterval(key) { intervals.delete(key); },
    timeout(fn, delay) { assert.equal(delay, 3000); timeouts.set(++token, fn); return token; },
    clearTimeout(key) { timeouts.delete(key); } };
}
function once(reads) { assert.deepEqual(Object.values(reads), [1, 1, 1, 1, 1]); }

test('a later caller identity cannot make a successor response current for the first validated publication', () => {
  const input = varying(expected(), next());
  assert.deepEqual(interpretCurrentIssueStatus(payload(next()), input.value), { kind: 'changed' });
  once(input.reads);
});

test('the first validated current identity stays current when original properties would later change', () => {
  const input = varying(expected(), next());
  assert.deepEqual(interpretCurrentIssueStatus(payload(expected()), input.value), { kind: 'current' });
  once(input.reads);
});

test('a read port can mutate its own request copy but cannot redefine the watched publication', async () => {
  const owner = expected(), before = structuredClone(owner), c = controls(), updates = []; let request, reads = 0;
  const watch = startCurrentIssueWatch(owner, value => updates.push(value), async identity => {
    reads++; request = identity; Object.assign(identity, next()); return payload(next());
  }, c);
  await turn(); assert.deepEqual(updates, [{ kind: 'changed' }]);
  assert.deepEqual(owner, before); assert.notEqual(request, owner); assert.equal(reads, 1);
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
  await watch.check(); assert.equal(reads, 1); watch.stop();
});

test('external identity mutation during a pending read cannot relabel an earlier rendered edition', async () => {
  const owner = expected(), c = controls(), updates = []; let settle, signal;
  const watch = startCurrentIssueWatch(owner, value => updates.push(value), async (_identity, selected) => { signal = selected; return new Promise(resolve => { settle = resolve; }); }, c);
  Object.assign(owner, next()); settle(payload(next())); await turn();
  assert.deepEqual(updates, [{ kind: 'changed' }]); assert.equal(signal.aborted, true);
  assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0); watch.stop();
});

test('each check gets a fresh request copy while a current watch keeps its original identity', async () => {
  const owner = expected(), c = controls(), updates = [], requests = [];
  const watch = startCurrentIssueWatch(owner, value => updates.push(value), async identity => {
    requests.push(identity); const response = payload(expected()); identity.issueSlug = 'foreign-issue'; return response;
  }, c);
  await turn(); await watch.check(); assert.deepEqual(updates, []);
  assert.equal(requests.length, 2); assert.notEqual(requests[0], requests[1]);
  assert.deepEqual(owner, expected()); assert.equal(c.intervals.size, 1); assert.equal(c.timeouts.size, 0);
  watch.stop(); assert.equal(c.intervals.size, 0);
});

test('invalid or first-faulting identity never reaches the read port and stays terminally unavailable', async () => {
  const fault = Object.defineProperty(expected(), 'publicationId', { enumerable: true, get() { throw Error('PRIVATE_IDENTITY_FAULT'); } });
  for (const value of [{ ...expected(), revision: 0 }, { ...expected(), private: 'PRIVATE_EXTRA' }, fault]) {
    const c = controls(), updates = []; let reads = 0;
    const watch = startCurrentIssueWatch(value, verdict => updates.push(verdict), async () => { reads++; return payload(expected()); }, c);
    await turn(); assert.deepEqual(updates, [{ kind: 'unavailable' }]); assert.equal(reads, 0);
    assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
    await watch.check(); watch.stop(); assert.equal(reads, 0);
  }
});

test('actual current-edition wrapper withholds the entire old subtree after a pending identity drift', async () => {
  const priorDocument = globalThis.document, c = controls(), owner = expected(), listeners = new Map();
  let state = { kind: 'current' }, effect, settle;
  globalThis.document = { visibilityState: 'visible', addEventListener: (key, callback) => listeners.set(key, callback), removeEventListener: key => listeners.delete(key) };
  try {
    const Component = loadTsx(new URL('../app/reader-preview/CurrentIssueEdition.tsx', import.meta.url), name => name === 'react'
      ? { useState: () => [state, value => { state = value; }], useEffect: callback => { effect = callback; } }
      : name === '../../src/current-issue-watch.ts'
        ? { startCurrentIssueWatch: (identity, changed) => startCurrentIssueWatch(identity, changed, () => new Promise(resolve => { settle = resolve; }), c) } : undefined).CurrentIssueEdition;
    const props = { expected: owner, latestHref: '/reader-preview/catalogue', children: createElement('div', null, 'OLD_DOSSIER_CANARY', createElement('a', { href: '#evidence' }, 'OLD_SOURCE_CANARY'), createElement('textarea', { defaultValue: 'UNSENT_DRAFT_CANARY' })) };
    assert.match(renderToStaticMarkup(Component(props)), /OLD_DOSSIER_CANARY/);
    const cleanup = effect(); Object.assign(owner, next()); settle(payload(next())); await turn();
    const html = renderToStaticMarkup(Component(props)); assert.equal(state.kind, 'changed');
    assert.match(html, /A newer publication is available/); assert.match(html, /href="\/reader-preview\/catalogue"/);
    assert.doesNotMatch(html, /OLD_DOSSIER_CANARY|OLD_SOURCE_CANARY|UNSENT_DRAFT_CANARY|<textarea|PRIVATE_/);
    cleanup(); assert.equal(listeners.size, 0); assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
  } finally { globalThis.document = priorDocument; }
});

test('normal current, changed, absent and incompatible responses preserve closed verdicts and exact input bytes', () => {
  const owner = expected(), original = JSON.stringify(owner);
  for (const [value, verdict] of [[payload(owner), 'current'], [payload(next()), 'changed'], [{ schemaVersion: 1, kind: 'absent' }, 'absent'], [{ schemaVersion: 1, kind: 'unavailable' }, 'unavailable'], [{ ...payload(owner), issueId: id(9) }, 'unavailable'], [{ ...payload(owner), revision: 0 }, 'unavailable'], [{ ...payload(owner), publicationId: id(9) }, 'unavailable']]) {
    const bytes = JSON.stringify(value); assert.deepEqual(interpretCurrentIssueStatus(value, owner), { kind: verdict }); assert.equal(JSON.stringify(value), bytes);
  }
  assert.equal(JSON.stringify(owner), original);
});
