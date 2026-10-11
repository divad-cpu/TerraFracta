import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { currentCatalogueSelection } from '../src/current-visitor-catalog.ts';
import { currentIssueSelection, currentCatalogueIssueHref } from '../src/current-issue-navigation.ts';
import { auditBrowseSelection } from '../src/operator-audit-navigation.ts';
import { heldBrowseSelection } from '../src/operator-held-browse.ts';
import { proposalBrowseSelection } from '../src/operator-proposal-navigation.ts';
import { parsePublicIssueProjection } from '../src/public-issue-projection.ts';
import { syntheticReadRows } from '../app/evidence-preview/example.ts';
const id = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const native = createRequire(import.meta.url);
function changing(first, later, firstValue, ownValue, inheritedValue, hide = false) {
  const input = Object.create({ [later]: inheritedValue });
  Object.defineProperty(input, first, { enumerable: true, get() {
    if (hide) Object.defineProperty(input, later, { enumerable: false }); else delete input[later];
    return firstValue;
  } });
  Object.defineProperty(input, later, { configurable: true, enumerable: true, value: ownValue });
  return input;
}
test('current directory cannot borrow a deleted own country or topic selector', () => {
  for (const hide of [false, true]) assert.equal(currentCatalogueSelection(changing('q', 'country', 'Norway', '', 'norway', hide)), null);
});
test('current dossier cannot borrow a deleted own edition or statement filter', () => {
  assert.equal(currentIssueSelection('sources', changing('q', 'edition', 'example', id(1), id(2))), null);
  assert.equal(currentIssueSelection('sources', changing('q', 'type', 'example', '', 'condition')), null);
});
test('audit selection refuses a missing later own issue instead of selecting an inherited private target', () => {
  for (const hide of [false, true]) assert.equal(auditBrowseSelection(changing('runId', 'issueId', id(1), id(2), id(3), hide)), null);
});
test('held selection cannot borrow an inherited reason after its owned field disappears', () => {
  assert.equal(heldBrowseSelection(changing('runId', 'reason', id(1), '', 'material_conflict')), null);
});
test('proposal selection cannot borrow a deleted decision reference', () => {
  assert.equal(proposalBrowseSelection(changing('runId', 'decisionId', id(1), id(2), id(3))), null);
});
test('directory return serialization refuses disappeared own context without adding a filter', () => {
  const envelope = structuredClone(syntheticReadRows.envelope);
  envelope.publication.snapshot.jurisdictionSlug = 'norway'; envelope.publication.snapshot.issueSlug = 'housing-costs';
  const issue = parsePublicIssueProjection(envelope);
  issue.jurisdictionSlug = 'norway'; issue.issueSlug = 'housing-costs';
  const selection = changing('view', 'country', 'countries', '', 'norway');
  Object.assign(selection, { query: '', topic: '', publicationId: issue.publicationId });
  const href = currentCatalogueIssueHref(issue, 'issue', selection);
  assert.equal(href, `/reader-preview/norway/housing-costs/issue?edition=${issue.publicationId}`);
});
function page(route, portName, ports) {
  return loadTsx(new URL(`../app/${route}/page.tsx`, import.meta.url), name => {
    if (name === 'next/navigation') return { ...native('next/navigation'), notFound() { throw Error('NEXT_REFUSAL'); } };
    if (name.includes(portName)) return ports;
  }, { env: { NODE_ENV: 'development' } }).default;
}
test('recorded run choice rejects disappearing own cursor before private read', async () => {
  let calls = 0;
  const actual = native('../src/server/operator-audit-choices-reader.ts');
  const Page = page('editorial-preview/audit/select', '/server/operator-audit-choices-reader', { ...actual,
    readOperatorAuditChoices() { calls++; return { kind: 'unconfigured' }; } });
  const input = changing('runId', 'beforeRunId', id(1), id(2), id(3));
  input.beforeCreatedAt = '2026-10-05T09:00:00.000001Z';
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(input) }));
  assert.equal(calls, 0); assert.ok(html.includes('Choose a recorded run')); assert.doesNotMatch(html, /PRIVATE_CANARY/);
});
test('actual audit page rejects disappeared own issue before selecting a private reader scope', async () => {
  let calls = 0;
  const actual = native('../src/server/operator-audit-reader.ts');
  const Page = page('editorial-preview/audit', '/server/operator-audit-reader', { ...actual,
    readOperatorAudit() { calls++; return { kind: 'unconfigured' }; } });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(changing('runId', 'issueId', id(1), id(2), id(3))) }));
  assert.equal(calls, 0); assert.ok(html.includes('Choose a recorded run and issue'));
});
test('each admitted own getter is observed once with its caller as receiver and grammar unchanged', () => {
  for (const [select, fields, key] of [[currentCatalogueSelection, { view: 'issues', country: 'norway', topic: 'housing' }, 'q'],
    [q => currentIssueSelection('sources', q), { edition: id(1), type: 'condition', relation: 'supports' }, 'q'],
    [auditBrowseSelection, { issueId: id(2) }, 'runId'], [heldBrowseSelection, { reason: 'material_conflict' }, 'runId'],
    [proposalBrowseSelection, { decisionId: id(2) }, 'runId']]) {
    let reads = 0; const input = { ...fields };
    Object.defineProperty(input, key, { enumerable: true, get() { assert.equal(this, input); reads++; return key === 'q' ? 'Norway' : id(1); } });
    assert.ok(select(input)); assert.equal(reads, 1);
    assert.equal(select({ ...fields, [key]: ['PRIVATE_CANARY'] }), null);
  }
});
test('unknown and partial tuples veto before getters while inherited absent selectors stay absent', () => {
  for (const select of [currentCatalogueSelection, q => currentIssueSelection('sources', q), auditBrowseSelection, heldBrowseSelection, proposalBrowseSelection]) {
    assert.equal(select({ unknown: '', get runId() { assert.fail('Unsupported grammar reads no admitted fields'); } }), null);
  }
  assert.equal(heldBrowseSelection({ get runId() { assert.fail('Partial tuple must veto first'); }, beforeDecisionId: id(2) }), null);
  assert.equal(currentCatalogueSelection(Object.create({ country: 'norway' })).country, '');
  assert.equal(currentIssueSelection('sources', Object.create({ edition: id(1), type: 'condition' })).publicationId, null);
  assert.equal(auditBrowseSelection(Object.assign(Object.create({ issueId: id(2) }), { runId: id(1) })), null);
});
