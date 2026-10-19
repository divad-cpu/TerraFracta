import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup}from'react-dom/server';
import {loadTsx}from'./helpers/tsx_loader.mjs';
import {inventedSourceLanguageCandidate}from'../app/evidence-preview/source-language/example.ts';
import {syntheticReadRows}from'../app/evidence-preview/example.ts';
const route=new URL('../app/evidence-preview/source-language/page.tsx',import.meta.url);
test('production and test refuse before constructing or qualifying any source-language candidate',()=>{
 let constructions=0,qualifications=0;const marker=Error('NOT_FOUND');
 for(const NODE_ENV of ['production','test']){
  const Page=loadTsx(route,name=>name==='next/navigation'?{notFound(){throw marker;}}:name==='./example.ts'?{inventedSourceLanguageCandidate(){constructions++;assert.fail('No fixture');}}:name==='../../../src/server/source-language-sidecar.ts'?{materializeSourceLanguageSidecarFromRows(){qualifications++;assert.fail('No qualifier');}}:undefined,{env:{NODE_ENV}}).default;
  assert.throws(()=>Page(),e=>e===marker);
 }
 assert.equal(constructions,0);assert.equal(qualifications,0);
});
test('development exercise joins separate language candidate and unchanged v1 provenance with unique exact backlinks',t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('No source request'));
 const Page=loadTsx(route,name=>name==='next/navigation'?{notFound(){assert.fail('Development refused');}}:undefined).default;
 const html=renderToStaticMarkup(Page());assert.match(html,/Entirely invented language wording/);assert.match(html,/Unknown — no reviewed original-language/);assert.match(html,/Norwegian Bokmål and English/);assert.match(html,/Original language<\/dt><dd>Not supplied in this publication/);
 const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size);
 for(const[,target]of html.matchAll(/href="#([^"]+)"/g))assert.equal(ids.filter(id=>id===target).length,1,target);
 assert.doesNotMatch(html,/<form|<button|href="https?:/);
});
test('new example calls are isolated from each other and the original invented publication',()=>{
 const before=structuredClone(syntheticReadRows),first=inventedSourceLanguageCandidate(),second=inventedSourceLanguageCandidate();
 first.sidecar.sources[0].originalLanguage='MUTATED';first.rows.sources[0].version.content_sha256='0'.repeat(64);
 assert.notEqual(second.sidecar.sources[0].originalLanguage,'MUTATED');assert.equal(second.rows.sources[0].version.content_sha256,'a'.repeat(64));assert.deepEqual(syntheticReadRows,before);
 assert.equal(second.rows.publication.snapshot.schemaVersion,1);assert.equal(second.languageReviews.length,1);assert.equal(second.sidecar.sources[1].originalLanguage,null);
});
