import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
const paths=['../app/methodology/glossary/page.tsx','../app/methodology/page.tsx','../app/sources/page.tsx'];
const Pages=paths.map(p=>loadTsx(new URL(p,import.meta.url)).default);
const back='/reader-preview/norway/housing-costs/issue?edition=11111111-1111-4111-8111-111111111111';
const html=async(Page,searchParams)=>renderToStaticMarkup(await Page({searchParams}));
function held(s,i){assert.doesNotMatch(s,/PRIVATE_CANARY|Back to the selected dossier|name="returnTo"|href="https:\/\/PRIVATE/);assert.match(s,i===0?/Check your search/:i===1?/How TerraFracta reads an issue/:/What a source should tell you/);if(i===2)assert.match(s,/No source connected/)}

test('rejected query port retains educational page with existing invalid or absent-return behavior',async()=>{
 for(const [i,Page]of Pages.entries())for(const fault of [Error('PRIVATE_CANARY'),null,'PRIVATE_CANARY']){const s=await html(Page,Promise.reject(fault));held(s,i)}
});

test('throwing then getter and rejected thenable are observed once and reveal no return or exception detail',async()=>{
 for(const [i,Page]of Pages.entries())for(const form of ['getter','reject']){let observed=0;const port=form==='getter'?{get then(){observed++;throw Error('PRIVATE_CANARY')}}:{then(resolve,reject){observed++;reject(Error('PRIVATE_CANARY'))}};held(await html(Page,port),i);assert.equal(observed,1)}
});

test('successful async query still captures admitted return once and preserves original guide category',async()=>{
 for(const [i,Page]of Pages.entries()){let reads=0;const input={get returnTo(){reads++;return reads===1?back:'https://PRIVATE.invalid'}};const s=await html(Page,Promise.resolve(input));assert.equal(reads,1);assert.ok(s.includes('href="'+back+'"'));assert.doesNotMatch(s,/PRIVATE/);if(i===0)assert.match(s,/22 terms match/);if(i===2)assert.match(s,/&amp;category=evidence/)}
});

test('resolved invalid selectors keep established search or context refusal without triggering a retry',async()=>{
 for(const [i,Page]of Pages.entries())for(const input of [null,{returnTo:'https://PRIVATE_CANARY.invalid'},{extra:'PRIVATE_CANARY',get returnTo(){assert.fail('veto must precede getter')}}]){let resolves=0;const s=await html(Page,{then(resolve){resolves++;resolve(input)}});held(s,i);assert.equal(resolves,1)}
});


test('successful hidden then property is never assimilated a second time during helper return',async()=>{
 for(const [i,Page]of Pages.entries())for(const kind of ['throw','reject']){
  let observations=0;const values={returnTo:back};Object.defineProperty(values,'then',{get(){observations++;if(observations===1)return undefined;if(kind==='throw')throw Error('PRIVATE_CANARY');return(resolve,reject)=>reject(Error('PRIVATE_CANARY'))}});
  const s=await html(Page,values);assert.equal(observations,1);assert.ok(s.includes('href="'+back+'"'));assert.doesNotMatch(s,/PRIVATE_CANARY/);if(i===0)assert.match(s,/22 terms match/);
 }
});
