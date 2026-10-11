import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { sample } from './helpers/public_read_rows_fixture.mjs';
import { createPublicIssueReader } from '../src/server/public-issue-reader.ts';
import { loadCurrentVisitorCatalogue } from '../src/server/current-visitor-catalog.ts';

const navigation = createRequire(import.meta.url)('next/navigation');
const NOT_FOUND = Symbol('expected Next notFound boundary');
const paths = ['../app/reader-preview/[country]/[issue]/page.tsx', '../app/reader-preview/[country]/[issue]/[view]/page.tsx'];
const route = { country: 'norway', issue: 'housing-costs' };
function inventedRows() {
  const rows = sample(); rows.requestedRoute = { jurisdictionSlug: route.country, issueSlug: route.issue };
  rows.country.public_slug = route.country; rows.dossier.public_slug = route.issue;
  rows.publication.snapshot.jurisdictionSlug = route.country; rows.publication.snapshot.issueSlug = route.issue;
  return rows;
}
function harness(which, env = 'development') {
  const calls = [], diagnostics = [], rows = inventedRows();
  const read = createPublicIssueReader(async requested => { calls.push(structuredClone(requested)); return new TextEncoder().encode(JSON.stringify(rows)); }, () => 0, code => diagnostics.push(code));
  const intercept = name => name === 'next/navigation' ? { unstable_rethrow: navigation.unstable_rethrow, notFound() { throw NOT_FOUND; } } : name.endsWith('/server/public-issue-reader') ? { ...loadTsx(new URL('../src/server/public-issue-reader.ts', import.meta.url)), readPublicIssue: read } : name.endsWith('/server/current-visitor-catalog.ts') ? { loadCurrentVisitorCatalogue: value => loadCurrentVisitorCatalogue(value, read, undefined, code => diagnostics.push(code)) } : undefined;
  const Page = loadTsx(new URL(which === 'catalogue' ? '../app/reader-preview/catalogue/page.tsx' : paths[which], import.meta.url), intercept, { env: { NODE_ENV: env } }).default;
  return { calls, diagnostics, rows, render: async props => renderToStaticMarkup(await Page(props)) };
}
const props = (which, query = {}) => ({ params: Promise.resolve({ ...route, ...(which === 1 ? { view: 'sources' } : {}) }), searchParams: Promise.resolve(query) });
const absent = html => assert.doesNotMatch(html, /PRIVATE_CANARY|Reference 1|Source URL:|name="edition"|current-issue-correction/);

test('rejected catalogue query supplies the established invalid-link result without a reader call', async () => {
  const h = harness('catalogue'), html = await h.render({ searchParams: Promise.reject(Error('PRIVATE_CANARY')) });
  assert.match(html, /Check the directory link/); assert.match(html, /No current reader was called/); absent(html);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.diagnostics, []);
});

test('rejected route selectors reach the existing not-found boundary before reading current evidence', async () => {
  for (const which of [0, 1]) for (const field of ['params', 'searchParams']) {
    const h = harness(which), input = props(which); input[field] = Promise.reject(Error('PRIVATE_CANARY'));
    await assert.rejects(h.render(input), error => error === NOT_FOUND);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.diagnostics, []);
  }
});

test('throwing and rejecting query thenables are observed once and cannot resurrect an edition or directory return', async () => {
  for (const which of ['catalogue', 0, 1]) for (const form of ['get', 'reject']) {
    const h = harness(which); let observations = 0;
    const port = form === 'get' ? { get then() { observations++; throw Error('PRIVATE_CANARY'); } } : { then(resolve, reject) { observations++; reject(Error('PRIVATE_CANARY')); } };
    const input = { ...props(which), searchParams: port };
    if (which === 'catalogue') { const html = await h.render(input); assert.match(html, /Check the directory link/); absent(html); }
    else await assert.rejects(h.render(input), error => error === NOT_FOUND);
    assert.equal(observations, 1); assert.deepEqual(h.calls, []); assert.deepEqual(h.diagnostics, []);
  }
});

test('successful hidden then on catalogue query is not assimilated a second time', async () => {
  const h = harness('catalogue'); let observations = 0;
  const query = { view: 'issues', q: 'Norway housing', country: 'norway', topic: 'housing' };
  Object.defineProperty(query, 'then', { get() { observations++; if (observations === 1) return undefined; throw Error('PRIVATE_CANARY'); } });
  const html = await h.render({ searchParams: query });
  assert.equal(observations, 1); assert.match(html, /1 dossier matches/);
  assert.deepEqual(h.calls, [h.rows.requestedRoute]); assert.deepEqual(h.diagnostics, []);
});

test('successful hidden then on route values and search preserves exactly one reader call', async () => {
  for (const which of [0, 1]) {
    const h = harness(which), input = props(which), counts = {};
    for (const [field, values] of Object.entries({ params: { ...route, ...(which === 1 ? { view: 'search' } : {}) }, searchParams: which === 1 ? { q: 'cell A1', type: 'condition' } : {} })) {
      counts[field] = 0;
      Object.defineProperty(values, 'then', { get() { counts[field]++; if (counts[field] === 1) return undefined; throw Error('PRIVATE_CANARY'); } });
      input[field] = values;
    }
    const html = await h.render(input);
    assert.deepEqual(counts, { params: 1, searchParams: 1 });
    assert.match(html, which === 1 ? /1 statement matches/ : /Current issue/);
    assert.doesNotMatch(html, /PRIVATE_CANARY/); assert.deepEqual(h.calls, [h.rows.requestedRoute]); assert.deepEqual(h.diagnostics, []);
  }
});

test('resolved invalid catalogue selectors keep refusal with no provider call', async () => {
  for (const value of [null, [], { view: ['issues'] }, { unexpected: 'PRIVATE_CANARY' }]) {
    const h = harness('catalogue'), html = await h.render({ searchParams: Promise.resolve(value) });
    assert.match(html, /Check the directory link/); absent(html); assert.deepEqual(h.calls, []);
  }
});

test('resolved invalid route values and queries do not read a different scope', async () => {
  for (const which of [0, 1]) for (const [field, value] of [['params', null], ['params', { ...route, extra: 'PRIVATE_CANARY' }], ['searchParams', { unexpected: 'PRIVATE_CANARY' }]]) {
    const h = harness(which), input = props(which); input[field] = Promise.resolve(value);
    await assert.rejects(h.render(input), error => error === NOT_FOUND); assert.deepEqual(h.calls, []);
  }
});

test('production refusal precedes touching any async query or route port', async () => {
  for (const which of ['catalogue', 0, 1]) {
    const h = harness(which, 'production'), input = { get params() { assert.fail('Production must refuse before params'); }, get searchParams() { assert.fail('Production must refuse before query'); } };
    await assert.rejects(h.render(input), error => error === NOT_FOUND); assert.deepEqual(h.calls, []);
  }
});

test('known failed base params do not wait for an unrelated pending search port', async () => {
  const h = harness(0); let touches = 0;
  const input = { params: Promise.reject(Error('PRIVATE_CANARY')), searchParams: { then() { touches++; } } };
  const result = await Promise.race([h.render(input).then(() => 'rendered', error => error), new Promise(resolve => setTimeout(() => resolve('still pending'), 75))]);
  assert.equal(result, NOT_FOUND); assert.equal(touches, 0); assert.deepEqual(h.calls, []);
});

test('known invalid base route tuple or canonical slug refuses before awaiting search', async () => {
  for (const values of [null, { ...route, extra: 'PRIVATE_CANARY' }, { ...route, country: 'NORWAY' }]) {
    const h = harness(0); let touches = 0;
    const input = { params: Promise.resolve(values), searchParams: { then() { touches++; } } };
    const result = await Promise.race([h.render(input).then(() => 'rendered', error => error), new Promise(resolve => setTimeout(() => resolve('still pending'), 75))]);
    assert.equal(result, NOT_FOUND); assert.equal(touches, 0); assert.deepEqual(h.calls, []);
  }
});
