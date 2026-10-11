import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { awaitRouteSelectors } from '../src/await-route-selectors.ts';
const native = createRequire(import.meta.url), navigation = native('next/navigation');
const { DynamicServerError } = native('next/dist/client/components/hooks-server-context');
const specs = [
  ['methodology/glossary', 'Check your search'], ['methodology', 'How TerraFracta reads an issue'], ['sources', 'What a source should tell you'],
  ['issues', 'Check your search'], ['countries', 'Check your search'], ['corrections', 'Check the draft link'],
  ['reader-preview/catalogue', 'Check the directory link'], ['reader-preview/[country]/[issue]', null], ['reader-preview/[country]/[issue]/[view]', null],
  ['editorial-preview/audit', 'Choose a recorded run and issue'], ['editorial-preview/audit/select', 'Choose a recorded run'],
  ['editorial-preview/held', 'Choose a recorded run'], ['editorial-preview/held/proposal', 'Choose a recorded decision'],
];
const NOT_FOUND = Symbol('production or invalid route boundary');
function signal(kind) {
  if (kind === 'dynamic') return new DynamicServerError('invented selector control');
  try { if (kind === 'redirect') navigation.redirect('https://example.invalid/'); else navigation.notFound(); } catch (error) { return error; }
  assert.fail('Installed Next API did not throw its control signal');
}
function harness(i, env = 'development') {
  const calls = [];
  const Page = loadTsx(new URL(`../app/${specs[i][0]}/page.tsx`, import.meta.url), name => {
    if (name === 'next/navigation') return { ...navigation, notFound() { throw NOT_FOUND; } };
    if (name.includes('/server/public-issue-reader')) return { canonicalPublicIssueRoute: value => value, readPublicIssue() { calls.push('public'); assert.fail('No current read before selector admission'); } };
    if (name.includes('/server/current-visitor-catalog')) return { loadCurrentVisitorCatalogue: async value => { calls.push('catalogue'); const actual = native('../src/server/current-visitor-catalog.ts'); return actual.loadCurrentVisitorCatalogue(value, () => { calls.push('public'); assert.fail('No invalid current reader call'); }); } };
    for (const [fragment, exported] of [['operator-audit-reader', 'readOperatorAudit'], ['operator-audit-choices-reader', 'readOperatorAuditChoices'], ['operator-held-decisions-reader', 'readHeldDecisions'], ['operator-proposal-reader', 'readCapturedProposal']]) {
      if (name.includes(`/server/${fragment}`)) return { ...native(`../src/server/${fragment}.ts`), [exported]() { calls.push(exported); assert.fail('No private read before selector admission'); } };
    }
  }, { env: { NODE_ENV: env } }).default;
  return { calls, render: async searchParams => renderToStaticMarkup(await Page({ params: Promise.resolve({ country: 'norway', issue: 'housing-costs', ...(i === 8 ? { view: 'sources' } : {}) }), searchParams })) };
}
test('public reading-guide query preserves actual installed Next control errors instead of rendering default explanation', async () => {
  for (const i of [0, 1, 2]) for (const kind of ['notFound', 'redirect', 'dynamic']) {
    const h = harness(i), error = signal(kind); await assert.rejects(h.render(Promise.reject(error)), observed => observed === error); assert.deepEqual(h.calls, []);
  }
});
test('private editorial selectors preserve Next control errors before any record read', async () => {
  for (const i of [9, 10, 11, 12]) for (const kind of ['notFound', 'redirect', 'dynamic']) {
    const h = harness(i), error = signal(kind); await assert.rejects(h.render(Promise.reject(error)), observed => observed === error); assert.deepEqual(h.calls, []);
  }
});
test('current reader and illustrative pages preserve control errors without substituting an invalid link', async () => {
  for (const i of [3, 4, 5, 6, 7, 8]) for (const kind of ['notFound', 'redirect', 'dynamic']) {
    const h = harness(i), error = signal(kind); await assert.rejects(h.render(Promise.reject(error)), observed => observed === error); assert.deepEqual(h.calls, []);
  }
});
test('ordinary failed selectors retain existing detail-free invalid views and current-reader refusal', async () => {
  for (const i of specs.keys()) {
    const h = harness(i);
    if (specs[i][1] === null) await assert.rejects(h.render(Promise.reject(Error('PRIVATE_CANARY'))), error => error === NOT_FOUND);
    else { const html = await h.render(Promise.reject(Error('PRIVATE_CANARY'))); assert.ok(html.includes(specs[i][1]), specs[i][0]); assert.doesNotMatch(html, /PRIVATE_CANARY|Back to the selected dossier|<textarea|Reference 1|recorded-publication-/); }
    assert.deepEqual(h.calls, i === 6 ? ['catalogue'] : []);
  }
});
test('native await box invokes trusted classifier once and preserves null-prototype single-assimilation behavior', async () => {
  let classified = 0; const error = Error('PRIVATE_CANARY');
  const result = await awaitRouteSelectors(Promise.reject(error), observed => { classified++; assert.equal(observed, error); navigation.unstable_rethrow(observed); });
  assert.equal(classified, 1); assert.equal(result.value, null); assert.equal(Object.getPrototypeOf(result), null); assert.ok(Object.isFrozen(result));
  let thenReads = 0; const query = { q: 'Norway' }; Object.defineProperty(query, 'then', { get() { thenReads++; return undefined; } });
  const accepted = await awaitRouteSelectors(query, () => assert.fail('Successful await does not classify')); assert.equal(accepted.value, query); assert.equal(thenReads, 1);
});
test('official classifier preserves a control error nested in an ordinary Error cause', async () => {
  const control = signal('notFound'), wrapped = new Error('invented wrapper', { cause: control });
  for (const i of [0, 6, 7, 9]) { const h = harness(i); await assert.rejects(h.render(Promise.reject(wrapped)), error => error === control); assert.deepEqual(h.calls, []); }
});
test('development-only route refusal still precedes every selector port in production', async () => {
  for (const i of [6, 7, 8, 9, 10, 11, 12]) {
    const h = harness(i, 'production'); let touches = 0;
    await assert.rejects(h.render({ get then() { touches++; assert.fail('Production query touched'); } }), error => error === NOT_FOUND);
    assert.equal(touches, 0); assert.deepEqual(h.calls, []);
  }
});
