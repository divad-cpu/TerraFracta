import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { audit, scope, id } from './helpers/operator_audit_fixture.mjs';
import { choices, choiceId } from './helpers/operator_audit_choices_fixture.mjs';
import { operatorAuditReportSchema } from '../src/operator-audit-report.ts';
import { operatorAuditChoicesSchema } from '../src/operator-audit-choices.ts';
const Audit = loadTsx(new URL('../src/operator-audit-view.tsx', import.meta.url)).OperatorAuditView;
const Choices = loadTsx(new URL('../src/operator-audit-choices-view.tsx', import.meta.url)).OperatorAuditChoicesView;
const render = (Component, props) => renderToStaticMarkup(Component(props));
const cursor = () => ({ latestRevision: 2, headPublicationId: id(6), beforeRevision: 2 });
function olderAudit() { const r = audit(); r.requested.cursor = cursor(); r.history.publications.shift(); return operatorAuditReportSchema.parse(r); }
function olderChoices() {
  const r = choices(choiceId(1)); r.requestedCursor = { createdAt: '2026-10-05T09:30:00.000001Z', runId: choiceId(20) };
  return operatorAuditChoicesSchema.parse(r);
}
function varyingCursor(first, later) {
  const counts = { createdAt: 0, runId: 0 }, value = {};
  for (const key of Object.keys(counts)) Object.defineProperty(value, key, { enumerable: true, get() { counts[key]++; return counts[key] === 1 ? first[key] : later[key]; } });
  return { value, counts };
}
function withheldAudit(html) {
  assert.match(html, /Recorded audit unavailable/);
  assert.doesNotMatch(html, /Recorded audit snapshot|fictional:source|Stored publication revisions|Historical run check outcome|PRIVATE_/);
}
function recovery(html) { return html.match(/href="([^"]+)"[^>]*>Refresh recorded choices/)[1].replaceAll('&amp;', '&'); }

test('a direct audit report cannot supply another run or issue than the independently selected scope', () => {
  for (const key of ['runId', 'issueId']) {
    const selected = { ...scope(), [key]: id(9) }, html = render(Audit, { decision: { kind: 'ok', report: audit() }, selection: selected });
    withheldAudit(html); assert.match(html, new RegExp(`name="${key}"[^>]*value="${id(9)}"`));
    assert.match(html, new RegExp(`href="/editorial-preview/audit\\?runId=${selected.runId}&amp;issueId=${selected.issueId}"`));
  }
});

test('first and older audit pages require an exact independently selected cursor tuple', () => {
  const older = olderAudit();
  for (const [report, selected] of [[audit(), { ...scope(), cursor: cursor() }], [older, scope()], [older, { ...scope(), cursor: { ...cursor(), headPublicationId: id(9) } }], [older, { ...scope(), cursor: { ...cursor(), beforeRevision: 1 } }]])
    withheldAudit(render(Audit, { decision: { kind: 'ok', report }, selection: selected }));
});

test('invalid or first-faulting independently supplied audit selection cannot admit valid report details', () => {
  const fault = Object.defineProperty(scope(), 'issueId', { enumerable: true, get() { throw Error('PRIVATE_SCOPE_FAULT'); } });
  for (const selected of [null, { ...scope(), private: 'PRIVATE_EXTRA' }, { ...scope(), runId: 'PRIVATE_INVALID_RUN' }, fault])
    withheldAudit(render(Audit, { decision: { kind: 'ok', report: audit() }, selection: selected }));
});

test('audit selection is captured before a report getter can change its requested meaning', () => {
  const selected = { ...scope(), issueId: id(9) }; let reports = 0;
  const decision = { kind: 'ok', get report() { reports++; selected.issueId = id(2); return audit(); } };
  const html = render(Audit, { decision, selection: selected });
  withheldAudit(html); assert.equal(reports, 1); assert.match(html, new RegExp(`name="issueId"[^>]*value="${id(9)}"`));
});

test('valid audit selection fields are read once and reused in detail-free recovery', () => {
  const counts = { runId: 0, issueId: 0, cursor: 0 }, selected = {};
  for (const key of Object.keys(counts)) Object.defineProperty(selected, key, { enumerable: true, get() { counts[key]++; return scope()[key]; } });
  const html = render(Audit, { decision: { kind: 'unavailable' }, selection: selected });
  withheldAudit(html); assert.deepEqual(counts, { runId: 1, issueId: 1, cursor: 1 });
  assert.match(html, new RegExp(`value="${id(2)}"`));
});

test('invalid-scope decisions do not observe rejected audit or choices selection fields', () => {
  let reads = 0; const poison = new Proxy({}, { get() { reads++; throw Error('PRIVATE_REJECTED_SELECTOR'); } });
  const a = render(Audit, { decision: { kind: 'invalid_scope' }, selection: poison });
  const b = render(Choices, { decision: { kind: 'invalid_scope' }, selection: choiceId(1), cursor: poison });
  assert.match(a, /Choose a recorded run and issue/); assert.match(b, /The selection is invalid/);
  assert.doesNotMatch(a + b, /PRIVATE_|Recorded audit snapshot|<select/); assert.equal(reads, 0);
});

test('choices matching and recovery use the same first validated cursor rather than later properties', () => {
  const report = olderChoices(), changing = varyingCursor({ ...report.requestedCursor, runId: choiceId(99) }, report.requestedCursor);
  const html = render(Choices, { decision: { kind: 'ok', report }, selection: choiceId(1), cursor: changing.value });
  assert.match(html, /Recorded choices unavailable/); assert.doesNotMatch(html, /<select|Records observed \(UTC\)/);
  assert.deepEqual(changing.counts, { createdAt: 1, runId: 1 });
  assert.equal(recovery(html), `/editorial-preview/audit/select?runId=${choiceId(1)}`);
});

test('choices recovery survives faults on later cursor reads without inventing a prior page', () => {
  const report = olderChoices(), counts = { createdAt: 0, runId: 0 }, changing = {};
  for (const key of Object.keys(counts)) Object.defineProperty(changing, key, { enumerable: true, get() { counts[key]++; if (counts[key] > 1) throw Error('PRIVATE_SECOND_CURSOR'); return key === 'runId' ? choiceId(99) : report.requestedCursor[key]; } });
  const html = render(Choices, { decision: { kind: 'ok', report }, selection: choiceId(1), cursor: changing });
  assert.match(html, /Recorded choices unavailable/); assert.doesNotMatch(html, /PRIVATE_|<select/);
  assert.deepEqual(counts, { createdAt: 1, runId: 1 }); assert.equal(recovery(html), `/editorial-preview/audit/select?runId=${choiceId(1)}`);
});

test('matching and omitted audit scopes retain ordinary report markup and exact input bytes', () => {
  for (const report of [audit(), olderAudit()]) {
    const bytes = JSON.stringify(report), selected = structuredClone(report.requested), selectionBytes = JSON.stringify(selected);
    const supplied = render(Audit, { decision: { kind: 'ok', report }, selection: selected });
    assert.equal(supplied, render(Audit, { decision: { kind: 'ok', report } }));
    assert.match(supplied, /Recorded audit snapshot|fictional:source/); assert.match(supplied, /not establish current source health/);
    assert.equal(JSON.stringify(report), bytes); assert.equal(JSON.stringify(selected), selectionBytes);
  }
});

test('matching ordinary choices preserve first-page and older-page controls and input bytes', () => {
  for (const report of [choices(), choices(choiceId(1)), olderChoices()]) {
    const bytes = JSON.stringify(report), selected = report.requestedRunId, selectedCursor = structuredClone(report.requestedCursor);
    const html = render(Choices, { decision: { kind: 'ok', report }, selection: selected, cursor: selectedCursor });
    assert.equal(html, render(Choices, { decision: { kind: 'ok', report } }));
    assert.match(html, /Records observed \(UTC\)/); assert.equal(JSON.stringify(report), bytes);
  }
});
