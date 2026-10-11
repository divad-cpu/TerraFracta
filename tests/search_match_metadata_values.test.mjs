import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {parsePublicIssueProjection} from '../src/public-issue-projection.ts';
import {currentIssueHref,currentIssueSelection} from '../src/current-issue-navigation.ts';
import {syntheticReadRows} from '../app/evidence-preview/example.ts';
import {sample} from './helpers/public_read_rows_fixture.mjs';
import {createPublicIssueReader} from '../src/server/public-issue-reader.ts';
const View=loadTsx(new URL('../src/current-issue-navigation-view.tsx',import.meta.url)).CurrentIssueNavigationView;
function issue(change=()=>{}){const envelope=structuredClone(syntheticReadRows.envelope);change(envelope.publication.snapshot);return parsePublicIssueProjection(envelope);}
const render=(record,query={},decision={status:200,cacheControl:'no-store',issue:record})=>renderToStaticMarkup(createElement(View,{decision,selection:currentIssueSelection('search',{edition:record.publicationId,...query}),latestHref:currentIssueHref(record,'search',false)}));
const metadata=html=>[...html.matchAll(/<dl aria-label="Matching source metadata">([\s\S]*?)<\/dl>/g)].map(m=>m[1]);
const numbers=html=>[...html.matchAll(/>Reference (\d+): /g)].map(m=>Number(m[1]));
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#x27;');
test('a publisher-only occurrence displays its literal matched value without inventing a locator match or changing edition-bound provenance',()=>{
 const r=issue(s=>{s.claims[0].evidence[0].publisher='Unique Pubneedle Institute';});const html=render(r,{q:'pubneedle'}),blocks=metadata(html);
 assert.equal(blocks.length,1);assert.ok(blocks[0].includes('<dt>Publisher</dt><dd>Unique Pubneedle Institute</dd>'));assert.ok(!blocks[0].includes('<dt>Exact location</dt>'));assert.deepEqual(numbers(html),[1]);assert.ok(html.includes(`?edition=${r.publicationId}&amp;returnView=search&amp;returnQ=pubneedle#reference-${r.claims[0].id}-1`));assert.ok(html.includes('Search words in: Publisher'));assert.ok(!html.includes('href="https:'));
});
test('a locator-only search preserves the complete literal value and normalization rather than fabricating a snippet or unrelated publisher',()=>{
 const value='  Exact ＬＯＣＮＥＥＤＬＥ row and untouched surrounding wording  ';const r=issue(s=>s.claims[0].evidence[2].locator=value),html=render(r,{q:'locneedle'}),blocks=metadata(html);
 assert.equal(blocks.length,1);assert.ok(blocks[0].includes('<dt>Exact location</dt><dd>'+r.claims[0].evidence[2].locator+'</dd>'));assert.ok(!blocks[0].includes('<dt>Publisher</dt>'));assert.deepEqual(numbers(html),[3]);assert.ok(html.includes('Adds context · Search words in: Exact location'));assert.ok(!html.includes('<mark'));
});
test('all words across separate reference fields show each matching occurrence value and keep complete-statement conflict cautions',()=>{
 const r=issue(s=>{s.claims[0].evidence[0].publisher='Pubneedle original';s.claims[0].evidence[1].locator='Locneedle section';});const html=render(r,{q:'pubneedle locneedle'}),blocks=metadata(html);
 assert.equal(blocks.length,2);assert.ok(blocks[0].includes('<dd>Pubneedle original</dd>')&&!blocks[0].includes('Exact location'));assert.ok(blocks[1].includes('<dd>Locneedle section</dd>')&&!blocks[1].includes('<dt>Publisher</dt>'));assert.deepEqual(numbers(html),[1,2]);
 for(const text of ['Words may occur across different references','one or more search words','do not establish support or agreement','statement includes conflicting evidence','Points to a conflict'])assert.ok(html.includes(text),text);
});
test('empty statement-only title-only and nonmatching searches do not fabricate matching metadata or expand the source index to URL and dates',()=>{
 const r=issue(s=>{s.claims[0].assertion='Statementneedle';s.claims[0].evidence[0].title='Titleneedle';s.claims[0].evidence[0].publisher='PrivateNonmatchPublisher';});
 for(const query of [{},{q:'statementneedle'},{q:'titleneedle'},{q:'inventedmissingword'},{q:r.claims[0].evidence[0].url},{q:r.claims[0].evidence[0].retrievedAt}]){
  const html=render(r,query);assert.deepEqual(metadata(html),[]);assert.ok(!html.includes('PrivateNonmatchPublisher'));
 }
 assert.deepEqual(numbers(render(r,{q:'titleneedle'})),[1]);assert.ok(render(r,{q:'inventedmissingword'}).includes('does not establish that an action or evidence is absent elsewhere'));
});
test('changed absent unavailable and actual suspended or withdrawn rights reads withhold new metadata along with older assertions and links',async()=>{
 const r=issue(s=>{s.claims[0].evidence[0].publisher='PRIVATE_METADATA_CANARY';s.claims[0].evidence[0].locator='PRIVATE_METADATA_CANARY';});const next=structuredClone(r);next.publicationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const decisions=[{status:200,cacheControl:'no-store',issue:next},{status:404,cacheControl:'no-store'},{status:503,cacheControl:'no-store'}];
 for(const change of [rows=>{rows.sources[0].registration.allow_public_derived=false;},rows=>{rows.sources[0].registration.registration_state='suspended';}]){
  const rows=sample();change(rows);const decision=await createPublicIssueReader(async()=>new TextEncoder().encode(JSON.stringify(rows)),()=>0,async()=>false)(rows.requestedRoute);assert.equal(decision.status,503);decisions.push(decision);
 }
 for(const decision of decisions){const html=render(r,{q:'metadata'},decision);assert.deepEqual(metadata(html),[]);assert.deepEqual(numbers(html),[]);assert.ok(!html.includes('PRIVATE_METADATA_CANARY'));assert.ok(!html.includes(r.claims[0].assertion));}
});
test('filtered repeated occurrences keep exact numbering and escaped bounded publisher and locator values without exposing new dates or linked source URLs',()=>{
 const publisher='Pubneedle <img src="private-canary">',locator='Pubneedle '+ 'l'.repeat(290);const r=issue(s=>{const first=s.claims[0];first.evidence[0].publisher=publisher;first.evidence[0].locator=locator;first.evidence.push(structuredClone(first.evidence[0]));s.claims.push({...structuredClone(first),id:'66666666-6666-4666-8666-666666666666',type:'funding'});});
 const html=render(r,{q:'pubneedle',type:'funding'}),blocks=metadata(html);assert.equal(blocks.length,2);assert.deepEqual(numbers(html),[5,8]);for(const block of blocks){assert.ok(block.includes('<dd>'+esc(publisher)+'</dd>'));assert.ok(block.includes('<dd>'+locator+'</dd>'));assert.ok(!block.includes('Retrieved'));assert.ok(!block.includes('Source published'));}
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="https:'));assert.ok(html.includes('statement includes conflicting evidence'));
});
