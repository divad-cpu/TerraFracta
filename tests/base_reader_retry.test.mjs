import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { sample } from './helpers/public_read_rows_fixture.mjs';
import { canonicalPublicIssueRoute, createPublicIssueReader } from '../src/server/public-issue-reader.ts';

// Actual development page, bounded reader/materializer and presenter. Only the
// unconfigured provider supplies invented candidate bytes; no Browser or SQL.
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const View = loadTsx(new URL('../src/public-issue-read-view.tsx', import.meta.url)).PublicIssueReadView;
const render = props => renderToStaticMarkup(View(props));
const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
  .map(match => ({ href: match[1].replaceAll('&amp;', '&'), text: match[2] }));
const retry = html => links(html).find(link => link.text === 'Check the current issue again');
const held = status => ({ status, cacheControl: 'no-store' });
const base = route => `/reader-preview/${route.jurisdictionSlug}/${route.issueSlug}`;
function pageFor(read, environment = 'development', notFound = () => { throw new Error('NOT_FOUND'); }) {
  return loadTsx(new URL('../app/reader-preview/[country]/[issue]/page.tsx', import.meta.url), name => {
    if (name === 'next/navigation') return { notFound, unstable_rethrow() {} };
    if (name.endsWith('public-issue-reader')) return { canonicalPublicIssueRoute, readPublicIssue: read };
  }, { env: { NODE_ENV: environment } }).default;
}
function journey(initial) {
  const original = sample(), calls = [];
  let current = initial;
  const read = createPublicIssueReader(async route => { calls.push(route); return bytes(current); }, undefined, () => {});
  const Page = pageFor(read), pathname = base(original.requestedRoute);
  return { original, calls, pathname, setCurrent(value) { current = value; },
    async visit(href = pathname) {
      const url = new URL(href, 'https://example.invalid');
      const [, , country, issue] = url.pathname.split('/');
      return renderToStaticMarkup(await Page({ params: Promise.resolve({ country, issue }),
        searchParams: Promise.resolve(Object.fromEntries(url.searchParams)) }));
    },
  };
}

for (const [status, value, label] of [[404, null, 'No eligible issue found'],
  [503, { private: 'PRIVATE_CANDIDATE_CANARY' }, 'Issue temporarily unavailable']]) {
  test(`base reader ${status} retries only after an explicit same-route visit and reads fresh current`, async () => {
    const flow = journey(value), initial = await flow.visit();
    assert.ok(initial.includes(label));
    const action = retry(initial);
    assert.equal(action?.href, flow.pathname);
    assert.equal(flow.calls.length, 1, 'rendering the native action does not prefetch or retry');
    assert.doesNotMatch(initial, /PRIVATE_CANDIDATE_CANARY|edition=|returnTo=|returnAnchor=|<script|<form/);
    assert.ok(!initial.includes(flow.original.publication.snapshot.claims[0].assertion));
    flow.setCurrent(flow.original);
    const recovered = await flow.visit(action.href);
    assert.equal(flow.calls.length, 2, 'explicit navigation makes one fresh provider read');
    assert.ok(recovered.includes(flow.original.publication.snapshot.claims[0].assertion));
    assert.equal(retry(recovered), undefined);
    assert.deepEqual(flow.calls, [flow.original.requestedRoute, flow.original.requestedRoute]);
  });
}

test('presenter admits only a checked route and never borrows inherited selectors', () => {
  const valid = sample().requestedRoute;
  const invalid = [undefined, null, '', [], {}, Object.create(valid),
    { ...valid, issueSlug: '../private' }, { ...valid, jurisdictionSlug: 'norway?edition=private' },
    { ...valid, issueSlug: `${valid.issueSlug}#private` }, { ...valid, edition: 'PRIVATE' },
    { ...valid, get issueSlug() { throw new Error('PRIVATE_GETTER'); } }];
  for (const status of [404, 503]) for (const retryRoute of invalid) {
    const html = render({ decision: held(status), retryRoute });
    assert.equal(retry(html), undefined);
    assert.doesNotMatch(html, /PRIVATE|edition=|\.\.\/private/);
    assert.ok(html.includes('Browse the illustrative cases'));
  }
});

test('presenter captures changing route getters once without leaking later values', () => {
  const route = sample().requestedRoute;
  let countryReads = 0, issueReads = 0;
  const retryRoute = { get jurisdictionSlug() { return countryReads++ === 0 ? route.jurisdictionSlug : 'PRIVATE_COUNTRY'; },
    get issueSlug() { return issueReads++ === 0 ? route.issueSlug : 'PRIVATE_ISSUE'; } };
  const html = render({ decision: held(503), retryRoute });
  assert.equal(retry(html)?.href, base(route));
  assert.equal(countryReads, 1); assert.equal(issueReads, 1);
  assert.doesNotMatch(html, /PRIVATE/);
});

test('withheld decisions never expose an attached private issue body or diagnostic', () => {
  const retryRoute = sample().requestedRoute;
  for (const status of [404, 503]) {
    const decision = { ...held(status), private: 'PRIVATE_DIAGNOSTIC',
      get issue() { assert.fail('A withheld decision cannot inspect a private issue'); } };
    const html = render({ decision, retryRoute });
    assert.equal(retry(html)?.href, base(retryRoute));
    assert.doesNotMatch(html, /PRIVATE_DIAGNOSTIC|Definition:|edition=/);
  }
  assert.equal(retry(render({ decision: held(500), retryRoute })), undefined);
});

test('base page preserves its checked route across the awaited reader', async () => {
  const route = sample().requestedRoute;
  const params = { country: route.jurisdictionSlug, issue: route.issueSlug };
  let calls = 0;
  const Page = pageFor(async selected => {
    calls++; assert.deepEqual(selected, route); assert.ok(Object.isFrozen(selected));
    params.country = 'PRIVATE_COUNTRY'; params.issue = 'PRIVATE_ISSUE';
    await Promise.resolve(); return held(503);
  });
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve(params), searchParams: Promise.resolve({}) }));
  assert.equal(calls, 1); assert.equal(retry(html)?.href, base(route));
  assert.doesNotMatch(html, /PRIVATE/);
});

test('production and test environments refuse before selectors or the reader', async () => {
  for (const environment of ['production', 'test']) {
    let reads = 0;
    const Page = pageFor(async () => { reads++; return held(503); }, environment);
    await assert.rejects(Page({ get params() { assert.fail('Must refuse before params'); },
      get searchParams() { assert.fail('Must refuse before query'); } }), /NOT_FOUND/);
    assert.equal(reads, 0);
  }
});

test('invalid scope and carried query context refuse without reading or offering recovery', async () => {
  const route = sample().requestedRoute;
  const valid = { country: route.jurisdictionSlug, issue: route.issueSlug };
  let reads = 0;
  const Page = pageFor(async () => { reads++; return held(503); });
  for (const params of [Object.create(valid), { ...valid, issue: '../private' }, { ...valid, edition: 'PRIVATE' }]) {
    await assert.rejects(Page({ params: Promise.resolve(params),
      get searchParams() { assert.fail('Invalid scope must not inspect query'); } }), /NOT_FOUND/);
  }
  for (const searchParams of [{ edition: 'PRIVATE' }, { returnTo: 'PRIVATE' }, { returnAnchor: 'PRIVATE' }, { q: 'PRIVATE' }])
    await assert.rejects(Page({ params: Promise.resolve(valid), searchParams: Promise.resolve(searchParams) }), /NOT_FOUND/);
  assert.equal(reads, 0);
});
