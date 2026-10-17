import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx_loader.mjs';
const navigation=createRequire(import.meta.url)('next/navigation');
const marker=Symbol('production refusal');
const file=new URL('../app/editorial-preview/exceptions/page.tsx',import.meta.url);
const page=(mode='development')=>loadTsx(file,name=>name==='next/navigation'?{...navigation,notFound(){throw marker;}}:undefined,{env:{NODE_ENV:mode}}).default;
const render=async(input)=>renderToStaticMarkup(await page()(input));
function recovered(html){
 assert.match(html,/Check the workspace link/);assert.match(html,/No private reader was called/);
 assert.match(html,/href="\/editorial-preview\/exceptions"/);assert.doesNotMatch(html,/PRIVATE_CANARY|Follow a held candidate|Current source health is unavailable/);
}

test('ordinary failed exception-overview selector ports use the existing generic recovery without echoing',async()=>{
 for(const input of [
  {searchParams:Promise.reject(Error('PRIVATE_CANARY'))},
  {get searchParams(){throw Error('PRIVATE_CANARY');}},
  {searchParams:{get then(){throw Error('PRIVATE_CANARY');}}},
 ])recovered(await render(input));
});

test('malformed empty-looking overview queries and own-key faults cannot masquerade as a valid workspace',async()=>{
 for(const value of [null,undefined,[],()=>{},'',0,new Proxy({},{ownKeys(){throw Error('PRIVATE_CANARY');}})])recovered(await render({searchParams:Promise.resolve(value)}));
});

test('trusted Next interruptions and nondevelopment refusal preserve identity before recovery or query access',async()=>{
 for(const digest of ['NEXT_HTTP_ERROR_FALLBACK;404','NEXT_REDIRECT;replace;/editorial-preview/exceptions;307;']){
  const error=Object.assign(Error('PRIVATE_CANARY'),{digest});
  await assert.rejects(page()({searchParams:Promise.reject(error)}),value=>value===error);
  await assert.rejects(page()({get searchParams(){throw error;}}),value=>value===error);
 }
 for(const mode of ['production','test',''])await assert.rejects(page(mode)({get searchParams(){assert.fail('Query observed before refusal');}}),value=>value===marker);
});

test('valid no-selector overview and existing nonempty-selector recovery retain content without rereading hidden fields',async()=>{
 let observed=0;const query=Object.create(null);Object.defineProperty(query,'then',{get(){observed++;if(observed>1)throw Error('PRIVATE_CANARY');return undefined;}});
 const ordinary=await render({searchParams:Promise.resolve({})});const exact=await render({searchParams:query});
 assert.equal(observed,1);assert.equal(exact,ordinary);assert.match(exact,/Follow a held candidate/);assert.match(exact,/Current source health is unavailable/);
 const unwanted={};Object.defineProperty(unwanted,'provider',{enumerable:true,get(){assert.fail('Unaccepted selector read');}});
 recovered(await render({searchParams:Promise.resolve(unwanted)}));
});


test('ordinary classifier cause and metadata observation faults still use generic overview recovery',async()=>{
 for(const mode of ['cause','self','digest']){
  const original=Error('PRIVATE_CANARY'),secondary=Error('PRIVATE_CANARY_SECOND');
  if(mode==='digest')Object.defineProperty(original,'digest',{get(){throw original;}});
  else Object.defineProperty(original,'cause',{get(){throw mode==='self'?original:secondary;}});
  const query=new Proxy({},{ownKeys(){throw original;}});
  recovered(await render({searchParams:Promise.resolve(query)}));
  recovered(await render({searchParams:Promise.reject(original)}));
 }
});

test('cause-nested installed Next interruptions retain exact native signal identity',async()=>{
 for(const make of [()=>navigation.notFound(),()=>navigation.redirect('/editorial-preview/exceptions')]){
  let signal;try{make();}catch(error){signal=error;}assert.ok(signal);
  const wrapped=Error('PRIVATE_CANARY',{cause:Error('PRIVATE_CANARY',{cause:signal})});
  for(const input of [{searchParams:Promise.reject(wrapped)},{get searchParams(){throw wrapped;}},{searchParams:Promise.resolve(new Proxy({},{ownKeys(){throw wrapped;}}))}])
   await assert.rejects(page()(input),value=>value===signal);
 }
});
