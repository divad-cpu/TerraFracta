import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { pdfInspectionReport } from '../src/server/pdf-inspection-report.ts';
import { loadTsx } from './helpers/tsx_loader.mjs';
const raw = readFileSync(new URL('../fixtures/fictional-pdf-inspection.json', import.meta.url), 'utf8');
const actual = () => JSON.parse(raw);
const route = new URL('../app/editorial-preview/pdf-inspection/page.tsx', import.meta.url);
const load = value => loadTsx(route, name => name === 'next/navigation' ? { notFound() { assert.fail('Development refused'); } } :
  // Real generated JSON under the bundler's default-import shape. The narrow
  // in-process TSX loader does not enable project esModuleInterop.
  name === '../../../fixtures/fictional-pdf-inspection.json' ? { default: value } : undefined).default;

test('actual invented fixed-worker fixture crosses the complete checked consumer contract', () => {
  const report = actual(); assert.deepEqual(pdfInspectionReport(report), report);
  const input = JSON.parse(readFileSync(new URL('../fixtures/fictional-pdf-input.json', import.meta.url), 'utf8'));
  const original = Buffer.from(input.raw_base64, 'base64');
  assert.equal(report.original_bytes, original.length);
  assert.equal(report.document.content_sha256, createHash('sha256').update(original).digest('hex'));
  assert.deepEqual(report.document, input.document);
  assert.deepEqual(report.pages.map(p => p.state), ['text_extracted', 'no_native_text']);
  assert.equal(report.pages[0].text, 'Invented native paragraph.');
});
test('actual generated report renders through the real passive development page', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No request'));
  const html = renderToStaticMarkup(load(actual())());
  for (const text of ['Entirely invented', 'Invented native paragraph.', 'Physical page 1', 'Physical page 2',
    'No native text was returned', 'not printed PDF page labels or original byte offsets', 'not a rendered PDF']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<input|<form|<button|<script|<iframe|PRIVATE_PDF_METADATA_CANARY|raw_base64|href="https?:/);
});
test('corrupt actual-report text with unchanged hash withholds all generated metadata', () => {
  const report = actual(); report.pages[0].text = 'PRIVATE_CHANGED_TEXT';
  const html = renderToStaticMarkup(load(report)());
  assert.match(html, /PDF inspection unavailable/);
  assert.doesNotMatch(html, /PRIVATE_CHANGED_TEXT|invented-report|pdf-physical-page-|example.org/);
});
test('feed discovery links to the separate PDF example without implying it fetched the lead', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/fictional-feed-discovery.json', import.meta.url), 'utf8'));
  const page = loadTsx(new URL('../app/editorial-preview/source-discovery/page.tsx', import.meta.url), name =>
    name === 'next/navigation' ? { notFound() { assert.fail('Development refused'); } } :
    name === '../../../fixtures/fictional-feed-discovery.json' ? { default: fixture } : undefined);
  const html = renderToStaticMarkup(page.default());
  assert.equal((html.match(/href="\/editorial-preview\/pdf-inspection"/g) ?? []).length, 1);
  assert.match(html, /This document was not retrieved from these feed leads/);
});
