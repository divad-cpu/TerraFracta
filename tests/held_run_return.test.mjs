import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { choices } from './helpers/operator_audit_choices_fixture.mjs';
import { heldReport, decisionRow } from './helpers/operator_held_fixture.mjs';
import { proposalReport, proposalId as id, proposalScope } from './helpers/proposal_fixture.mjs';
import { operatorAuditChoicesSchema } from '../src/operator-audit-choices.ts';
import { heldDecisionsReportSchema } from '../src/operator-held-decisions.ts';
import { canonicalHeldDecisionScope } from '../src/server/operator-held-decisions-reader.ts';
import { canonicalOperatorAuditChoice, canonicalOperatorAuditRunCursor } from '../src/server/operator-audit-choices-reader.ts';
const runCursor = () => ({ createdAt: '2026-09-28T05:15:00.000001Z', runId: id(99) });
const heldCursor = () => ({ decidedAt: '2026-09-28T06:45:00.000001Z', decisionId: id(98) });
const returning = () => ({ runId: id(1), cursor: runCursor() });
const runQuery = () => ({ returnToRuns: '1', returnBeforeCreatedAt: runCursor().createdAt, returnBeforeRunId: runCursor().runId });
const query = () => ({ runId: id(1), beforeDecidedAt: heldCursor().decidedAt, beforeDecisionId: heldCursor().decisionId, reason: 'material_conflict', ...runQuery() });
const plainScope = () => ({ runId: id(1), cursor: heldCursor() });
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2].replaceAll('&amp;', '&')]));
const links = html => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m => ({ ...attrs(m[1]), label: m[2] }));
const url = (html, label) => new URL(links(html).find(link => link.label === label)?.href ?? assert.fail(`Missing link: ${label}`), 'https://example.invalid');
const params = link => Object.fromEntries(link.searchParams);
const render = (Component, props) => renderToStaticMarkup(Component(props));
const Choices = loadTsx(new URL('../src/operator-audit-choices-view.tsx', import.meta.url)).OperatorAuditChoicesView;
const Held = loadTsx(new URL('../src/operator-held-decisions-view.tsx', import.meta.url)).HeldDecisionsView;
function selectedChoices(selected = id(1), cursor = runCursor()) {
  const r = choices(); r.requestedRunId = selected; r.requestedCursor = cursor; r.observedAt = '2026-09-28T08:00:00Z';
  r.runs = [8,1].map(n => ({ runId: id(n), jurisdictionId: 'invented-country', createdAt: '2026-09-28T05:00:00.000001Z', runState: 'completed' }));
  r.selectedRun = r.runs.find(row => row.runId === selected); r.issues = [{ issueId: id(7), issueKey: 'invented-issue' }];
  return operatorAuditChoicesSchema.parse(r);
}
function recorded(scope = plainScope()) {
  const r = heldReport(scope); r.observedAt = '2026-09-28T08:00:00.000000Z'; r.run.createdAt = '2026-09-28T05:00:00.000000Z';
  r.decisions = [{ ...decisionRow(2), decisionId: id(2), sourceVersionId: id(4), decidedAt: '2026-09-28T06:30:00.000001Z' }];
  return heldDecisionsReportSchema.parse(r);
}
function harness(heldRead = async selected => ({ kind: 'ok', report: recorded(selected) }), proposalRead = async () => ({ kind: 'ok', report: proposalReport() }), mode = 'development') {
  const calls = { held: [], proposal: [], runs: [] }, marker = Error('NOT_FOUND');
  const intercept = name => {
    if (name === 'next/navigation') return { notFound() { throw marker; } };
    if (name.endsWith('/server/operator-held-decisions-reader.ts')) return { canonicalHeldDecisionScope, readHeldDecisions: async selected => { calls.held.push(structuredClone(selected)); return heldRead(selected); } };
    if (name.endsWith('/server/operator-proposal-reader.ts')) return { readCapturedProposal: async selected => { calls.proposal.push(structuredClone(selected)); return proposalRead(selected); } };
    if (name.endsWith('/server/operator-audit-choices-reader.ts')) return { canonicalOperatorAuditChoice, canonicalOperatorAuditRunCursor, readOperatorAuditChoices: async (selected, _signal, cursor) => { calls.runs.push({ selected, cursor }); return { kind: 'ok', report: selectedChoices(selected, cursor) }; } };
  };
  const load = relative => loadTsx(new URL(relative, import.meta.url), intercept, { env: { NODE_ENV: mode } }).default;
  const pages = { held: load('../app/editorial-preview/held/page.tsx'), proposal: load('../app/editorial-preview/held/proposal/page.tsx'), runs: load('../app/editorial-preview/audit/select/page.tsx') };
  return { calls, marker, pages, render: async (kind, query) => renderToStaticMarkup(await pages[kind]({ searchParams: Promise.resolve(query) })) };
}

test('selected run-page held link retains incoming run cursor without changing held read scope', () => {
  const report = selectedChoices(), html = render(Choices, { decision: { kind: 'ok', report }, selection: id(1), cursor: report.requestedCursor });
  assert.deepEqual(params(url(html, 'Inspect held decisions for this run')), { runId: id(1), ...runQuery() });
});

test('actual held to proposal to held to run-page journey keeps two separate cursors and makes fresh reads', async () => {
  const h = harness(), held = await h.render('held', query()), proposalQuery = params(url(held, 'Inspect captured proposal'));
  assert.deepEqual(proposalQuery, { ...query(), decisionId: id(2) });
  const comparison = await h.render('proposal', proposalQuery); assert.match(comparison, /The invented share was 8\.2%/);
  const returned = params(url(comparison, 'Return to the selected held page (new read)')); assert.deepEqual(returned, query());
  const heldAgain = await h.render('held', returned), runUrl = url(heldAgain, 'Back to selected recorded-run page');
  assert.deepEqual(params(runUrl), { runId: id(1), beforeCreatedAt: runCursor().createdAt, beforeRunId: runCursor().runId });
  const runs = await h.render('runs', params(runUrl)); assert.match(runs, /Older recorded runs/);
  assert.deepEqual(h.calls.held, [plainScope(), plainScope()]); assert.deepEqual(h.calls.proposal, [proposalScope()]);
  assert.deepEqual(h.calls.runs, [{ selected: id(1), cursor: runCursor() }]);
});

test('held pagination, reason form, clear and fresh links retain only independent run-page coordinates', () => {
  const report = recorded(); report.decisions = Array.from({ length: 20 }, (_, i) => ({ ...report.decisions[0], decisionId: id(40 - i) }));
  report.more = true; report.nextCursor = { decidedAt: report.decisions.at(-1).decidedAt, decisionId: report.decisions.at(-1).decisionId };
  const html = render(Held, { decision: { kind: 'ok', report: heldDecisionsReportSchema.parse(report) }, selection: plainScope(), reason: 'material_conflict', runReturn: returning() });
  assert.deepEqual(params(url(html, 'Older held decisions')), { runId: id(1), beforeDecidedAt: report.nextCursor.decidedAt, beforeDecisionId: report.nextCursor.decisionId, reason: 'material_conflict', ...runQuery() });
  assert.deepEqual(params(url(html, 'Start a fresh held-decision read')), { runId: id(1), reason: 'material_conflict', ...runQuery() });
  assert.deepEqual(params(url(html, 'Clear this page’s reason filter')), { runId: id(1), beforeDecidedAt: heldCursor().decidedAt, beforeDecisionId: heldCursor().decisionId, ...runQuery() });
  const form = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/)[0], fields = Object.fromEntries([...form.matchAll(/<input\b[^>]*>/g)].map(m => { const a = attrs(m[0]); return [a.name, a.value]; }));
  assert.deepEqual(fields, { runId: id(1), ...runQuery(), beforeDecidedAt: heldCursor().decidedAt, beforeDecisionId: heldCursor().decisionId });
  for (const link of links(html).filter(row => row.label === 'Inspect captured proposal')) assert.deepEqual(params(new URL(link.href, 'https://example.invalid')), { ...query(), decisionId: params(new URL(link.href, 'https://example.invalid')).decisionId });
});

test('held and rejected-proposal recovery preserves return coordinates without borrowing hidden record fields', async () => {
  for (const kind of ['unconfigured', 'unavailable', 'changed', 'throws']) {
    const read = async () => { if (kind === 'throws') throw Error('PRIVATE_READ_FAULT'); return { kind }; }, h = harness(read, read);
    const held = await h.render('held', query()); assert.ok(url(held, 'Back to selected recorded-run page')); assert.doesNotMatch(held, /invented-source|PRIVATE_|Recorded holds/);
    const comparison = await h.render('proposal', { ...query(), decisionId: id(2) });
    assert.deepEqual(params(url(comparison, 'Return to the selected held page (new read)')), query());
    assert.deepEqual(params(url(comparison, 'Read this selected comparison again')), { ...query(), decisionId: id(2) });
    assert.doesNotMatch(comparison, /The invented share|PRIVATE_/); assert.deepEqual(h.calls.held, [plainScope()]); assert.deepEqual(h.calls.proposal, [proposalScope()]);
  }
});

test('malformed or incomplete run-return fields refuse both actual routes before private reads', async () => {
  for (const extra of [{ returnToRuns: '0' }, { returnToRuns: ['1'] }, { returnToRuns: '1', returnBeforeRunId: 'PRIVATE_INVALID' }, { returnBeforeCreatedAt: runCursor().createdAt, returnBeforeRunId: runCursor().runId }, { returnToRuns: '1', returnBeforeCreatedAt: runCursor().createdAt }]) {
    const h = harness(), base = { runId: id(1), reason: 'material_conflict', ...extra };
    for (const [kind, fields] of [['held', base], ['proposal', { ...base, decisionId: id(2) }]]) { const html = await h.render(kind, fields); assert.match(html, /selection is invalid/); assert.doesNotMatch(html, /PRIVATE_|Back to selected recorded-run page|The invented share|Recorded holds/); }
    assert.deepEqual(h.calls.held, []); assert.deepEqual(h.calls.proposal, []);
  }
});

test('direct invalid or foreign run return supplies no scope or link and rejected scope is unobserved', () => {
  for (const runReturn of [{ runId: id(9), cursor: runCursor() }, { ...returning(), private: 'PRIVATE_EXTRA' }]) {
    const html = render(Held, { decision: { kind: 'ok', report: recorded() }, selection: plainScope(), reason: '', runReturn });
    assert.match(html, /Recorded holds/); assert.doesNotMatch(html, /Back to selected recorded-run page|PRIVATE_/);
  }
  let reads = 0; const poison = new Proxy({}, { get() { reads++; throw Error('PRIVATE_RETURN_INPUT'); } });
  render(Held, { decision: { kind: 'invalid_scope' }, selection: poison, reason: '', runReturn: poison }); assert.equal(reads, 0);
});

test('captured run-return query survives later caller mutation and each admitted field is observed once', async () => {
  const counts = {}, input = {};
  for (const [key, value] of Object.entries(query())) Object.defineProperty(input, key, { enumerable: true, get() { counts[key] = (counts[key] ?? 0) + 1; return counts[key] === 1 ? value : 'PRIVATE_SECOND_VALUE'; } });
  const h = harness(async selected => ({ kind: 'unavailable' })), html = await h.render('held', input);
  assert.deepEqual(Object.values(counts), Object.keys(query()).map(() => 1)); assert.deepEqual(h.calls.held, [plainScope()]);
  assert.deepEqual(params(url(html, 'Back to selected recorded-run page')), { runId: id(1), beforeCreatedAt: runCursor().createdAt, beforeRunId: runCursor().runId });
  assert.doesNotMatch(html, /PRIVATE_/);
});

test('ordinary legacy selection stays unchanged and production refuses before any request access', async () => {
  const h = harness(), ordinary = { runId: id(1), reason: 'material_conflict' }, html = await h.render('held', ordinary);
  assert.match(html, /Recorded holds/); assert.doesNotMatch(html, /Back to selected recorded-run page|returnToRuns/);
  assert.deepEqual(h.calls.held, [{ runId: id(1), cursor: null }]);
  for (const mode of ['production', 'test', '']) {
    const denied = harness(undefined, undefined, mode), poison = new Proxy({}, { get() { assert.fail('Rejected request accessed'); } });
    for (const page of [denied.pages.held, denied.pages.proposal]) await assert.rejects(page(poison), error => error === denied.marker);
    assert.deepEqual(denied.calls, { held: [], proposal: [], runs: [] });
  }
});

test('held report mismatch and recovery reuse the same first captured caller scope', () => {
  let reads = 0; const selected = { cursor: heldCursor() }; Object.defineProperty(selected, 'runId', { enumerable: true, get() { return ++reads === 1 ? id(1) : id(9); } });
  const foreign = recorded({ runId: id(9), cursor: heldCursor() });
  const html = render(Held, { decision: { kind: 'ok', report: foreign }, selection: selected, reason: '', runReturn: returning() });
  assert.match(html, /Held decisions unavailable/); assert.doesNotMatch(html, /Recorded holds|invented-source|PRIVATE_/); assert.equal(reads, 1);
  assert.deepEqual(params(url(html, 'Back to selected recorded-run page')), { runId: id(1), beforeCreatedAt: runCursor().createdAt, beforeRunId: runCursor().runId });
});
