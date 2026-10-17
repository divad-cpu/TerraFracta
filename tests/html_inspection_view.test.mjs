import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { htmlInspectionVectors } from './helpers/html_inspection_vectors.mjs';
const fixture = () => JSON.parse(readFileSync(new URL('../fixtures/fictional-html-inspection.json', import.meta.url), 'utf8'));
const View = loadTsx(new URL('../src/html-inspection-view.tsx', import.meta.url)).HtmlInspectionView;
const vectors = htmlInspectionVectors();
const render = input => renderToStaticMarkup(View({ input }));

test('actual view keeps two selected vintages, original and derived references, scope and uncertainty together', t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network request'));
  const html = render(fixture());
  for (const phrase of ['Selected HTML text comparison', 'Earlier invented wording.', 'Selected text is identical.',
    'Selected text differs', 'Original outer-element hash', 'Derived parsed-text hash', 'This is not a source publication date',
    'not the rendered page', 'not independently re-extracted here', 'Storage and provider usage are not observed',
    'does not verify the omitted request bytes']) assert.ok(html.includes(phrase), phrase);
  assert.doesNotMatch(html, /<form|<input|<button|<script|<iframe|href="https?:/);
  assert.ok(html.includes(fixture().current.content_sha256));
  assert.ok(html.includes(fixture().current.passages[1].text_sha256));
  assert.match(html, /white-space:pre-wrap/); assert.match(html, /<bdi>/);
});

test('markup supplied as derived source text is escaped without original script or navigation content', () => {
  const html = render(fixture());
  assert.match(html, /&lt;em&gt;quoted markup&lt;\/em&gt;/);
  assert.doesNotMatch(html, /<em>quoted markup|OMITTED_SCRIPT_CANARY|Changed unselected navigation|dangerouslySetInnerHTML|srcdoc=/i);
});

test('first supplied version, equal source, changed wrapping and request-limit hold remain visibly distinct', () => {
  const first = render(vectors.first);
  assert.match(first, /No earlier document was supplied/); assert.match(first, /does not mean that the source is new/);
  assert.match(first, /No compiled request was supplied/); assert.doesNotMatch(first, /Earlier parsed text at the same locator/);
  const identical = render(vectors.identical);
  assert.match(identical, /Selected text is unchanged/); assert.doesNotMatch(identical, /Original HTML changed;/);
  const wrapping = render(vectors.wrapping);
  assert.match(wrapping, /Original HTML changed; selected text is unchanged/);
  assert.match(wrapping, /does not establish that published claims remain current/);
  assert.match(wrapping, /No compiled request was supplied/);
  const held = render(vectors.held);
  assert.match(held, /Selected text exceeds the request limit/);
  assert.match(held, /No extraction request is available/); assert.doesNotMatch(held, /Changed selected text can be prepared/);
});

test('safe internal passage anchors preserve each occurrence and an overview return', () => {
  const html = render(vectors.unicode);
  for (const i of [1, 2]) {
    assert.match(html, new RegExp(`href="#html-passage-${i}"`));
    assert.match(html, new RegExp(`<article id="html-passage-${i}" tabindex="-1">`));
  }
  assert.equal((html.match(/id="html-inspection-heading"/g) ?? []).length, 1);
  assert.equal((html.match(/href="#html-inspection-heading"/g) ?? []).length, 2);
  assert.match(html, /Å é 😀 &amp; &lt;script&gt;quoted&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|href="#one|href="#two/);
});

test('invalid current, earlier or request metadata withholds all partial private source text', () => {
  for (const mutate of [r => r.current.passages[0].text = 'PRIVATE_CANARY', r => r.previous.content_sha256 = 'f'.repeat(64),
    r => r.request.selected_payload_sha256 = 'f'.repeat(64), r => r.limits.storage = 'stored']) {
    const report = fixture(); mutate(report); const html = render(report);
    assert.match(html, /HTML comparison unavailable/);
    assert.doesNotMatch(html, /PRIVATE_CANARY|Entirely invented example|Earlier invented wording|Request bytes|Original HTML bytes/);
  }
});
