import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { sample } from './helpers/public_read_rows_fixture.mjs';
import { canonicalPublicIssueRoute, createPublicIssueReader } from '../src/server/public-issue-reader.ts';

// Actual development routes, checked row materializer, presenters and glossary;
// only the unconfigured candidate-provider seam is supplied with invented bytes.
const origin = 'https://example.invalid';
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const links = html => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(match => ({
  ...Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attr => [attr[1], attr[2].replaceAll('&amp;', '&')])), text: match[2],
}));
const query = href => Object.fromEntries(new URL(href, origin).searchParams);
const Guide = loadTsx(new URL('../app/methodology/glossary/page.tsx', import.meta.url)).default;
function journey() {
  const original = sample();
  let current = original;
  const calls = [];
  const read = createPublicIssueReader(async route => { calls.push(route); return bytes(current); }, undefined, () => {});
  const intercept = name => {
    if (name === 'next/navigation') return { notFound() { assert.fail('Valid development page refused'); }, unstable_rethrow() {} };
    if (name.endsWith('public-issue-reader')) return { canonicalPublicIssueRoute, readPublicIssue: read };
  };
  const base = loadTsx(new URL('../app/reader-preview/[country]/[issue]/page.tsx', import.meta.url), intercept).default;
  const returned = loadTsx(new URL('../app/reader-preview/[country]/[issue]/[view]/page.tsx', import.meta.url), intercept).default;
  const route = original.requestedRoute;
  return { original, calls, setCurrent(value) { current = value; }, read,
    async enter() { return renderToStaticMarkup(await base({ params: Promise.resolve({ country: route.jurisdictionSlug, issue: route.issueSlug }), searchParams: Promise.resolve({}) })); },
    async returnTo(href) { return renderToStaticMarkup(await returned({ params: Promise.resolve({ country: route.jurisdictionSlug, issue: route.issueSlug, view: 'issue' }), searchParams: Promise.resolve(query(href)) })); },
    expected: `/reader-preview/${route.jurisdictionSlug}/${route.issueSlug}/issue?edition=${original.publication.id}`,
  };
}
async function referenceReturn(flow) {
  const initial = await flow.enter();
  const definition = links(initial).find(link => link.text === 'Definition: Supports this wording');
  assert.ok(definition);
  const selected = query(definition.href);
  assert.equal(selected.returnTo, flow.expected);
  const anchor = `reference-${flow.original.claims[0].id}-1`;
  assert.equal(selected.returnAnchor, anchor);
  const guide = renderToStaticMarkup(await Guide({ searchParams: Promise.resolve(selected) }));
  const back = links(guide).find(link => link.text === 'Back to the selected dossier');
  assert.equal(back?.href, `${flow.expected}#${anchor}`);
  assert.equal(flow.calls.length, 1, 'explanatory rendering performs no dossier read');
  return back.href;
}

test('direct reader definitions, dates and methodology retain the checked edition', async () => {
  const flow = journey(), html = await flow.enter();
  const definitions = links(html).filter(link => link.href?.startsWith('/methodology/glossary'));
  assert.ok(definitions.length >= 10);
  for (const definition of definitions) assert.equal(query(definition.href).returnTo, flow.expected, definition.text);
  const method = links(html).find(link => link.text === 'Read the evidence method');
  assert.equal(new URL(method.href, origin).pathname, '/methodology');
  assert.deepEqual(query(method.href), { returnTo: flow.expected });
  assert.deepEqual(flow.calls, [flow.original.requestedRoute]);
});

test('direct reader reference definition returns to the same edition and reference after one fresh read', async () => {
  const flow = journey(), back = await referenceReturn(flow), html = await flow.returnTo(back);
  assert.equal(flow.calls.length, 2);
  assert.ok(html.includes(flow.original.publication.snapshot.claims[0].assertion));
  assert.ok(html.includes(`id="reference-${flow.original.claims[0].id}-1"`));
});

test('definition return with a different current publication withholds the earlier wording', async () => {
  const flow = journey(), back = await referenceReturn(flow);
  const oldId = flow.original.publication.id, newId = '77777777-7777-4777-8777-777777777777';
  const updated = JSON.parse(JSON.stringify(flow.original).replaceAll(oldId, newId));
  flow.setCurrent(updated);
  assert.equal((await flow.read(updated.requestedRoute)).status, 200, 'replacement is independently materialized as eligible');
  const html = await flow.returnTo(back);
  assert.equal(flow.calls.length, 3);
  assert.match(html, /A newer publication is available/);
  assert.ok(!html.includes(flow.original.publication.snapshot.claims[0].assertion));
  assert.ok(!html.includes(`id="reference-${flow.original.claims[0].id}-1"`));
});

test('definition return never restores earlier claims after an absent or invalid fresh read', async () => {
  for (const [value, label] of [[null, 'No eligible issue found'], [{ private: 'UNEXPOSED' }, 'Issue temporarily unavailable']]) {
    const flow = journey(), back = await referenceReturn(flow);
    flow.setCurrent(value);
    const html = await flow.returnTo(back);
    assert.equal(flow.calls.length, 2);
    assert.ok(html.includes(label));
    assert.ok(!html.includes(flow.original.publication.snapshot.claims[0].assertion));
    assert.ok(!html.includes('UNEXPOSED'));
  }
});

test('withheld direct reader offers a generic method without stale edition or reference context', async () => {
  for (const value of [null, { private: 'UNEXPOSED' }]) {
    const flow = journey(); flow.setCurrent(value);
    const html = await flow.enter(), method = links(html).find(link => link.text === 'Read the evidence method');
    assert.equal(method?.href, '/methodology');
    assert.doesNotMatch(html, /returnTo=|edition=|UNEXPOSED|Definition:/);
    assert.equal(flow.calls.length, 1);
  }
});
