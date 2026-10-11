import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { syntheticReadRows } from '../app/evidence-preview/example.ts';
import { parsePublicIssueProjection, publicIssueProjectionSchema } from '../src/public-issue-projection.ts';
import { issueSourceIndex, issueReferenceAnchor } from '../src/issue-source-index.ts';
import { currentIssueReferenceMatches, currentIssueSearchMatches, currentIssueSelection, currentIssueHref } from '../src/current-issue-navigation.ts';
import { evidenceLabels } from '../src/issue-display-labels.ts';

const { IssueEvidence } = loadTsx(new URL('../app/issue-evidence.tsx', import.meta.url));
const { CurrentIssueNavigationView } = loadTsx(new URL('../src/current-issue-navigation-view.tsx', import.meta.url));
function example() {
  const record = parsePublicIssueProjection(structuredClone(syntheticReadRows.envelope));
  const claim = record.claims[0];
  record.claims.push({ ...structuredClone(claim), id:'66666666-6666-4666-8666-666666666666', type:'delivery', assertion:'Second invented statement',
    evidence:[structuredClone(claim.evidence[0]), {...structuredClone(claim.evidence[1]),relation:'context'}] });
  return publicIssueProjectionSchema.parse(record);
}
const render = record => renderToStaticMarkup(createElement(IssueEvidence,{issue:record}));
const occurrences = record => record.claims.flatMap(claim => claim.evidence.map((source,index)=>({claim,source,index,anchor:issueReferenceAnchor(claim.id,index)})));
const indexed = record => issueSourceIndex(record).groups.flatMap(group=>group.references);
const citationLabels = html => new Map([...html.matchAll(/<li id="([^"]+)" class="citation-card[^"]*"><p class="citation-card__relation">([^<]+)<\/p>/g)].map(m=>[m[1],m[2]]));
function freeze(value) { if(value && typeof value==='object') { Object.values(value).forEach(freeze);Object.freeze(value); } return value; }

test('global ordinals precede source-version grouping and retain duplicated occurrences',()=>{
  const record=example(), groups=issueSourceIndex(record).groups;
  assert.deepEqual(groups.map(g=>g.references.map(r=>r.referenceNumber)),[[1,3,4],[2,5]]);
  assert.equal(issueSourceIndex(record).referenceCount,5);
  assert.equal(new Set(indexed(record).map(r=>r.anchor)).size,5);
});
test('reference and search filters agree with the complete index without renumbering',()=>{
  const record=example(), numbers=new Map(indexed(record).map(r=>[r.anchor,r.referenceNumber]));
  for(const query of [{query:'',statementType:'delivery',relation:''},{query:'footnote',statementType:'condition',relation:'context'},{query:'',statementType:'',relation:'contradicts'}]) {
    const rows=currentIssueReferenceMatches(record,query).references;
    assert.ok(rows.length);
    for(const row of rows) assert.equal(numbers.get(row.anchor),row.referenceNumber);
  }
  const search=currentIssueSearchMatches(record,'example','delivery');
  assert.equal(search.length,1);
  for(const row of search[0].matchedReferences) assert.equal(numbers.get(row.anchor),row.referenceNumber);
});
test('each actual citation shows its global ordinal and its separate within-statement position and role',()=>{
  const record=example(), html=render(record), labels=citationLabels(html);
  assert.equal(labels.size,5);
  occurrences(record).forEach((row,i)=>assert.equal(labels.get(row.anchor),`Reference ${i+1} · ${evidenceLabels[row.source.relation]} · ${row.index+1} of ${row.claim.evidence.length} for this statement`));
  assert.ok(html.includes('Reference numbers identify occurrences in statement and reference order within this publication. They do not identify independent sources.'));
});
test('every source-reuse return label identifies the same ordinal as its citation target',()=>{
  const record=example(), html=render(record), labels=citationLabels(html);
  occurrences(record).forEach((row,i)=>{
    const escapedTitle=row.source.title.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#x27;');
    assert.ok(html.includes(`href="#${row.anchor}">Reference ${i+1}: ${escapedTitle}`));
    assert.ok(labels.get(row.anchor).startsWith(`Reference ${i+1} ·`));
    assert.equal(html.split(`id="${row.anchor}"`).length-1,1);
  });
  assert.ok(html.includes('These counts do not establish independent confirmation'));
  assert.ok(!html.includes('href="https:'));
});
test('numbering preserves exact metadata, anchors, first-occurrence group order and frozen input',()=>{
  const record=example();record.claims[0].evidence[2].title='<script>title-canary</script>';
  record.claims[0].evidence[2].sourcePublishedOn=null;
  const before=structuredClone(record);freeze(record);
  const rows=indexed(record);const expected=occurrences(record);
  for(const [i,row] of expected.entries()) {
    const match=rows.find(r=>r.anchor===row.anchor);assert.equal(match.referenceNumber,i+1);
    assert.equal(match.claim,row.claim);assert.equal(match.source,row.source);
  }
  const html=render(record);
  assert.ok(html.includes('&lt;script&gt;title-canary'));assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('No verified source publication date supplied'));
  assert.ok(html.includes('Conflicting evidence is included'));assert.deepEqual(record,before);
});
test('all360 bounded reference occurrences retain unique ordinals and exact visible targets',()=>{
  const record=example(), base=record.claims[0];
  record.claims=Array.from({length:30},(_,i)=>({...structuredClone(base),id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(i+1).padStart(12,'0')}`,
    evidence:Array.from({length:12},(_,j)=>({...structuredClone(base.evidence[0]),sourceVersionId:`bbbbbbbb-bbbb-4bbb-8bbb-${String((i*12+j)%120+1).padStart(12,'0')}`,locator:`Cell ${i}:${j}`}))}));
  const checked=publicIssueProjectionSchema.parse(record), rows=indexed(checked), html=render(checked), labels=citationLabels(html);
  assert.deepEqual(rows.map(r=>r.referenceNumber).sort((a,b)=>a-b),Array.from({length:360},(_,i)=>i+1));
  assert.equal(issueSourceIndex(checked).groups.length,120);assert.equal(labels.size,360);
  occurrences(checked).forEach((row,i)=>assert.ok(labels.get(row.anchor).startsWith(`Reference ${i+1} ·`)));
});
test('changed absent and unavailable current editions expose no numbered citation or source-reuse target',()=>{
  const record=example(), next=structuredClone(record);next.publicationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  for(const decision of [{status:200,cacheControl:'no-store',issue:next},{status:404,cacheControl:'no-store'},{status:503,cacheControl:'no-store'}]) {
    const html=renderToStaticMarkup(createElement(CurrentIssueNavigationView,{decision,selection:currentIssueSelection('issue',{edition:record.publicationId}),latestHref:currentIssueHref(record,'issue',false)}));
    assert.equal(citationLabels(html).size,0);assert.ok(!html.includes('#reference-'));assert.ok(!html.includes('Source reuse in this dossier'));
    assert.ok(!html.includes(record.claims[0].assertion));
  }
});
