import { assertUnsentProposalControls } from "./helpers/inspection_controls.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { proposalReport, proposalScope, proposalId } from './helpers/proposal_fixture.mjs';

const { ProposalComparisonView } = loadTsx(new URL('../src/operator-proposal-view.tsx', import.meta.url));
const render = (decision, selection, browseQuery) => renderToStaticMarkup(createElement(ProposalComparisonView, { decision, selection, browseQuery }));
const links = html => [...html.matchAll(/<a[^>]* href="([^"]*)"[^>]*>(.*?)<\/a>/g)].map(([, href, label]) => ({ href: href.replaceAll('&amp;', '&'), label }));
const query = link => Object.fromEntries(new URL(link.href, 'https://example.invalid').searchParams);
function varying(initial, next) {
  const reads = { runId: 0, decisionId: 0 };
  const selection = Object.fromEntries(Object.keys(initial).map(key => [key, null]));
  for (const key of Object.keys(initial)) Object.defineProperty(selection, key, { enumerable: true, get() {
    reads[key]++; if (reads[key] === 1) return initial[key];
    if (next instanceof Error) throw next; return next[key];
  } });
  return { selection, reads };
}
function withheld(html) {
  assert.match(html, /Proposal unavailable/);
  assert.doesNotMatch(html, /Recorded changes|The invented share|Unverified proposal|proposal-proposed-claim/);
}

test('a captured foreign decision cannot become matching during a second property observation', () => {
  const first = { ...proposalScope(), decisionId: proposalId(99) }, input = varying(first, proposalScope());
  const html = render({ kind: 'ok', report: proposalReport() }, input.selection);
  withheld(html); assert.deepEqual(input.reads, { runId: 1, decisionId: 1 });
  const retry = links(html).find(x => x.label === 'Read this selected comparison again');
  assert.deepEqual(query(retry), first);
  assert.doesNotMatch(html, new RegExp('>' + proposalId(2) + '<'));
});

test('an admitted matching decision stays matching when its caller would later change', () => {
  const input = varying(proposalScope(), { runId: proposalId(98), decisionId: proposalId(99) });
  const html = render({ kind: 'ok', report: proposalReport() }, input.selection);
  assert.match(html, /Recorded changes|The invented share/);
  assert.deepEqual(input.reads, { runId: 1, decisionId: 1 });
  assert.match(html, /Unverified proposal/); assert.match(html, /Current public eligibility and source health were not checked/);
  assert.doesNotMatch(html, new RegExp(proposalId(98) + '|' + proposalId(99)));
});

test('an admitted foreign scope remains the recovery scope without a later throwing caller read', () => {
  const first = { ...proposalScope(), runId: proposalId(99) }, input = varying(first, new Error('PRIVATE_SECOND_READ'));
  const html = render({ kind: 'ok', report: proposalReport() }, input.selection);
  withheld(html); assert.deepEqual(input.reads, { runId: 1, decisionId: 1 });
  assert.deepEqual(query(links(html).find(x => x.label === 'Read this selected comparison again')), first);
  assert.doesNotMatch(html, /PRIVATE_SECOND_READ|Invented publisher|invented row/);
});

test('faulty supplied selection and invalid-scope decisions cannot borrow report targets', () => {
  const fault = Object.defineProperty({ runId: proposalId(1) }, 'decisionId', { enumerable: true, get() { throw new Error('PRIVATE_FIRST_READ'); } });
  const html = render({ kind: 'ok', report: proposalReport() }, fault); withheld(html);
  assert.doesNotMatch(html, /Read this selected comparison again|PRIVATE_FIRST_READ|Affected page/);
  const input = varying(proposalScope(), new Error('PRIVATE_INVALID_SCOPE'));
  const invalid = render({ kind: 'invalid_scope' }, input.selection);
  assert.deepEqual(input.reads, { runId: 0, decisionId: 0 });
  assert.doesNotMatch(invalid, /Read this selected comparison again|The invented share|PRIVATE_INVALID_SCOPE/);
});

test('matching plain or absent selectors preserve exact checked comparison markup and inert authority', () => {
  const report = proposalReport(), original = JSON.stringify(report);
  const unselected = render({ kind: 'ok', report }), selected = render({ kind: 'ok', report }, proposalScope());
  assert.equal(selected, unselected); assert.equal(JSON.stringify(report), original);
  for (const phrase of ['Unverified proposal', 'material conflict', 'Unreviewed.', 'no approval, collection or publication control', 'Captured (UTC)']) assert.ok(selected.includes(phrase));
  assertUnsentProposalControls(selected);
  assert.doesNotMatch(selected, /href="https:\/\//);
});

test('all held outcomes and corrupted reports retain only the captured caller selection', () => {
  const first = { runId: proposalId(99), decisionId: proposalId(98) };
  const corrupt = proposalReport(); corrupt.capture.proposalSha256 = '0'.repeat(64);
  for (const decision of [...['unconfigured', 'unavailable', 'not_found', 'capture_missing', 'changed'].map(kind => ({ kind })), { kind: 'ok', report: corrupt }]) {
    const input = varying(first, new Error('PRIVATE_LATE_SELECTION')), html = render(decision, input.selection);
    assert.deepEqual(input.reads, { runId: 1, decisionId: 1 });
    assert.deepEqual(query(links(html).find(x => x.label === 'Read this selected comparison again')), first);
    assert.doesNotMatch(html, /The invented share|Recorded changes|PRIVATE_LATE_SELECTION|Affected page/);
  }
});
