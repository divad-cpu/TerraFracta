import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {parsePublicIssueProjection} from '../src/public-issue-projection.ts';
import {syntheticReadRows} from '../app/evidence-preview/example.ts';
import {currentIssueSelection,currentIssueSearchMatches} from '../src/current-issue-navigation.ts';
const View=loadTsx(new URL('../src/current-issue-navigation-view.tsx',import.meta.url)).CurrentIssueNavigationView;
const example=()=>parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
const render=(issue,view,q,decision={status:200,cacheControl:'no-store',issue})=>renderToStaticMarkup(createElement(View,{decision,selection:currentIssueSelection(view,{edition:issue.publicationId,q}),latestHref:`/reader-preview/imaginary-place/sample-housing-measure/${view}`}));
const marks=html=>[...html.matchAll(/<mark>([^<]*)<\/mark>/g)].map(m=>m[1]);
test('source results locate literal query words without changing whole-query or conflict semantics',()=>{
 const issue=example(),html=render(issue,'sources','cell A1');assert.deepEqual(marks(html),['cell','A1']);
 assert.ok(html.includes('Showing 1 of 3 references'));assert.ok(!/<li class="current-source-entry--supports">([\s\S]*?)<\/li>/.exec(html)[1].includes('Points to a conflict'));assert.ok(html.includes('complete dossier includes conflicting evidence'));
 assert.ok(html.includes('Highlighted text locates search words'));assert.ok(html.includes('does not establish support or agreement'));
 assert.ok(html.includes('returnQ=cell+A1'));assert.ok(!html.includes('href="https:'));
});
test('statement search marks separate partial source fields and keeps their exact occurrence links',()=>{
 const issue=example(),html=render(issue,'search','A1 method');assert.ok(marks(html).includes('A1'));assert.ok(marks(html).some(value=>value.toLowerCase()==='method'));
 assert.ok(html.includes('Reference 1:'));assert.ok(html.includes('Reference 2:'));assert.ok(html.includes('Points to a conflict'));
 assert.equal(currentIssueSearchMatches(issue,'A1 method')[0].matchedReferences.length,2);assert.ok(html.includes('Words may occur across different references'));
});
test('compatibility normalized words mark original glyphs without rewriting their display text',()=>{
 const issue=example();issue.claims[0].evidence[1].title='Invented ＭＥＴＨＯＤ ﬁle';issue.claims[0].evidence[1].locator='section 2';
 const html=render(issue,'search','method file');assert.ok(marks(html).includes('ＭＥＴＨＯＤ'));assert.ok(marks(html).includes('ﬁle'));assert.ok(!html.includes('<mark>METHOD</mark>'));
});
test('no query no-match and withheld visits never add a mark or leak prior search text',()=>{
 const issue=example();for(const view of ['sources','search'])for(const q of ['', 'NO_MATCH'])assert.deepEqual(marks(render(issue,view,q)),[]);
 for(const decision of [{status:404,cacheControl:'no-store'},{status:503,cacheControl:'no-store'},{status:200,cacheControl:'no-store',issue:{...issue,publicationId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}}]){
  const html=render(issue,'sources','private-query-canary',decision);assert.deepEqual(marks(html),[]);assert.ok(!html.includes('private-query-canary'));assert.ok(!html.includes('Highlighted text'));
 }
});
