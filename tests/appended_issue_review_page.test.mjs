import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/append-review-sample/page.tsx',import.meta.url),fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-issue-review.json',import.meta.url),'utf8'));
test('production/test gates refuse before loading the wholeissue view',()=>{
 let calls=0;const marker=Error('NOT_FOUND');for(const NODE_ENV of ['production','test']){
  const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:name==='../../../src/appended-issue-review-view.tsx'?{AppendedIssueReviewView(){calls++;throw Error('VIEW');}}:undefined,{env:{NODE_ENV}});
  assert.throws(()=>page.default(),e=>e===marker);
 }assert.equal(calls,0);
});
test('fixed invented development example links the existing chain without mutation or publication controls',()=>{
 const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw Error('NOT_FOUND');}}:name==='../../../fixtures/fictional-appended-issue-review.json'?{default:fixture()}:undefined);
 const html=renderToStaticMarkup(page.default());assert.equal(page.dynamic,'force-dynamic');assert.deepEqual(page.metadata.robots,{index:false,follow:false});
 for(const phrase of ['development gate is not authentication','Whole-issue preparation for review','2 preserved statements','Proposed appended statement 3'])assert.ok(html.includes(phrase),phrase);
 assert.match(html,/href="\/editorial-preview\/preparation-sample"/);assert.match(html,/href="\/editorial-preview"/);assert.doesNotMatch(html,/<form|<button|<input/);
});
test('desk and singlecandidate route offer labelled paths into the complete issue example',()=>{
 for(const path of ['../app/editorial-preview/page.tsx','../app/editorial-preview/preparation-sample/page.tsx'])
  assert.match(readFileSync(new URL(path,import.meta.url),'utf8'),/href="\/editorial-preview\/append-review-sample"/);
});
