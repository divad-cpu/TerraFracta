import assert from 'node:assert/strict';
import test from 'node:test';
import {readingExplanationContext as context} from '../src/current-reading-guide.ts';
const edition='12345678-1234-4234-8234-123456789abc';
const route='/reader-preview/norway/housing-costs/issue?edition='+edition;
const other='/reader-preview/norway/housing-costs/issue?edition=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const anchor='claim-'+edition;
test('explanation return uses the own data descriptor and never a proxy get replacement',()=>{
 let gets=0;const input=new Proxy({returnTo:route},{get(target,key,receiver){gets++;return key==='returnTo'?other:Reflect.get(target,key,receiver);}});
 assert.deepEqual(context(input),{returnTo:route});assert.equal(gets,0);
});
test('explanation return refuses an enumerable unsupported field added by a selector getter',()=>{
 let foreignReads=0;const input={get returnTo(){Object.defineProperty(this,'provider',{enumerable:true,get(){foreignReads++;return 'PRIVATE';}});return route;}};
 assert.equal(context(input),null);assert.equal(foreignReads,0);
});
test('explanation return refuses callback changes to the selected own field set',()=>{
 for(const mutate of [o=>delete o.returnTo,o=>Object.defineProperty(o,'returnTo',{value:route,enumerable:false}),o=>Object.defineProperty(o,'extra',{value:'PRIVATE',enumerable:true})]){
  const input={returnTo:route,get returnAnchor(){mutate(this);return anchor;}};assert.equal(context(input),null);
 }
 const added={get returnTo(){this.returnAnchor=anchor;return route;}};assert.equal(context(added),null);
});
test('ordinary once-only accessors keep exact return and optional anchor, ignoring hidden and inherited unrelated fields',()=>{
 let routeReads=0,anchorReads=0;
 const input=Object.create({provider:'IGNORED'});Object.defineProperties(input,{returnTo:{enumerable:true,get(){routeReads++;return route;}},returnAnchor:{enumerable:true,get(){anchorReads++;return anchor;}},hidden:{value:'IGNORED'}});
 assert.deepEqual(context(input),{returnTo:route,returnAnchor:anchor});assert.equal(routeReads,1);assert.equal(anchorReads,1);
 assert.deepEqual(context({returnTo:route,returnAnchor:'PRIVATE_INVALID'}),{returnTo:route});
});
test('selector descriptor faults forward framework control signals once and ordinary faults remain opaque',()=>{
 const control=Error('CONTROL'),failure=Error('PRIVATE');let forwarded=0;
 const input={get returnTo(){throw control;}};
 assert.throws(()=>context(input,error=>{forwarded++;if(error===control)throw error;}),error=>error===control);assert.equal(forwarded,1);
 let ordinary=0;assert.equal(context({get returnTo(){throw failure;}},error=>{ordinary++;assert.equal(error,failure);}),null);assert.equal(ordinary,1);
});
