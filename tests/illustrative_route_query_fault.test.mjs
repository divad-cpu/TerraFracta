import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
const paths = ['../app/issues/page.tsx', '../app/countries/page.tsx', '../app/corrections/page.tsx'];
const pages = paths.map(path => loadTsx(new URL(path, import.meta.url)).default);
const html = async (Page, searchParams) => renderToStaticMarkup(await Page({ searchParams }));
const held = (text, i) => { assert.match(text, i === 2 ? /Check the draft link/ : /Check your search/); assert.doesNotMatch(text, /PRIVATE_CANARY|visitor-issue-card|class="country-row"|<textarea|Selected section:/); };
test('rejected illustrative query keeps existing invalid search or unopened draft UI', async () => {
  for (const [i, Page] of pages.entries()) held(await html(Page, Promise.reject(Error('PRIVATE_CANARY'))), i);
});
test('faulty thenable query is observed once and exposes no earlier target or error', async () => {
  for (const [i, Page] of pages.entries()) for (const kind of ['get', 'reject']) {
    let reads = 0; const port = kind === 'get' ? { get then() { reads++; throw Error('PRIVATE_CANARY'); } } : { then(resolve, reject) { reads++; reject(Error('PRIVATE_CANARY')); } };
    held(await html(Page, port), i); assert.equal(reads, 1);
  }
});
test('hidden then on accepted illustrative query is never observed a second time', async () => {
  for (const [i, Page] of pages.entries()) {
    let reads = 0; const query = i === 2 ? { section: 'sources' } : { q: 'Norway' };
    Object.defineProperty(query, 'then', { get() { reads++; if (reads === 1) return undefined; throw Error('PRIVATE_CANARY'); } });
    const text = await html(Page, query); assert.equal(reads, 1); assert.doesNotMatch(text, /PRIVATE_CANARY/);
    assert.match(text, i === 0 ? /1 illustrative case found/ : i === 1 ? /class="country-row"/ : /Selected section: <strong>Evidence and sources/);
  }
});
test('throwing own selector cannot open a sample draft or create a card', async () => {
  for (const [i, Page] of pages.entries()) held(await html(Page, Promise.resolve({ get [i === 2 ? 'section' : 'q']() { throw Error('PRIVATE_CANARY'); } })), i);
});
test('newly captured sample correction section remains unsent with its exact native return', async () => {
  let reads = 0; const text = await html(pages[2], Promise.resolve({ get section() { return ++reads === 1 ? 'sources' : 'PRIVATE_CANARY'; } }));
  assert.equal(reads, 1); assert.match(text, /Nothing is sent or saved from this draft/); assert.match(text, /No correction queue is connected/);
  assert.match(text, /href="\/countries\/norway\/issues\/housing-costs#sources"/); assert.doesNotMatch(text, /PRIVATE_CANARY/);
});
