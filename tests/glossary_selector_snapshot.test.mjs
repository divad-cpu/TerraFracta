import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { findGlossaryTerms,glossaryTerms } from '../src/evidence-glossary.ts';
const Guide=loadTsx(new URL('../app/methodology/glossary/page.tsx',import.meta.url)).default;
const page=async query=>renderToStaticMarkup(await Guide({searchParams:Promise.resolve(query)}));
const slugs=result=>result.terms.map(term=>term.slug);
const invalid=result=>{assert.equal(result.kind,'invalid');assert.equal(result.query,'');assert.equal(result.category,'');assert.deepEqual(result.terms,[])};

test('query and category first admitted values each select the guide once without getter drift',async()=>{
 for(const actualPage of [false,true]){let q=0,category=0;const query={get q(){q++;return q===1?'  ＭＯＮＥＹ spent ':'policy effect'},get category(){category++;return category===1?'statements':'dates'}};
 if(actualPage){const html=await page(query);assert.match(html,/1 term matches/);assert.match(html,/id="funding"/);assert.doesNotMatch(html,/id="evaluation"/);assert.match(html,/value="MONEY spent"/)}else{const result=findGlossaryTerms(query);assert.equal(result.query,'MONEY spent');assert.equal(result.category,'statements');assert.deepEqual(slugs(result),['funding'])}
 assert.equal(q,1);assert.equal(category,1)}
});

test('inherited and nonenumerable search values stay absent and unobserved in parser and actual guide',async()=>{
 for(const hidden of [false,true])for(const actualPage of [false,true]){let observations=0;const base={get q(){observations++;throw Error('HIDDEN_PRIVATE')},get category(){observations++;throw Error('HIDDEN_PRIVATE')}};const query=Object.create(base);if(hidden){Object.defineProperty(query,'q',{get(){observations++;throw Error('HIDDEN_PRIVATE')}});Object.defineProperty(query,'category',{get(){observations++;throw Error('HIDDEN_PRIVATE')}})}
 if(actualPage){const html=await page(query);assert.match(html,/19 terms match/);assert.doesNotMatch(html,/HIDDEN_PRIVATE/)}else assert.deepEqual(slugs(findGlossaryTerms(query)),glossaryTerms.map(term=>term.slug));assert.equal(observations,0)}
});

test('own field getter faults become detail-free invalid recovery without replacing framework rendering',async()=>{
 for(const field of ['q','category']){let reads=0;const make=()=>({[field]:undefined});const one=make();Object.defineProperty(one,field,{enumerable:true,get(){reads++;throw Error('PRIVATE_INPUT_FAULT')}});invalid(findGlossaryTerms(one));assert.equal(reads,1);
 const two=make();Object.defineProperty(two,field,{enumerable:true,get(){reads++;throw Error('PRIVATE_INPUT_FAULT')}});const html=await page(two);assert.equal(reads,2);assert.match(html,/Check your search/);assert.match(html,/href="\/methodology\/glossary"/);assert.doesNotMatch(html,/PRIVATE_INPUT_FAULT|id="funding"/)}
});

test('enumeration faults or revoked query objects become the same generic invalid guide state',async()=>{
 const enumerated=()=>new Proxy({},{ownKeys(){throw Error('PRIVATE_KEYS')}});invalid(findGlossaryTerms(enumerated()));const html=await page(enumerated());assert.match(html,/Check your search/);assert.doesNotMatch(html,/PRIVATE_KEYS|id="funding"/);
 // A revoked query cannot reach an awaited page: Promise resolution itself
 // observes its then property. Test the unknown-input parser directly.
 const{proxy,revoke}=Proxy.revocable({},{});revoke();invalid(findGlossaryTerms(proxy));
});

test('extra selector admission veto runs before any allowed-field getter observation',async()=>{
 let reads=0;const query={extra:'PRIVATE_EXTRA',get q(){reads++;throw Error('PRIVATE_QUERY')},get category(){reads++;throw Error('PRIVATE_CATEGORY')}};invalid(findGlossaryTerms(query));assert.equal(reads,0);const html=await page(query);assert.equal(reads,0);assert.match(html,/Check your search/);assert.doesNotMatch(html,/PRIVATE_EXTRA|PRIVATE_QUERY|PRIVATE_CATEGORY/)
});

test('normal empty undefined normalized and bounded malformed inputs preserve established guide meaning',async()=>{
 for(const value of [{},{q:undefined},{category:undefined},{q:undefined,category:undefined}]){const r=findGlossaryTerms(value);assert.equal(r.kind,'valid');assert.equal(r.query,'');assert.equal(r.category,'');assert.deepEqual(slugs(r),glossaryTerms.map(term=>term.slug))}
 assert.deepEqual(slugs(findGlossaryTerms({q:'policy effect',category:'statements'})),['evaluation']);assert.deepEqual(slugs(findGlossaryTerms({category:'dates'})),['data-period','source-published','retrieved','evidence-review','publication-revision']);assert.deepEqual(slugs(findGlossaryTerms({q:'money',category:'dates'})),[]);
 for(const value of [{q:['money']},{category:['dates']},{q:null},{category:null},{category:'__proto__'},{q:'a'.repeat(81)},{q:'\u0000'},{q:'ﬄ'.repeat(30)}])invalid(findGlossaryTerms(value));
 const before=JSON.stringify(glossaryTerms);await page({q:'money',category:'statements'});assert.equal(JSON.stringify(glossaryTerms),before)
});
