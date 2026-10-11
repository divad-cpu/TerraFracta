import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { currentCatalogueSelection } from '../src/current-visitor-catalog.ts';
import { currentIssueSelection } from '../src/current-issue-navigation.ts';
import { auditBrowseSelection } from '../src/operator-audit-navigation.ts';
import { heldBrowseSelection } from '../src/operator-held-browse.ts';
import { proposalBrowseSelection } from '../src/operator-proposal-navigation.ts';
import { findIllustrativeIssues, findIllustrativeCountries, sampleCorrectionSection } from '../src/visitor-catalog.ts';
import { findGlossaryTerms } from '../src/evidence-glossary.ts';
import { readingExplanationReturn } from '../src/current-reading-guide.ts';
const native = createRequire(import.meta.url), navigation = native('next/navigation');
const { DynamicServerError } = native('next/dist/client/components/hooks-server-context');
const id = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const specs = [
  ['methodology/glossary', 'q', {}, 'Check your search'], ['methodology', 'returnTo', {}, 'How TerraFracta reads an issue'],
  ['sources', 'returnTo', {}, 'What a source should tell you'], ['issues', 'q', {}, 'Check your search'],
  ['countries', 'q', {}, 'Check your search'], ['corrections', 'section', {}, 'Check the draft link'],
  ['reader-preview/catalogue', 'q', {}, 'Check the directory link'], ['reader-preview/[country]/[issue]/[view]', 'q', {}, null],
  ['editorial-preview/audit', 'issueId', { runId: id(1) }, 'Choose a recorded run and issue'],
  ['editorial-preview/held', 'reason', { runId: id(1) }, 'Choose a recorded run'],
  ['editorial-preview/held/proposal', 'decisionId', { runId: id(1) }, 'Choose a recorded decision'],
  ['editorial-preview/audit/select', 'runId', {}, 'Choose a recorded run'],
];
const NOT_FOUND = Symbol('route refusal');
function signal(kind = 'dynamic') {
  if (kind === 'dynamic') return new DynamicServerError('invented selector control');
  try { if (kind === 'redirect') navigation.redirect('https://example.invalid/'); else navigation.notFound(); } catch (error) { return error; }
  assert.fail('Installed control API must throw');
}
function harness(index, readerFailure) {
  const calls = [], classified = [];
  const Page = loadTsx(new URL(`../app/${specs[index][0]}/page.tsx`, import.meta.url), name => {
    if (name === 'next/navigation') return { ...navigation, notFound() { throw NOT_FOUND; },
      unstable_rethrow(error) { classified.push(error); navigation.unstable_rethrow(error); } };
    if (name.includes('/server/current-visitor-catalog')) {
      const actual = native('../src/server/current-visitor-catalog.ts');
      return { loadCurrentVisitorCatalogue: (...args) => actual.loadCurrentVisitorCatalogue(args[0], async route => {
        calls.push(route); if (readerFailure) throw readerFailure; return { status: 503, cacheControl: 'no-store' };
      }, args[2], args[3] ?? (() => {}), args[4]) };
    }
    if (name.includes('/server/public-issue-reader')) return { canonicalPublicIssueRoute: value => value, readPublicIssue: async route => {
      calls.push(route); return { status: 503, cacheControl: 'no-store' };
    } };
    for (const [fragment, exported] of [['operator-audit-reader', 'readOperatorAudit'], ['operator-held-decisions-reader', 'readHeldDecisions'],
      ['operator-proposal-reader', 'readCapturedProposal'], ['operator-audit-choices-reader', 'readOperatorAuditChoices']]) {
      if (name.includes(`/server/${fragment}`)) return { ...native(`../src/server/${fragment}.ts`), [exported]: async (...args) => {
        calls.push(args); if (readerFailure) throw readerFailure; return { kind: 'unconfigured' };
      } };
    }
  }, { env: { NODE_ENV: 'development' } }).default;
  return { calls, classified, render: async input => renderToStaticMarkup(await Page({ params: Promise.resolve({ country: 'norway', issue: 'housing-costs', view: 'sources' }), searchParams: Promise.resolve(input) })) };
}
function faultInput(i, error, enumeration = false) {
  if (enumeration) return new Proxy({ ...specs[i][2] }, { ownKeys() { throw error; } });
  let reads = 0; const input = { ...specs[i][2] };
  Object.defineProperty(input, specs[i][1], { enumerable: true, get() { reads++; throw error; } });
  return { input, reads: () => reads };
}
test('guide and explanatory field observation preserve installed Next control identity', async () => {
  for (const i of [0, 1, 2]) for (const kind of ['dynamic', 'notFound', 'redirect']) {
    const h = harness(i), error = signal(kind), f = faultInput(i, error);
    await assert.rejects(h.render(f.input), observed => observed === error); assert.equal(f.reads(), 1); assert.deepEqual(h.calls, []);
  }
});
test('illustrative selector field observation preserves control identity without opening a draft', async () => {
  for (const i of [3, 4, 5]) { const h = harness(i), error = signal(), f = faultInput(i, error);
    await assert.rejects(h.render(f.input), observed => observed === error); assert.equal(f.reads(), 1); assert.deepEqual(h.calls, []); }
});
test('current directory and dossier selector field observation preserves control identity before reading', async () => {
  for (const i of [6, 7]) { const h = harness(i), error = signal(), f = faultInput(i, error);
    await assert.rejects(h.render(f.input), observed => observed === error); assert.equal(f.reads(), 1); assert.deepEqual(h.calls, []); }
});
test('private audit held proposal and run-choice fields preserve control identity before record selection', async () => {
  for (const i of [8, 9, 10, 11]) { const h = harness(i), error = signal(), f = faultInput(i, error);
    await assert.rejects(h.render(f.input), observed => observed === error); assert.equal(f.reads(), 1); assert.deepEqual(h.calls, []); }
});
test('enumeration and wrapped own-field framework controls propagate while ordinary faults keep existing invalid outcomes', async () => {
  for (const i of specs.keys()) {
    const h = harness(i), error = signal();
    await assert.rejects(h.render(faultInput(i, error, true)), observed => observed === error); assert.deepEqual(h.calls, []);
    const nested = signal('notFound'), f = faultInput(i, new Error('invented wrapper', { cause: nested }));
    await assert.rejects(h.render(f.input), observed => observed === nested); assert.equal(f.reads(), 1); assert.deepEqual(h.calls, []);
    const ordinary = faultInput(i, Error('PRIVATE_CANARY'));
    if (specs[i][3] === null) await assert.rejects(h.render(ordinary.input), observed => observed === NOT_FOUND);
    else { const html = await h.render(ordinary.input); assert.ok(html.includes(specs[i][3]), specs[i][0]); assert.doesNotMatch(html, /PRIVATE_CANARY|<textarea|Back to the selected dossier/); }
    assert.equal(ordinary.reads(), 1); assert.deepEqual(h.calls, []);
  }
});
test('pure selectors keep their ordinary refusal contract when no trusted framework handler is supplied', () => {
  const cases = [
    [q => currentCatalogueSelection(q), 'q', {}], [q => currentIssueSelection('sources', q), 'q', {}],
    [auditBrowseSelection, 'issueId', { runId: id(1) }], [heldBrowseSelection, 'reason', { runId: id(1) }],
    [proposalBrowseSelection, 'decisionId', { runId: id(1) }], [readingExplanationReturn, 'returnTo', {}],
    [findGlossaryTerms, 'q', {}], [findIllustrativeIssues, 'q', {}], [findIllustrativeCountries, 'q', {}], [sampleCorrectionSection, 'section', {}],
  ];
  for (const [select, field, fields] of cases) { let reads = 0; const query = { ...fields };
    Object.defineProperty(query, field, { enumerable: true, get() { reads++; throw signal(); } });
    const result = select(query); assert.equal(reads, 1); assert.ok(result === null || result === 'invalid' || result.kind === 'invalid'); }
});
test('private record and catalogue provider failures retain curated unavailable states without selector classification', async () => {
  for (const [i, input] of [[6, {}], [8, { runId: id(1), issueId: id(2) }], [9, { runId: id(1) }],
    [10, { runId: id(1), decisionId: id(2) }], [11, {}]]) {
    const h = harness(i, signal()), html = await h.render(input); assert.equal(h.calls.length, 1);
    assert.doesNotMatch(html, /invented selector control|PRIVATE_CANARY/);
  }
});
test('normal owned query getters stay single observations with the installed trusted handler', () => {
  const handler = error => { assert.fail('A valid selector cannot classify an error'); };
  const cases = [[q => currentCatalogueSelection(q, undefined, handler), 'q', {}], [q => currentIssueSelection('sources', q, handler), 'q', {}],
    [q => auditBrowseSelection(q, handler), 'issueId', { runId: id(1) }], [q => heldBrowseSelection(q, handler), 'reason', { runId: id(1) }],
    [q => proposalBrowseSelection(q, handler), 'decisionId', { runId: id(1) }], [q => findGlossaryTerms(q, handler), 'q', {}],
    [q => findIllustrativeIssues(q, handler), 'q', {}], [q => findIllustrativeCountries(q, handler), 'q', {}], [q => sampleCorrectionSection(q, handler), 'section', {}]];
  for (const [select, field, fields] of cases) { let reads = 0; const query = { ...fields };
    Object.defineProperty(query, field, { enumerable: true, get() { reads++; assert.equal(this, query);
      return field === 'q' ? 'Norway' : field === 'section' ? 'problem' : field === 'reason' ? '' : id(2); } });
    assert.ok(select(query)); assert.equal(reads, 1); }
});
test('provider control-looking faults render each exact curated unavailable outcome and are never classified', async () => {
  for (const [i, input, label] of [[6, {}, 'Current directory unavailable'], [8, { runId: id(1), issueId: id(2) }, 'Recorded audit unavailable'],
    [9, { runId: id(1) }, 'Held decisions unavailable'], [10, { runId: id(1), decisionId: id(2) }, 'Proposal unavailable'], [11, {}, 'Recorded choices unavailable']]) {
    const h = harness(i, signal()), html = await h.render(input); assert.equal(h.calls.length, 1); assert.deepEqual(h.classified, []);
    assert.ok(html.includes(label)); assert.doesNotMatch(html, /invented selector control|PRIVATE_CANARY/);
  }
});
