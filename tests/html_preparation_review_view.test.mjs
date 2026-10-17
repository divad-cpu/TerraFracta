import assert from 'node:assert/strict';import test from 'node:test';import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';import {htmlPreparationReviewVectors,htmlPreparationMarkupVector} from './helpers/html_preparation_review_vectors.mjs';
const {HtmlPreparationReviewView:View}=loadTsx(new URL('../src/html-preparation-review-view.tsx',import.meta.url));
const rows=htmlPreparationReviewVectors().reports;
const render=row=>renderToStaticMarkup(View({raw:row.reportJson,expected:row.expected}));
test('each explicit branch composes historical candidate, original times and exact HTML evidence once',()=>{
 for(const row of rows){const html=render(row);assert.match(html,/Historical HTML preparation/);assert.match(html,/source rights/);assert.match(html,/No actual held capture/);
 assert.match(html,row.label.startsWith('Empty')?/Explicitly supplied as empty/:/Publication <code>/);assert.match(html,/Revised invented wording/);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 for(const [,id] of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(id),id);
 assert.doesNotMatch(html,/<form|<input|<button|<script|<iframe|href="https?:/);}
});
test('independently supplied markup is escaped in title, summary and source excerpts',()=>{
 const html=render(htmlPreparationMarkupVector());assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.match(html,/&lt;em&gt;/);
 assert.doesNotMatch(html,/<script|<img|onerror="/);
});
test('failed receipt identity withholds all private candidate, context and source data',()=>{
 const row=rows[0],html=renderToStaticMarkup(View({raw:'PRIVATE_CANARY',expected:row.expected}));assert.match(html,/Historical HTML preparation unavailable/);
 assert.doesNotMatch(html,/PRIVATE_CANARY|Revised invented wording|Invented HTML review candidate|Historical artifact references/);
});
