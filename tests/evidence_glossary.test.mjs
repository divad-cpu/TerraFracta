import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { findGlossaryTerms, glossaryTerms, glossaryCategories, glossaryHref } from "../src/evidence-glossary.ts";
import { statementLabels, evidenceLabels } from "../src/issue-display-labels.ts";

test("reader guide covers the existing six statement types and three reference relationships without changing their labels", () => {
  for (const label of [...Object.values(statementLabels), ...Object.values(evidenceLabels)])
    assert.equal(glossaryTerms.filter(term => term.label === label).length, 1, label);
  assert.equal(new Set(glossaryTerms.map(term => term.slug)).size, glossaryTerms.length);
  for (const term of glossaryTerms) {
    assert.match(term.slug, /^[a-z]+(?:-[a-z]+)*$/); assert.ok(Object.hasOwn(glossaryCategories, term.category));
    assert.ok(term.explanation.length > 30 && term.question.endsWith('?'));
    assert.equal(glossaryHref(term.slug), `/methodology/glossary#${term.slug}`);
  }
});
test("closed native glossary selectors refuse extra, repeated, null, prototype and excessive inputs", () => {
  for (const value of [null, [], 'funding', { q: null }, { q: ['funding'] }, { category: ['dates'] },
    { category: 'toString' }, { category: '__proto__' }, { category: null }, { path: '/PRIVATE_CANARY' },
    { q: 'a'.repeat(81) }, { q: '\u0000' }, { q: 'ﬄ'.repeat(30) }]) {
    const result = findGlossaryTerms(value); assert.equal(result.kind, 'invalid'); assert.deepEqual(result.terms, []);
    assert.equal(result.query, '');
  }
});
test("glossary search normalizes words and requires all words within the same term", () => {
  assert.deepEqual(findGlossaryTerms({ q: '  ＭＯＮＥＹ spent ' }).terms.map(term => term.slug), ['funding']);
  assert.deepEqual(findGlossaryTerms({ q: 'received PRIVATE_CANARY' }).terms, []);
  assert.deepEqual(findGlossaryTerms({ q: 'retrieval expenditure' }).terms, []);
  assert.equal(findGlossaryTerms({ q: 'policy effect', category: 'statements' }).terms[0].slug, 'evaluation');
});
test("guide category filters preserve authored order and do not mutate definitions", () => {
  const before = JSON.stringify(glossaryTerms);
  assert.deepEqual(findGlossaryTerms({}).terms.map(term => term.slug), glossaryTerms.map(term => term.slug));
  assert.deepEqual(findGlossaryTerms({ category: 'dates' }).terms.map(term => term.slug),
    ['data-period', 'source-published', 'retrieved', 'evidence-review', 'publication-revision']);
  assert.deepEqual(findGlossaryTerms({ q: 'money', category: 'dates' }).terms, []);
  assert.equal(JSON.stringify(glossaryTerms), before);
});
test("guide keeps spending, attribution, causal inference, missing evidence and arithmetic distinctions explicit", () => {
  const term = slug => glossaryTerms.find(item => item.slug === slug).explanation;
  assert.match(term('funding'), /allocation does not establish expenditure/);
  assert.match(term('attributed-finding'), /does not independently verify/);
  assert.match(term('evaluation'), /change after a policy alone cannot establish its effect/);
  assert.match(term('source-reference'), /not a count of independent confirmations/);
  assert.match(term('missing-evidence'), /Neither establishes government inaction/);
  assert.match(term('percentage-points'), /invented arithmetic example/);
  assert.match(term('percentage-points'), /2 percentage points.*20% relative/);
  assert.equal(12 - 10, 2); assert.equal((12 - 10) / 10 * 100, 20);
});

// Exact installed-framework SSR, no HTTP, server, Browser, store or provider.
const cache = new Map();
function load(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const native = createRequire(url), exports = {}; cache.set(url.href, exports);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name.startsWith('.')) {
      const next = new URL(name, url);
      if (next.pathname.endsWith('.tsx')) return load(next);
      if (existsSync(new URL(next.href + '.tsx'))) return load(new URL(next.href + '.tsx'));
    }
    return native(name);
  }, exports);
  return exports;
}
const page = async query => renderToStaticMarkup(await load(new URL('../app/methodology/glossary/page.tsx', import.meta.url)).default({ searchParams: Promise.resolve(query) }));
test("actual glossary page has labelled native search, stable definition anchors and one heading", async () => {
  const html = await page({});
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  for (const value of ['action="/methodology/glossary"', 'method="get"', 'name="q"', 'name="category"',
    'for="glossary-query"', 'for="glossary-category"', 'aria-describedby="glossary-search-help"', '19 terms match',
    'href="/methodology"', 'href="/sources"', 'No real-source dossier']) assert.ok(html.includes(value), value);
  for (const term of glossaryTerms) assert.ok(html.includes(`id="${term.slug}"`) && html.includes(`href="#${term.slug}"`), term.slug);
});
test("actual filtered, invalid and empty guide views have honest recovery without hidden source content", async () => {
  const filtered = await page({ q: 'money', category: 'statements' });
  assert.ok(filtered.includes('1 term matches')); assert.ok(filtered.includes('id="funding"')); assert.ok(!filtered.includes('id="delivery"'));
  for (const query of [{ q: ['PRIVATE_CANARY'] }, { category: 'PRIVATE_CANARY' }, { path: 'PRIVATE_CANARY' }]) {
    const html = await page(query); assert.ok(html.includes('Check your search')); assert.ok(!html.includes('PRIVATE_CANARY'));
    assert.ok(html.includes('href="/methodology/glossary"')); assert.ok(!html.includes('id="funding"'));
  }
  const empty = await page({ q: '<script>PRIVATE_CANARY</script>' });
  assert.ok(empty.includes('No definition matches')); assert.ok(!empty.includes('<script>')); assert.ok(!empty.includes('id="funding"'));
});
test("existing method and source pages link to the exact new reading guide", async () => {
  for (const [relative, href] of [['../app/methodology/page.tsx', '/methodology/glossary'],
    ['../app/sources/page.tsx', '/methodology/glossary?category=evidence']]) {
    const html = renderToStaticMarkup(await load(new URL(relative, import.meta.url)).default({ searchParams: Promise.resolve({}) }));
    assert.ok(html.includes(`href="${href}"`), relative);
  }
});
