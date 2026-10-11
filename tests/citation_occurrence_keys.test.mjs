import assert from 'node:assert/strict';import test from 'node:test';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
import {syntheticReadRows} from '../app/evidence-preview/example.ts';
import {parsePublicIssueProjection} from '../src/public-issue-projection.ts';
const {IssueEvidence}=loadTsx(new URL('../app/issue-evidence.tsx',import.meta.url));
function issue(){const envelope=structuredClone(syntheticReadRows.envelope);const first=envelope.publication.snapshot.claims[0];first.evidence.push(structuredClone(first.evidence[0]));
  envelope.publication.snapshot.claims.push({...structuredClone(first),id:'66666666-6666-4666-8666-666666666666'});return parsePublicIssueProjection(envelope);}
function citationLists(tree){const lists=[];function walk(node){if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object'||!node.props)return;
  if(node.props.className==='citation-grid')lists.push(node.props.children);walk(node.props.children);}walk(tree);return lists;}
test('actual React citation siblings have unique deterministic identities for repeated same-version locators',()=>{
  const record=issue(),before=structuredClone(record),lists=citationLists(IssueEvidence({issue:record})),second=citationLists(IssueEvidence({issue:structuredClone(record)}));
  assert.equal(lists.length,2);for(const rows of lists){assert.equal(rows.length,4);assert.equal(new Set(rows.map(x=>x.key)).size,4);assert.equal(new Set(rows.map(x=>x.props.id)).size,4);}
  assert.deepEqual(lists.map(rows=>rows.map(x=>x.key)),second.map(rows=>rows.map(x=>x.key)));assert.deepEqual(record,before);
});
test('citation occurrence identity does not merge repeated references or depend on mutable display metadata',()=>{
  const original=issue(),changed=structuredClone(original);changed.claims[0].evidence[0].locator='Another invented locator';changed.claims[0].evidence[0].title='Another invented title';
  const before=citationLists(IssueEvidence({issue:original})),after=citationLists(IssueEvidence({issue:changed}));
  assert.deepEqual(before.map(rows=>rows.map(x=>x.key)),after.map(rows=>rows.map(x=>x.key)));
  // This inspects two invented display trees, not an editable/current publication.
  assert.ok(after[0][0].props.children.some(x=>x?.type==='h4'&&x.props.children==='Another invented title'));
});
test('all repeated citation DOM targets and source caution remain intact after the key repair',()=>{
  const record=issue(),html=renderToStaticMarkup(createElement(IssueEvidence,{issue:record}));
  for(const claim of record.claims)for(let n=1;n<=4;n++)assert.equal(html.split(`id="reference-${claim.id}-${n}"`).length-1,1);
  assert.ok(html.includes('8 exact references'));assert.ok(html.includes('counts do not establish independent confirmation'));
  assert.ok(html.includes('Conflicting evidence is included'));assert.ok(!html.includes('href="https:'));
});
