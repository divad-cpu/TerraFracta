import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {searchMatchChunks} from '../src/search-match-chunks.ts';
import {loadTsx} from './helpers/tsx_loader.mjs';
const Text=loadTsx(new URL('../src/search-match-text.tsx',import.meta.url)).SearchMatchText;
const marked=(text,q)=>searchMatchChunks(text,q).filter(chunk=>chunk.matched).map(chunk=>chunk.text);
const render=(text,query)=>renderToStaticMarkup(createElement(Text,{text,query}));
test('literal overlapping repeated words merge original positions while preserving every character',()=>{
 assert.deepEqual(searchMatchChunks('banana and ANANAS','ana anan'),[{text:'b',matched:false},{text:'anana',matched:true},{text:' and ',matched:false},{text:'ANANA',matched:true},{text:'S',matched:false}]);
 assert.deepEqual(marked('Cell A1 and cell A2','cell cell A1'),['Cell','A1','cell']);
 for(const [text,q]of [['banana and ANANAS','ana anan'],['Cell A1 and cell A2','cell cell A1']])assert.equal(searchMatchChunks(text,q).map(chunk=>chunk.text).join(''),text);
});
test('compatibility glyph expansions accents and complete emoji graphemes retain original text',()=>{
 for(const [text,q,expected]of [['ＭＥＴＨＯＤ ﬁle ㎏','method file kg',['ＭＥＴＨＯＤ','ﬁle','㎏']],['Cafe\u0301 and CAFÉ','café',['Cafe\u0301','CAFÉ']],['👩🏽‍💻 here','👩',['👩🏽‍💻']],['xİy','i',['İ']]]){
  assert.deepEqual(marked(text,q),expected);assert.equal(searchMatchChunks(text,q).map(chunk=>chunk.text).join(''),text);
 }
});
test('complete-text context-sensitive lowercase selects the same sigma words as existing search',()=>{
 assert.deepEqual(marked('ΟΣ ΟΣΑ','ος'),['ΟΣ']);assert.deepEqual(marked('ΟΣ ΟΣΑ','οσ'),['ΟΣ']);
 const chunks=searchMatchChunks('ΟΣ ΟΣΑ','οσ');assert.equal(chunks.map(chunk=>chunk.text).join(''),'ΟΣ ΟΣΑ');assert.equal(chunks[0].matched,false);
});
test('empty invalid and absent query words leave exact unmarked display values',()=>{
 const text='Exact <text> & ﬁle';for(const query of ['', '   ','no-match',null,['file'],'x'.repeat(81),'\0','\ufdfa'.repeat(5)])assert.deepEqual(searchMatchChunks(text,query),[{text,matched:false}]);
 assert.deepEqual(searchMatchChunks('', 'word'),[{text:'',matched:false}]);
});
test('rendered matches escape both marked and unmarked source values without making HTML or addresses active',()=>{
 assert.equal(render('<script>canary</script> & https://example.invalid','canary'), '&lt;script&gt;<mark>canary</mark>&lt;/script&gt; &amp; https://example.invalid');
 assert.equal(render('Unchanged & exact',''), 'Unchanged &amp; exact');
 assert.ok(!render('<img src=x onerror=canary>','img').includes('<img'));
});
