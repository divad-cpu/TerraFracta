import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {parsePublicIssueProjection} from '../src/public-issue-projection.ts';
import {syntheticReadRows} from '../app/evidence-preview/example.ts';
import {currentIssueSelection} from '../src/current-issue-navigation.ts';
import {createPublicIssueReader,canonicalPublicIssueRoute} from '../src/server/public-issue-reader.ts';
import {sample} from './helpers/public_read_rows_fixture.mjs';
const View=loadTsx(new URL('../src/current-issue-navigation-view.tsx',import.meta.url)).CurrentIssueNavigationView;
const issue=()=>parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
const render=(value,query={},status=200)=>renderToStaticMarkup(createElement(View,{decision:{status,cacheControl:'no-store',...(status===200?{issue:value}:{})},selection:currentIssueSelection('sources',{edition:value.publicationId,...query}),latestHref:'/reader-preview/imaginary-place/sample-housing-measure/sources'}));
const links=html=>[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>({href:m[1].replaceAll('&amp;','&'),label:m[2]}));
const reuseLinks=html=>links(html).filter(link=>link.label==='Inspect this source version in the complete dossier');
const query=u=>Object.fromEntries(u.searchParams);
const sourceCards=html=>[...html.matchAll(/<li class="current-source-entry--[^"]+">([\s\S]*?)<\/li>/g)].map(m=>m[1]);
test('filtered source reference discloses complete-dossier reuse and keeps exact edition and filters',()=>{
  const value=issue(),html=render(value,{q:'cell A1',type:'condition',relation:'supports'}),cards=sourceCards(html);
  assert.equal(cards.length,1);assert.ok(cards[0].includes('Recorded source version reference'));assert.ok(cards[0].includes(value.claims[0].evidence[0].sourceVersionId));
  assert.ok(cards[0].includes('In the complete dossier: 2 exact references across 1 statement'));
  assert.ok(cards[0].includes('Repeated use does not establish independent confirmation'));assert.ok(cards[0].includes('Current filters may hide other uses'));
  const target=new URL(reuseLinks(html)[0].href,'https://example.invalid');assert.equal(target.hash,'#recorded-source-group-1');
  assert.deepEqual(query(target),{edition:value.publicationId,returnView:'sources',returnQ:'cell A1',returnType:'condition',returnRelation:'supports'});
  assert.ok(html.includes('complete dossier includes conflicting evidence'));assert.ok(!html.includes('href="https:'));
});
test('cross-statement reuse retains contrasting metadata and same origin never merges exact versions',()=>{
  const value=issue(),first=value.claims[0],version=first.evidence[0];
  value.claims=[{...first,evidence:[version]},{...first,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',assertion:'Another invented statement',evidence:[{...version,relation:'contradicts',locator:'Other cell',title:'Literal <second> title',sourcePublishedOn:null},{...version,sourceVersionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',relation:'supports',locator:'New-version cell'}]}];
  const before=structuredClone(value),html=render(value),cards=sourceCards(html);assert.equal(cards.length,3);assert.equal(reuseLinks(html).length,3);
  assert.ok(cards[0].includes('2 exact references across 2 statements'));assert.ok(cards[1].includes('2 exact references across 2 statements'));assert.ok(cards[1].includes('Literal &lt;second&gt; title'));assert.ok(cards[1].includes('Points to a conflict'));
  assert.ok(cards[2].includes('1 exact reference across 1 statement'));assert.ok(!cards[2].includes('Repeated use'));assert.ok(reuseLinks(html)[2].href.endsWith('#recorded-source-group-2'));
  assert.deepEqual(value,before);
});
test('singleton versions keep one exact target and reuse counts remain linear at thirty statements',()=>{
  const value=issue(),base=value.claims[0];value.claims=Array.from({length:30},(_,c)=>({...base,id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(c+1).padStart(12,'0')}`,evidence:Array.from({length:12},(_,r)=>({...base.evidence[0],locator:`Cell ${c}:${r}`}))}));
  const html=render(value,{relation:'supports'});assert.equal(sourceCards(html).length,360);assert.equal(reuseLinks(html).length,360);
  assert.equal((html.match(/In the complete dossier: 360 exact references across 30 statements/g)??[]).length,360);
  assert.ok(reuseLinks(html).every(link=>link.href.endsWith('#recorded-source-group-1')));
});
test('no-match changed absent and held decisions reveal no contextual version information',()=>{
  const value=issue();const none=render(value,{q:'NO_MATCH'});assert.equal(sourceCards(none).length,0);assert.equal(reuseLinks(none).length,0);assert.ok(!none.includes('Recorded source version reference'));
  for(const decision of [{status:404,cacheControl:'no-store'},{status:503,cacheControl:'no-store'},{status:200,cacheControl:'no-store',issue:{...value,publicationId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}}]){
    const html=renderToStaticMarkup(createElement(View,{decision,selection:currentIssueSelection('sources',{edition:value.publicationId,q:'private-query-canary'}),latestHref:'/reader-preview/imaginary-place/sample-housing-measure/sources'}));
    assert.equal(reuseLinks(html).length,0);assert.ok(!html.includes('In the complete dossier:'));assert.ok(!html.includes(value.claims[0].evidence[0].sourceVersionId));assert.ok(!html.includes('private-query-canary'));
  }
});
test('actual native reader pages reach the exact existing reuse group and selected source results then withhold a rights-held reread',async()=>{
  let supplied=sample();const route=supplied.requestedRoute,calls=[],signals=[];
  const reader=createPublicIssueReader(async(scope,signal)=>{calls.push(structuredClone(scope));signals.push(signal);return new TextEncoder().encode(JSON.stringify(supplied));},()=>0,()=>assert.fail('unexpected diagnostic'));
  const intercept=name=>name==='next/navigation'?{notFound(){assert.fail('unexpected notFound');},unstable_rethrow(){}}:name.includes('server/public-issue-reader')?{canonicalPublicIssueRoute,readPublicIssue:reader}:undefined;
  const page=loadTsx(new URL('../app/reader-preview/[country]/[issue]/[view]/page.tsx',import.meta.url),intercept).default;
  const value=issue(),selected={edition:value.publicationId,q:'cell A1',type:'condition',relation:'supports'};
  const first=renderToStaticMarkup(await page({params:Promise.resolve({country:route.jurisdictionSlug,issue:route.issueSlug,view:'sources'}),searchParams:Promise.resolve(selected)}));
  const target=new URL(reuseLinks(first)[0].href,'https://example.invalid');
  const dossier=renderToStaticMarkup(await page({params:Promise.resolve({country:route.jurisdictionSlug,issue:route.issueSlug,view:'issue'}),searchParams:Promise.resolve(query(target))}));
  assert.equal((dossier.match(/id="recorded-source-group-1"/g)??[]).length,1);assert.ok(dossier.includes(value.claims[0].evidence[0].sourceVersionId));
  const back=new URL(links(dossier).find(link=>link.label==='Back to selected results').href,'https://example.invalid');assert.deepEqual(query(back),selected);
  supplied=structuredClone(supplied);supplied.sources[0].registration.allow_public_derived=false;
  const held=renderToStaticMarkup(await page({params:Promise.resolve({country:route.jurisdictionSlug,issue:route.issueSlug,view:'sources'}),searchParams:Promise.resolve(query(back))}));
  assert.ok(held.includes('Issue temporarily unavailable'));assert.equal(reuseLinks(held).length,0);assert.ok(!held.includes(value.claims[0].evidence[0].sourceVersionId));assert.deepEqual(calls,[route,route,route]);assert.ok(signals.every(signal=>signal.aborted));
});
