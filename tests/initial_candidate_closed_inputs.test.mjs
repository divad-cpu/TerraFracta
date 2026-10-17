import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {prepareInitialCandidateCaptureForWork as prepare} from '../src/server/initial-candidate-capture.ts';
const report=()=>readFileSync(new URL('../fixtures/fictional-detached-preparation.json',import.meta.url),'utf8');
const expected=()=>JSON.parse(readFileSync(new URL('../fixtures/fictional-detached-preparation-expected.json',import.meta.url),'utf8'));
const work=()=>({runId:JSON.parse(JSON.parse(report()).parts.selection_json).runId,requestFingerprint:'a'.repeat(64),workClaimId:'00000000-0000-4000-8000-000000000998'});
const refuse=fn=>assert.throws(fn,/^Error: initial_candidate_capture_unavailable$/);
test('symbols and nonenumerable extra fields close both independent channels before hooks',()=>{
 for(const channel of ['work','expected'])for(const kind of ['symbol','hidden']){
  const w=work(),e=expected(),target=channel==='work'?w:e;let calls=0;
  const key=Object.keys(target)[0],value=target[key];Object.defineProperty(target,key,{enumerable:true,get(){calls++;return value;}});
  if(kind==='symbol')target[Symbol('PRIVATE')]='PRIVATE';else Object.defineProperty(target,'PRIVATE',{value:'PRIVATE'});
  refuse(()=>prepare(w,report(),e));assert.equal(calls,0);
 }
});
test('an accepted last getter cannot append an unknown selector after the initial shape check',()=>{
 for(const channel of ['work','expected']){
  const w=work(),e=expected(),target=channel==='work'?w:e,key=Object.keys(target).at(-1),value=target[key];let calls=0;
  Object.defineProperty(target,key,{enumerable:true,get(){calls++;target.PRIVATE='PRIVATE';return value;}});
  refuse(()=>prepare(w,report(),e));assert.equal(calls,1);
 }
});
test('an accepted last getter cannot remove or hide an already captured own selector',()=>{
 for(const channel of ['work','expected'])for(const action of ['delete','hide']){
  const w=work(),e=expected(),target=channel==='work'?w:e,keys=Object.keys(target),first=keys[0],last=keys.at(-1),value=target[last];
  Object.defineProperty(target,last,{enumerable:true,get(){if(action==='delete')delete target[first];else Object.defineProperty(target,first,{value:target[first],enumerable:false});return value;}});
  refuse(()=>prepare(w,report(),e));
 }
});
test('valid null-prototype and exactly once own getters retain the old fixed command',()=>{
 const w=work(),e=expected(),ordinary=prepare(w,report(),e);
 for(const channel of ['work','expected']){
  const original=channel==='work'?w:e,target=Object.create(null),counts={};
  for(const key of Object.keys(original)){counts[key]=0;Object.defineProperty(target,key,{enumerable:true,get(){counts[key]++;return original[key];}});}
  const result=prepare(channel==='work'?target:w,report(),channel==='expected'?target:e);
  assert.deepEqual(result.values,ordinary.values);assert.deepEqual(Object.values(counts),Object.keys(original).map(()=>1));
 }
});
