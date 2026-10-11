import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { proposedPayload, proposalId } from './helpers/proposal_fixture.mjs';
const url=new URL('../src/recorded-reference-differences.ts',import.meta.url);
// A missing new helper is an explicit original feature-absence witness, not a substitute implementation.
const api=existsSync(url)?await import(url.href):null;
const compare=(a,b)=>{assert.equal(typeof api?.compareRecordedReferenceOccurrences,'function','Reference occurrence comparison is absent');return api.compareRecordedReferenceOccurrences(a,b);};
const refs=()=>structuredClone(proposedPayload().snapshot.claims[0].evidence);
const positions=result=>({baseOnly:result.baseOnly.map(r=>r.index),proposedOnly:result.proposedOnly.map(r=>r.index),identical:result.identical,orderOnly:result.orderOnly});
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('identical full values ignore key order and preserve each occurrence',()=>{
 const before=refs(),after=before.map(r=>Object.fromEntries(Object.entries(r).reverse()));
 assert.deepEqual(positions(compare(before,after)),{baseOnly:[],proposedOnly:[],identical:2,orderOnly:false});
 assert.deepEqual(positions(compare([],[])),{baseOnly:[],proposedOnly:[],identical:0,orderOnly:false});
});
test('every recorded reference field creates one unmatched value on each side',()=>{
 const before=refs(),changes={sourceVersionId:proposalId(90),publisher:'Other publisher',title:'Other title',url:'https://example.org/other',locator:'Other exact cell',relation:'context',sourcePublishedOn:'2026-09-27',retrievedAt:'2026-09-28T06:00:00.000002Z'};
 for(const [field,value] of Object.entries(changes)){
  const after=structuredClone(before);after[0][field]=value;
  assert.deepEqual(positions(compare(before,after)),{baseOnly:[0],proposedOnly:[0],identical:1,orderOnly:false},field);
 }
});
test('duplicate multiplicity is consumed once in original occurrence order on either side',()=>{
 const [a,b]=refs();
 assert.deepEqual(positions(compare([a,a,b],[a,b])),{baseOnly:[1],proposedOnly:[],identical:2,orderOnly:false});
 assert.deepEqual(positions(compare([a,b],[a,b,a])),{baseOnly:[],proposedOnly:[2],identical:2,orderOnly:false});
 assert.deepEqual(positions(compare([a,a,b],[a,b,a,a])),{baseOnly:[],proposedOnly:[3],identical:3,orderOnly:false});
});
test('reordered identical multiset is order-only without invented source additions or removals',()=>{
 const [a,b]=refs();
 assert.deepEqual(positions(compare([a,b,a],[a,a,b])),{baseOnly:[],proposedOnly:[],identical:3,orderOnly:true});
 assert.deepEqual(positions(compare([a,a],[a,a])),{baseOnly:[],proposedOnly:[],identical:2,orderOnly:false});
});
test('reordering combined with different values retains each side original position',()=>{
 const [a,b]=refs(),c={...a,locator:'C'},d={...a,locator:'D'};
 assert.deepEqual(positions(compare([a,b,c],[c,a,d])),{baseOnly:[1],proposedOnly:[2],identical:2,orderOnly:false});
 const result=compare([a,b,c],[c,a,d]);assert.equal(result.baseOnly[0].source,b);assert.equal(result.proposedOnly[0].source,d);
});
test('same version title URL or publisher never turns differing locator or role into an identical value',()=>{
 const [a]=refs();
 for(const after of [{...a,locator:'Another cell'},{...a,relation:'contradicts'},{...a,sourceVersionId:proposalId(91)}]){
  assert.deepEqual(positions(compare([a],[after])),{baseOnly:[0],proposedOnly:[0],identical:0,orderOnly:false});
 }
});
test('twelve bounded frozen records preserve original metadata objects and order',()=>{
 const [a]=refs(),before=Array.from({length:12},(_,i)=>({...a,locator:`Old ${i}`})),after=before.map((r,i)=>i%2?{...r,locator:`New ${i}`}:{...r});
 const original=structuredClone([before,after]);freeze(before);freeze(after);
 const result=compare(before,after);
 assert.deepEqual(positions(result),{baseOnly:[1,3,5,7,9,11],proposedOnly:[1,3,5,7,9,11],identical:6,orderOnly:false});
 for(const row of result.baseOnly)assert.equal(row.source,before[row.index]);for(const row of result.proposedOnly)assert.equal(row.source,after[row.index]);
 assert.deepEqual([before,after],original);
});
