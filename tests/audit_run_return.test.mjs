import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { audit, id, scope } from './helpers/operator_audit_fixture.mjs';
import { choices, choiceId } from './helpers/operator_audit_choices_fixture.mjs';
import { operatorAuditReportSchema } from '../src/operator-audit-report.ts';
import { operatorAuditChoicesSchema } from '../src/operator-audit-choices.ts';
const cursor = () => ({ createdAt: '2026-10-05T09:30:00.000001Z', runId: choiceId(99) });
const returnQuery = () => ({ returnToRuns: '1', returnBeforeCreatedAt: cursor().createdAt, returnBeforeRunId: cursor().runId });
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2].replaceAll('&amp;', '&')]));
const href = (html, label) => new URL(html.match(new RegExp(`href="([^"]+)"[^>]*>${label}`))[1].replaceAll('&amp;', '&'), 'https://example.invalid');
const render = (Component, props) => renderToStaticMarkup(Component(props));
const Audit = loadTsx(new URL('../src/operator-audit-view.tsx', import.meta.url)).OperatorAuditView;
const Choices = loadTsx(new URL('../src/operator-audit-choices-view.tsx', import.meta.url)).OperatorAuditChoicesView;
function harness(read = async selected => { const r = audit(); r.requested = structuredClone(selected); r.run.runId = selected.runId; r.history.issueId = selected.issueId; return { kind: 'ok', report: r }; }, mode = 'development') {
  const calls = [], marker = Error('NOT_FOUND');
  const Page = loadTsx(new URL('../app/editorial-preview/audit/page.tsx', import.meta.url), name => name === 'next/navigation' ? { notFound() { throw marker; } } : name === '../../../src/server/operator-audit-reader.ts' ? { readOperatorAudit: async selected => { calls.push(selected); return read(selected); }, canonicalOperatorAuditScope: value => value } : undefined, { env: { NODE_ENV: mode } }).default;
  return { calls, marker, Page, render: async query => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) })) };
}
function selectedChoices(older = true) {
  const r = choices(choiceId(1)); r.requestedCursor = older ? cursor() : null;
  r.runs = Array.from({ length: 20 }, (_, index) => ({ ...r.runs[0], runId: choiceId(20 - index) }));
  r.selectedRun = structuredClone(r.runs.at(-1)); r.moreRuns = true; r.nextCursor = { createdAt: r.runs.at(-1).createdAt, runId: r.runs.at(-1).runId };
  return operatorAuditChoicesSchema.parse(r);
}
function history(selected) {
  const r = audit(); r.requested = structuredClone(selected); r.history.latestRevision = 22; r.history.headRevision = 22; r.history.headPublicationId = id(122);
  const top = selected.cursor === null ? 22 : selected.cursor.beforeRevision - 1, bottom = Math.max(1, top - 19);
  r.history.publications = Array.from({ length: top - bottom + 1 }, (_, index) => { const revision = top - index; return { publicationId: id(100 + revision), revision, supersedesPublicationId: revision === 1 ? null : id(99 + revision), publicationKind: revision === 1 ? 'accepted' : 'correction', createdAt: '2026-10-05T09:03:00Z', isHead: revision === 22 }; });
  r.history.nextCursor = bottom > 1 ? { latestRevision: 22, headPublicationId: id(122), beforeRevision: bottom } : null;
  return { kind: 'ok', report: operatorAuditReportSchema.parse(r) };
}

test('actual issue-choice GET form carries incoming run page rather than the next continuation', () => {
  for (const older of [false, true]) {
    const report = selectedChoices(older), html = render(Choices, { decision: { kind: 'ok', report }, selection: report.requestedRunId, cursor: report.requestedCursor });
    const form = [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)].find(m => m[0].includes('aria-label="Open an audit for the selected run"'))[0], query = Object.fromEntries([...form.matchAll(/<input[^>]*>/g)].map(m => { const a = attrs(m[0]); return [a.name, a.value]; }));
    assert.equal(query.returnToRuns, '1'); assert.equal(query.runId, choiceId(1));
    if (older) { assert.equal(query.returnBeforeCreatedAt, cursor().createdAt); assert.equal(query.returnBeforeRunId, cursor().runId); assert.notEqual(query.returnBeforeRunId, report.nextCursor.runId); }
    else { assert.equal('returnBeforeCreatedAt' in query, false); assert.equal('returnBeforeRunId' in query, false); }
    const attributes = attrs(form.slice(0, form.indexOf('>') + 1)); assert.equal(attributes.method, 'get'); assert.equal(attributes.action, '/editorial-preview/audit');
  }
});

test('actual audit route separates run-list return coordinates from exact private audit read scope', async () => {
  const h = harness(), query = { runId: id(1), issueId: id(2), ...returnQuery() }, html = await h.render(query);
  assert.deepEqual(h.calls, [scope()]); assert.ok(Object.isFrozen(h.calls[0]));
  const back = href(html, 'Back to selected recorded-run page'); assert.equal(back.pathname, '/editorial-preview/audit/select');
  assert.deepEqual(Object.fromEntries(back.searchParams), { runId: id(1), beforeCreatedAt: cursor().createdAt, beforeRunId: cursor().runId });
  assert.match(html, /Returning makes a new read/); assert.match(html, /Recorded audit snapshot/);
});

test('following actual older-publication and fresh-audit links preserves run return but only changes history scope', async () => {
  const h = harness(history), first = await h.render({ runId: id(1), issueId: id(2), ...returnQuery() });
  const older = href(first, 'Older stored revisions'), second = await h.render(Object.fromEntries(older.searchParams));
  assert.deepEqual(h.calls[1], { ...scope(), cursor: { latestRevision: 22, headPublicationId: id(122), beforeRevision: 3 } });
  assert.equal(href(second, 'Back to selected recorded-run page').href, href(first, 'Back to selected recorded-run page').href);
  const fresh = href(second, 'Start a fresh audit'); assert.equal(fresh.searchParams.has('beforeRevision'), false);
  assert.deepEqual(Object.fromEntries(fresh.searchParams), { runId: id(1), issueId: id(2), ...returnQuery() });
  await h.render(Object.fromEntries(fresh.searchParams)); assert.deepEqual(h.calls[2], scope());
});

test('unconfigured, unavailable and thrown audit outcomes retain only independent valid return selection', async () => {
  for (const kind of ['unconfigured', 'unavailable', 'throws']) {
    const h = harness(async () => { if (kind === 'throws') throw Error('PRIVATE_READ_FAULT'); return { kind }; });
    const html = await h.render({ runId: id(1), issueId: id(2), ...returnQuery() });
    assert.deepEqual(h.calls, [scope()]); assert.ok(href(html, 'Back to selected recorded-run page'));
    assert.doesNotMatch(html, /Recorded audit snapshot|fictional:source|PRIVATE_/);
  }
});

test('unknown, duplicate, partial or malformed return controls refuse before any record read', async () => {
  const base = { runId: id(1), issueId: id(2) };
  for (const extra of [{ returnToRuns: '0' }, { returnToRuns: ['1'] }, { returnBeforeCreatedAt: cursor().createdAt, returnBeforeRunId: cursor().runId }, { returnToRuns: '1', returnBeforeCreatedAt: cursor().createdAt }, { returnToRuns: '1', returnBeforeRunId: cursor().runId }, { ...returnQuery(), returnBeforeRunId: 'PRIVATE_INVALID' }, { ...returnQuery(), extra: 'PRIVATE_EXTRA' }]) {
    const h = harness(), html = await h.render({ ...base, ...extra }); assert.deepEqual(h.calls, []);
    assert.match(html, /Choose a recorded run and issue/); assert.doesNotMatch(html, /Back to selected recorded-run page|PRIVATE_/);
  }
});

test('direct foreign or invalid return context creates no link and does not supply audit report identity', () => {
  for (const runReturn of [{ runId: id(9), cursor: cursor() }, { runId: id(1), cursor: { ...cursor(), private: 'PRIVATE_EXTRA' } }, { runId: 'PRIVATE_INVALID', cursor: null }]) {
    const html = render(Audit, { decision: { kind: 'ok', report: audit() }, selection: scope(), runReturn });
    assert.match(html, /Recorded audit snapshot/); assert.doesNotMatch(html, /Back to selected recorded-run page|PRIVATE_/);
  }
  let reads = 0; const poison = new Proxy({}, { get() { reads++; throw Error('PRIVATE_RETURN_FAULT'); } });
  const html = render(Audit, { decision: { kind: 'invalid_scope' }, selection: scope(), runReturn: poison });
  assert.equal(reads, 0); assert.doesNotMatch(html, /Back to selected recorded-run page|PRIVATE_/);
});

test('own return and audit values are captured once while inherited return coordinates stay unobserved', async () => {
  const counts = {}, input = {};
  for (const [key, value] of Object.entries({ runId: id(1), issueId: id(2), ...returnQuery() })) Object.defineProperty(input, key, { enumerable: true, get() { counts[key] = (counts[key] ?? 0) + 1; return counts[key] === 1 ? value : 'PRIVATE_SECOND_VALUE'; } });
  const h = harness(), html = await h.render(input); assert.deepEqual(h.calls, [scope()]);
  assert.deepEqual(Object.values(counts), [1, 1, 1, 1, 1]); assert.ok(href(html, 'Back to selected recorded-run page')); assert.doesNotMatch(html, /PRIVATE_/);
  let inherited = 0; const prototype = Object.defineProperty({}, 'returnToRuns', { get() { inherited++; throw Error('PRIVATE_INHERITED'); } });
  const ordinary = await h.render(Object.assign(Object.create(prototype), { runId: id(1), issueId: id(2) }));
  assert.equal(inherited, 0); assert.match(ordinary, /Recorded audit snapshot/); assert.doesNotMatch(ordinary, /Back to selected recorded-run page/);
});

test('ordinary routes retain exact scope and production denies all request access before local helpers', async () => {
  const h = harness(), html = await h.render({ runId: id(1), issueId: id(2) });
  assert.deepEqual(h.calls, [scope()]); assert.match(html, /Recorded audit snapshot/); assert.doesNotMatch(html, /Back to selected recorded-run page|returnToRuns/);
  for (const mode of ['production', 'test', '']) {
    const denied = harness(undefined, mode), poison = new Proxy({}, { get() { assert.fail('Production request observed'); } });
    await assert.rejects(denied.Page(poison), error => error === denied.marker); assert.deepEqual(denied.calls, []);
  }
});
