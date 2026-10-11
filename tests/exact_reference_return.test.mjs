import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { syntheticReadRows } from '../app/evidence-preview/example.ts';
import { parsePublicIssueProjection } from '../src/public-issue-projection.ts';
import { currentIssueReferenceMatches, currentIssueSelection, currentIssueHref } from '../src/current-issue-navigation.ts';

const {CurrentIssueNavigationView:View}=loadTsx(new URL('../src/current-issue-navigation-view.tsx',import.meta.url));
// Invented syntactically closed projections. No live eligibility is inferred.
function issue(change=()=>{}) {const envelope=structuredClone(syntheticReadRows.envelope);change(envelope.publication.snapshot);return parsePublicIssueProjection(envelope);}
const render=(record,query={},decision={status:200,cacheControl:'no-store',issue:record})=>renderToStaticMarkup(createElement(View,{
  decision,selection:currentIssueSelection('sources',{edition:record.publicationId,...query}),latestHref:currentIssueHref(record,'sources',false)}));
const full=record=>renderToStaticMarkup(createElement(View,{decision:{status:200,cacheControl:'no-store',issue:record},
  selection:currentIssueSelection('issue',{edition:record.publicationId}),latestHref:currentIssueHref(record,'issue',false)}));
const referenceLinks=html=>[...html.matchAll(/href="([^"]+)"[^>]*>Read reference (\d+) in the statement<\/a>/g)].map(m=>({href:m[1].replaceAll('&amp;','&'),number:Number(m[2])}));

test('reused source versions retain separate exact reference anchors before filtering',()=>{
  const record=issue(),before=structuredClone(record),rows=currentIssueReferenceMatches(record,{query:'',statementType:'',relation:''});
  assert.deepEqual(rows.references.map(r=>[r.referenceNumber,r.anchor]),[[1,`reference-${record.claims[0].id}-1`],[2,`reference-${record.claims[0].id}-2`],[3,`reference-${record.claims[0].id}-3`]]);
  assert.equal(rows.references[0].source.sourceVersionId,rows.references[2].source.sourceVersionId);assert.deepEqual(record,before);
});
test('filtering to a later locator keeps its original within-statement position and reference number',()=>{
  const record=issue();const rows=currentIssueReferenceMatches(record,{query:'footnote',statementType:'condition',relation:'context'});
  assert.equal(rows.references.length,1);assert.equal(rows.references[0].referenceNumber,3);assert.equal(rows.references[0].anchor,`reference-${record.claims[0].id}-3`);
  assert.equal(rows.dossierConflictReferences,1);assert.equal(rows.total,3);
});
test('identical repeated references and reused versions across statements remain distinct occurrences',()=>{
  const record=issue(s=>{s.claims[0].evidence.push(structuredClone(s.claims[0].evidence[0]));
    s.claims.push({...structuredClone(s.claims[0]),id:'66666666-6666-4666-8666-666666666666'});}),before=structuredClone(record);
  const rows=currentIssueReferenceMatches(record,{query:'cell A1',statementType:'',relation:'supports'}).references;
  assert.deepEqual(rows.map(r=>r.referenceNumber),[1,4,5,8]);
  assert.deepEqual(rows.map(r=>r.anchor),[`reference-${record.claims[0].id}-1`,`reference-${record.claims[0].id}-4`,`reference-${record.claims[1].id}-1`,`reference-${record.claims[1].id}-4`]);
  assert.equal(new Set(rows.map(r=>r.anchor)).size,4);assert.deepEqual(record,before);
});
test('filtered source return goes to the exact citation in the same edition, without transferring filters',()=>{
  const record=issue(),html=render(record,{q:'footnote',type:'condition',relation:'context'}),links=referenceLinks(html);
  assert.equal(links.length,1);assert.equal(links[0].number,3);
  const url=new URL(links[0].href,'https://example.invalid');assert.equal(url.pathname,`/reader-preview/${record.jurisdictionSlug}/${record.issueSlug}/issue`);
  assert.deepEqual(Object.fromEntries(url.searchParams),{edition:record.publicationId});assert.equal(url.hash,`#reference-${record.claims[0].id}-3`);
  assert.ok(full(record).includes('id="'+url.hash.slice(1)+'"'));assert.ok(html.includes('complete dossier includes conflicting evidence'));
  assert.ok(html.includes('statement also includes conflicting evidence'));assert.ok(!html.includes('href="https:'));
});
test('every rendered reference return reaches one existing citation, including duplicated occurrences',()=>{
  const record=issue(s=>s.claims[0].evidence.push(structuredClone(s.claims[0].evidence[0]))),html=render(record),dossier=full(record),links=referenceLinks(html);
  assert.equal(links.length,4);assert.equal(new Set(links.map(x=>x.href)).size,4);
  for(const link of links){const id=new URL(link.href,'https://example.invalid').hash.slice(1);assert.equal(dossier.split('id="'+id+'"').length-1,1);}
  for(const text of ['4 exact references','not a count of independent sources','complete dossier includes conflicting evidence','Original language was not supplied'])assert.ok(html.includes(text),text);
});
test('changed, absent and unavailable editions expose no old reference return links',()=>{
  const record=issue(),next=structuredClone(record);next.publicationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  for(const decision of [{status:200,cacheControl:'no-store',issue:next},{status:404,cacheControl:'no-store'},{status:503,cacheControl:'no-store'}]){
    const html=render(record,{},decision);assert.equal(referenceLinks(html).length,0);assert.ok(!html.includes('#reference-'));
    assert.ok(!html.includes(record.claims[0].evidence[0].locator));assert.ok(!html.includes(record.claims[0].assertion));
  }
});
test('empty reference search retains recovery and whole-dossier uncertainty without inventing a citation',()=>{
  const html=render(issue(),{q:'missing invented term'});assert.equal(referenceLinks(html).length,0);
  for(const text of ['No reference matches these filters','does not establish that evidence is absent elsewhere','Show all references in this publication','complete dossier includes conflicting evidence'])assert.ok(html.includes(text),text);
});
