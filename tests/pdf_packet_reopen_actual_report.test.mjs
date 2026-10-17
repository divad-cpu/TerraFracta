import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { pdfPacketReopenReport } from '../src/server/pdf-packet-reopen-report.ts';
import { loadTsx } from './helpers/tsx_loader.mjs';
const read = name => JSON.parse(readFileSync(new URL('../fixtures/' + name, import.meta.url), 'utf8'));
const actual = () => read('fictional-pdf-reopen.json');
const load = value => loadTsx(new URL('../app/editorial-preview/pdf-reopen/page.tsx', import.meta.url), name =>
  name === 'next/navigation' ? { notFound() { assert.fail('Development refused'); } } :
  name === '../../../fixtures/fictional-pdf-reopen.json' ? { default: value } : undefined).default;

test('actual preparation and reopening fixture preserves the original inspection wire and observation', () => {
  const report = actual(); assert.deepEqual(pdfPacketReopenReport(report), report);
  const original = read('fictional-pdf-inspection.json');
  assert.deepEqual(report.inspection_report, original);
  assert.equal(report.recorded_observed_at, original.observed_at);
  assert.ok(report.reopened_at > report.recorded_observed_at);
  assert.equal(report.inspection_sha256, createHash('sha256').update(JSON.stringify(original) + '\n').digest('hex'));
  assert.deepEqual(Object.keys(report).sort(), ['schema_version', 'kind', 'scope', 'packet_sha256', 'inspection_sha256',
    'derivation_sha256', 'recorded_observed_at', 'reopened_at', 'inspection_report'].sort());
});
test('actual generated reopening report crosses the real passive development page', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No request'));
  const html = renderToStaticMarkup(load(actual())());
  for (const text of ['Entirely invented', 'Original recorded inspection observation', 'Separately supplied reopening time',
    'Invented native paragraph.', 'No selected-page map is supplied here', 'not recomputed here']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<input|<form|<button|<script|<iframe|raw_base64|href="https?:/);
});
test('a corrupt actual supplied inner hash withholds all document and packet references', () => {
  const report = actual(); report.inspection_sha256 = '0'.repeat(64);
  const html = renderToStaticMarkup(load(report)());
  assert.match(html, /PDF reopening report unavailable/);
  for (const secret of [report.packet_sha256, report.derivation_sha256, report.inspection_report.document.source_url,
    'Invented native paragraph.']) assert.ok(!html.includes(secret));
});
test('original PDF example links once to the separate historical packet example', () => {
  const page = loadTsx(new URL('../app/editorial-preview/pdf-inspection/page.tsx', import.meta.url), name =>
    name === 'next/navigation' ? { notFound() { assert.fail('Development refused'); } } :
    name === '../../../fixtures/fictional-pdf-inspection.json' ? { default: read('fictional-pdf-inspection.json') } : undefined).default;
  const html = renderToStaticMarkup(page());
  assert.equal((html.match(/href="\/editorial-preview\/pdf-reopen"/g) ?? []).length, 1);
});
