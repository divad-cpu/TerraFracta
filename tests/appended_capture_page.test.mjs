import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {renderToStaticMarkup} from 'react-dom/server';import {loadTsx} from './helpers/tsx_loader.mjs';
const route=new URL('../app/editorial-preview/capture-sample/page.tsx',import.meta.url),fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-appended-capture.json',import.meta.url),'utf8'));
test('production and test refuse before the saved comparison is rendered',()=>{
 let calls=0;const marker=Error('NOT_FOUND');for(const NODE_ENV of ['production','test']){const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:name==='../../../src/appended-capture-view.tsx'?{AppendedCaptureView(){calls++;throw Error('VIEW');}}:undefined,{env:{NODE_ENV}});assert.throws(()=>page.default(),e=>e===marker);}assert.equal(calls,0);
});
test('development fixed example keeps retained observations explicit and returns to the existing preparation flow',()=>{
 const page=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw Error('NOT_FOUND');}}:name==='../../../fixtures/fictional-appended-capture.json'?{default:fixture()}:undefined);const html=renderToStaticMarkup(page.default());
 assert.equal(page.dynamic,'force-dynamic');assert.deepEqual(page.metadata.robots,{index:false,follow:false});for(const phrase of ['development gate is not authentication','Saved whole-issue composition comparison','2 preserved statements','no new database read'])assert.ok(html.includes(phrase),phrase);
 for(const path of ['/editorial-preview/append-review-sample','/editorial-preview/preparation-history','/editorial-preview'])assert.ok(html.includes('href="'+path+'"'),path);assert.doesNotMatch(html,/<form|<button|<input/);
});
test('desk and unsaved wholeissue route label the distinct saved comparison',()=>{
 for(const path of ['../app/editorial-preview/page.tsx','../app/editorial-preview/append-review-sample/page.tsx'])assert.match(readFileSync(new URL(path,import.meta.url),'utf8'),/href="\/editorial-preview\/capture-sample"/);
});
