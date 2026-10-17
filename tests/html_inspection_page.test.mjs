import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
const route = new URL('../app/editorial-preview/html-sample/page.tsx', import.meta.url);

test('nondevelopment refuses before HTML evidence view invocation', () => {
  let calls = 0; const marker = Error('NOT_FOUND');
  for (const NODE_ENV of [undefined, 'production', 'test']) {
    const page = loadTsx(route, name => name === 'next/navigation' ? { notFound() { throw marker; } } :
      name === '../../../src/html-inspection-view.tsx' ? { HtmlInspectionView() { calls++; assert.fail('View invoked'); } } : undefined, { env: { NODE_ENV } });
    assert.throws(() => page.default(), error => error === marker);
  }
  assert.equal(calls, 0);
});

test('development routes the actual producer fixture to the real passive view with internal return paths', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/fictional-html-inspection.json', import.meta.url), 'utf8'));
  const page = loadTsx(route, name => name === 'next/navigation' ? { notFound() { assert.fail('Development refused'); } } :
    name === '../../../fixtures/fictional-html-inspection.json' ? { default: fixture } : undefined);
  const html = renderToStaticMarkup(page.default());
  assert.equal(page.dynamic, 'force-dynamic'); assert.deepEqual(page.metadata.robots, { index: false, follow: false });
  for (const href of ['/editorial-preview', '/editorial-preview/source-discovery', '/editorial-preview/extraction-sample']) assert.ok(html.includes(`href="${href}"`));
  assert.match(html, /development gate is not authentication/); assert.match(html, /Earlier invented wording/);
  assert.doesNotMatch(html, /<form|<button|<input|<iframe|<script|href="https?:/);
});

test('existing desk exposes a clearly labelled invented HTML comparison', () => {
  const source = readFileSync(new URL('../app/editorial-preview/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /href="\/editorial-preview\/html-sample">Inspect invented HTML text comparison/);
  assert.match(source, /Storage and source qualification remain unconnected/);
});
