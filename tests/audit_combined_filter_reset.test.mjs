import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { audit, id, scope, bytes } from './helpers/operator_audit_fixture.mjs';
import { createOperatorAuditReader } from '../src/server/operator-audit-reader.ts';

// Native byte admission and installed React server rendering, with only the
// explicit provider port substituted. This does not exercise Browser or HTTP.
const navigation = createRequire(import.meta.url)('next/navigation');
const attrs = text => Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2].replaceAll('&amp;', '&')]));
const links = html => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m => ({ ...attrs(m[1]), text: m[2] }));
const target = (html, label) => links(html).find(link => link.text === label)?.href ?? assert.fail(`Missing ${label}`);
const query = href => Object.fromEntries(new URL(href, 'https://example.invalid').searchParams);
const returned = () => ({ returnToRuns: '1', returnBeforeCreatedAt: '2026-10-05T09:30:00.000001Z', returnBeforeRunId: id(99) });
const selected = () => ({ runId: id(1), issueId: id(2), latestRevision: '2', headPublicationId: id(6), beforeRevision: '2', ...returned(), outcome: 'unchanged', publicationKind: 'accepted' });
function envelope(s) {
  const report = audit(); report.requested = structuredClone(s);
  if (s.cursor) report.history.publications = report.history.publications.filter(row => row.revision < s.cursor.beforeRevision);
  return report;
}
function harness(produce) {
  const calls = [], decisions = [], diagnostics = [];
  const provider = produce === undefined ? undefined : async (s, signal) => {
    calls.push({ scope: structuredClone(s), frozen: Object.isFrozen(s), cursorFrozen: s.cursor === null || Object.isFrozen(s.cursor), signal });
    const value = await produce(s, calls.length); return value instanceof Uint8Array ? value : bytes(value);
  };
  const read = createOperatorAuditReader(provider, () => 0, code => diagnostics.push(code));
  const Page = loadTsx(new URL('../app/editorial-preview/audit/page.tsx', import.meta.url), name => name === 'next/navigation' ? { unstable_rethrow: navigation.unstable_rethrow, notFound() { assert.fail('Unexpected development refusal'); } } : name.endsWith('/server/operator-audit-reader.ts') ? { readOperatorAudit: async s => { const d = await read(s); decisions.push(d.kind); return d; } } : undefined).default;
  return { calls, decisions, diagnostics, render: async q => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(q) })) };
}

test('combined reset retains the exact checked history page and separate run-list return on a new read', async () => {
  const h = harness(s => envelope(s)), q = selected(), first = await h.render(q);
  assert.match(first, /Showing 1 of 1 stored revisions/);
  const reset = query(target(first, 'Clear both audit filters'));
  const { outcome, publicationKind, ...expected } = q;
  assert.deepEqual(reset, expected);
  const second = await h.render(reset);
  assert.match(second, /fictional:source/); assert.match(second, /Revision 1 · Accepted/);
  assert.doesNotMatch(second, /aria-label="Active audit filters"|Clear both audit filters/);
  assert.deepEqual(h.calls.map(row => row.scope), [scopeWithCursor(), scopeWithCursor()]);
  assert.ok(h.calls.every(row => row.frozen && row.cursorFrozen && row.signal.aborted));
  assert.deepEqual(h.decisions, ['ok', 'ok']); assert.deepEqual(h.diagnostics, []);
  assert.deepEqual(query(target(second, 'Back to selected recorded-run page')), { runId: id(1), beforeCreatedAt: returned().returnBeforeCreatedAt, beforeRunId: id(99) });
  assert.match(first, /Historical check outcome: Unchanged/); assert.match(first, /Stored publication kind: Accepted/);
  assert.match(second, /does not establish current public eligibility/);
});
function scopeWithCursor() { return { ...scope(), cursor: { latestRevision: 2, headPublicationId: id(6), beforeRevision: 2 } }; }

test('both empty presentation results can reset without widening the history page or inventing public visibility', async () => {
  const h = harness(s => envelope(s)), q = { ...selected(), outcome: 'failed', publicationKind: 'suppression' }, first = await h.render(q);
  assert.match(first, /No matching historical check outcome/); assert.match(first, /No matching stored publication kind/);
  assert.doesNotMatch(first, /id="recorded-publication-/);
  const reset = query(target(first, 'Clear both audit filters')), second = await h.render(reset);
  assert.match(second, /Revision 1 · Accepted/); assert.doesNotMatch(second, /Revision 2 · Correction/);
  assert.deepEqual(h.calls.map(row => row.scope), [scopeWithCursor(), scopeWithCursor()]);
  assert.match(second, /The stored head is outside this page of revisions/);
  assert.match(second, /These stored run states do not establish current source health/);
});

test('combined reset on the newest page has no invented history cursor or run-list return', async () => {
  const h = harness(s => envelope(s)), q = { runId: id(1), issueId: id(2), outcome: 'unchanged', publicationKind: 'accepted' }, first = await h.render(q);
  const reset = query(target(first, 'Clear both audit filters'));
  assert.deepEqual(reset, { runId: id(1), issueId: id(2) });
  const second = await h.render(reset); assert.match(second, /Revision 2 · Correction/);
  assert.deepEqual(h.calls.map(row => row.scope), [scope(), scope()]); assert.deepEqual(h.diagnostics, []);
});

test('single or absent filters retain existing independent clear controls without a combined action', async () => {
  for (const filters of [{}, { outcome: 'unchanged' }, { publicationKind: 'accepted' }]) {
    const h = harness(s => envelope(s)), html = await h.render({ runId: id(1), issueId: id(2), ...filters });
    assert.doesNotMatch(html, /aria-label="Active audit filters"|Clear both audit filters/);
    if (filters.outcome) assert.deepEqual(query(target(html, 'Clear source outcome filter')), { runId: id(1), issueId: id(2) });
    if (filters.publicationKind) assert.deepEqual(query(target(html, 'Clear publication kind filter')), { runId: id(1), issueId: id(2) });
    assert.deepEqual(h.decisions, ['ok']);
  }
});

test('following combined reset rechecks changed, unavailable and unconfigured records instead of keeping old details', async () => {
  const accepted = harness(s => envelope(s)), reset = query(target(await accepted.render(selected()), 'Clear both audit filters'));
  for (const [produce, kind] of [[s => ({ schemaVersion: 1, status: 'changed', requested: s }), 'changed'], [() => { throw new Error('PRIVATE_CANARY'); }, 'unavailable'], [undefined, 'unconfigured']]) {
    const h = harness(produce), html = await h.render(reset);
    assert.deepEqual(h.decisions, [kind]);
    assert.doesNotMatch(html, /fictional:source|id="recorded-publication-|Revision [0-9]+ ·|PRIVATE_CANARY|Clear both audit filters/);
    const fresh = query(target(html, 'Start a fresh audit'));
    assert.deepEqual(fresh, { runId: id(1), issueId: id(2), ...returned() });
    assert.deepEqual(h.calls.map(row => row.scope), kind === 'unconfigured' ? [] : [scopeWithCursor()]);
    assert.deepEqual(h.diagnostics, kind === 'unavailable' ? ['operator_audit_read'] : []);
  }
});

test('malformed combined filter selectors are refused before reading records or showing reset context', async () => {
  for (const bad of [{ outcome: ['unchanged', 'failed'] }, { publicationKind: 'ACCEPTED' }, { foreign: 'PRIVATE_CANARY' }]) {
    const h = harness(s => envelope(s)), html = await h.render({ ...selected(), ...bad });
    assert.deepEqual(h.calls, []); assert.deepEqual(h.decisions, []);
    assert.match(html, /Choose a recorded run and issue/);
    assert.doesNotMatch(html, /fictional:source|id="recorded-publication-|Clear both audit filters|PRIVATE_CANARY/);
  }
});
