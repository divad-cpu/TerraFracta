import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { sample } from './helpers/public_read_rows_fixture.mjs';
import { createPublicIssueReader } from '../src/server/public-issue-reader.ts';

const navigation = createRequire(import.meta.url)('next/navigation');
const NOT_FOUND = Symbol('expected refusal');
const paths = ['../app/reader-preview/[country]/[issue]/page.tsx', '../app/reader-preview/[country]/[issue]/[view]/page.tsx'];
const tuple = which => ({ country: 'norway', issue: 'housing-costs', ...(which ? { view: 'sources' } : {}) });
function harness(which) {
  const calls = [], rows = sample();
  rows.requestedRoute = { jurisdictionSlug: 'norway', issueSlug: 'housing-costs' };
  rows.country.public_slug = rows.publication.snapshot.jurisdictionSlug = 'norway';
  rows.dossier.public_slug = rows.publication.snapshot.issueSlug = 'housing-costs';
  const read = createPublicIssueReader(async value => { calls.push(structuredClone(value)); return new TextEncoder().encode(JSON.stringify(rows)); }, () => 0);
  const Page = loadTsx(new URL(paths[which], import.meta.url), name =>
    name === 'next/navigation' ? { unstable_rethrow: navigation.unstable_rethrow, notFound() { throw NOT_FOUND; } } :
      name.endsWith('/server/public-issue-reader') ? { ...loadTsx(new URL('../src/server/public-issue-reader.ts', import.meta.url)), readPublicIssue: read } : undefined,
  { env: { NODE_ENV: 'development' } }).default;
  return { calls, rows, render: async props => renderToStaticMarkup(await Page(props)) };
}
const refused = (h, props) => assert.rejects(h.render(props), error => error === NOT_FOUND);

test('current reader invalid tuples refuse before obtaining an unrelated query property', async () => {
  for (const which of [0, 1]) for (const value of [null, undefined, [], { ...tuple(which), extra: 'PRIVATE_CANARY' }, { ...tuple(which), country: 'NORWAY' }, { ...tuple(which), issue: '../other' }]) {
    const h = harness(which); let reads = 0;
    await refused(h, { params: Promise.resolve(value), get searchParams() { reads++; throw Error('PRIVATE_CANARY'); } });
    assert.equal(reads, 0); assert.deepEqual(h.calls, []);
  }
});

test('current dossier invalid slugs and views refuse without awaiting an unfinished query', async () => {
  for (const values of [{ ...tuple(1), country: 'NORWAY' }, { ...tuple(1), issue: '../other' }, { ...tuple(1), view: 'unknown' }, { ...tuple(1), view: ['sources'] }]) {
    const h = harness(1); let queries = 0;
    const result = await Promise.race([
      h.render({ params: Promise.resolve(values), searchParams: { then() { queries++; } } }).then(() => 'rendered', error => error),
      new Promise(resolve => setTimeout(() => resolve('still pending'), 75)),
    ]);
    assert.equal(result, NOT_FOUND); assert.equal(queries, 0); assert.deepEqual(h.calls, []);
  }
});

test('current reader failed params refuse before touching another selector port', async () => {
  for (const which of [0, 1]) for (const form of ['reject', 'then-get', 'props-get']) {
    const h = harness(which); let queries = 0, params = 0;
    const values = form === 'reject' ? { then(_resolve, reject) { params++; reject(Error('PRIVATE_CANARY')); } } :
      { get then() { params++; throw Error('PRIVATE_CANARY'); } };
    const props = { get params() { if (form === 'props-get') { params++; throw Error('PRIVATE_CANARY'); } return values; },
      get searchParams() { queries++; return {}; } };
    await refused(h, props); assert.equal(params, 1); assert.equal(queries, 0); assert.deepEqual(h.calls, []);
  }
});

test('invalid current routes cannot be redirected by an unrelated query property', async () => {
  for (const which of [0, 1]) {
    const h = harness(which); let queries = 0;
    await refused(h, { params: Promise.resolve({ ...tuple(which), country: 'NORWAY' }),
      get searchParams() { queries++; navigation.redirect('/PRIVATE_UNRELATED_QUERY'); } });
    assert.equal(queries, 0); assert.deepEqual(h.calls, []);
  }
});

test('current reader real params interrupts retain precedence and valid query interrupts still propagate', async () => {
  for (const which of [0, 1]) for (const interrupt of [navigation.notFound, () => navigation.redirect('/PRIVATE_PARAMS'), () => navigation.permanentRedirect('/PRIVATE_PARAMS')]) {
    let signal; try { interrupt(); } catch (error) { signal = error; }
    const h = harness(which); let queries = 0;
    await assert.rejects(h.render({ params: { then(_resolve, reject) { reject(Error('PRIVATE_WRAPPER', { cause: signal })); } },
      get searchParams() { queries++; throw Error('PRIVATE_UNRELATED_QUERY'); } }), error => error === signal);
    assert.equal(queries, 0); assert.deepEqual(h.calls, []);
    const valid = harness(which);
    await assert.rejects(valid.render({ params: Promise.resolve(tuple(which)), searchParams: { then(_resolve, reject) { reject(signal); } } }), error => error === signal);
    assert.deepEqual(valid.calls, []);
  }
});

test('admitted current routes obtain the query after params exactly once and preserve native evidence output', async () => {
  for (const which of [0, 1]) for (const view of which ? ['issue', 'sources', 'search'] : ['base']) {
    const h = harness(which), steps = [], values = { ...tuple(which), ...(which ? { view } : {}) };
    const query = which ? { edition: h.rows.publication.id, ...(view === 'search' ? { q: 'cell A1', type: 'condition' } : {}) } : {};
    let queryThen = 0;
    Object.defineProperty(query, 'then', { get() { queryThen++; if (queryThen === 1) return undefined; throw Error('PRIVATE_DOUBLE_ASSIMILATION'); } });
    const html = await h.render({ params: { then(resolve) { steps.push('params settled'); resolve(values); } },
      get searchParams() { steps.push('query obtained'); return query; } });
    assert.deepEqual(steps, ['params settled', 'query obtained']); assert.equal(queryThen, 1);
    assert.deepEqual(h.calls, [h.rows.requestedRoute]); assert.match(html, /Reference 1|reference 1|Current issue/);
    assert.doesNotMatch(html, /PRIVATE_/);
  }
});
