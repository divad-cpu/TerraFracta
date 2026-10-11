import assert from 'node:assert/strict';
import test from 'node:test';
import {withLocalRequestDeadline} from '../src/local-request-deadline.ts';

for(const [name,end] of [['null',null],['false',false],['true',true],['empty string',''],['numeric string','1'],['bigint',1n]]) {
 test(`deadline refuses non-number terminal clock: ${name}`,async()=>{
  let observations=0,requests=0,owned;
  const parent=new AbortController();
  await assert.rejects(withLocalRequestDeadline(parent.signal,100,async signal=>{requests++;owned=signal;return 'checked result';},()=>observations++===0?0:end),/Local request cancelled/);
  assert.equal(requests,1);assert.equal(observations,2);assert.equal(parent.signal.aborted,false);assert.equal(owned.aborted,true);
 });
}
test('deadline refuses coercible terminal object without invoking it',async()=>{
 let observations=0,coercions=0,requests=0,owned;
 const end={valueOf(){coercions++;return 1;}};
 await assert.rejects(withLocalRequestDeadline(new AbortController().signal,100,async signal=>{requests++;owned=signal;return 'checked result';},()=>observations++===0?0:end),/Local request cancelled/);
 assert.equal(requests,1);assert.equal(observations,2);assert.equal(coercions,0);assert.equal(owned.aborted,true);
});
test('finite numeric terminal observations retain exclusive deadline and result',async()=>{
 for(const end of [0,0.5,99.999]) {
  let observations=0,requests=0,owned;
  const result=await withLocalRequestDeadline(new AbortController().signal,100,async signal=>{requests++;owned=signal;return 'checked result';},()=>observations++===0?0:end);
  assert.equal(result,'checked result');assert.equal(requests,1);assert.equal(observations,2);assert.equal(owned.aborted,true);
 }
 for(const end of [-0.5,100,NaN,Infinity,-Infinity]) {
  let observations=0;
  await assert.rejects(withLocalRequestDeadline(new AbortController().signal,100,async()=> 'checked result',()=>observations++===0?0:end),/Local request cancelled/);
  assert.equal(observations,2);
 }
});
