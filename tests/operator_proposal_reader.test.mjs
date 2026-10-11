import assert from 'node:assert/strict';import test from 'node:test';import {getEventListeners} from 'node:events';
import {createProposalReader,readCapturedProposal} from '../src/server/operator-proposal-reader.ts';
import {proposalReport,proposalScope,proposalBytes,proposalId} from './helpers/proposal_fixture.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('strict selection precedes unconfigured provider; default stays inactive and foreign selections do not read',async()=>{
 assert.deepEqual(await readCapturedProposal(proposalScope()),{kind:'unconfigured'});
 let calls=0;const read=createProposalReader(async()=>{calls++;return proposalBytes(proposalReport());});
 for(const scope of [null,{},[],{...proposalScope(),sql:'PRIVATE_CANARY'},{...proposalScope(),runId:'PRIVATE_CANARY'}])assert.deepEqual(await read(scope),{kind:'invalid_scope'});
 assert.equal(calls,0);
});
test('actual encoder/report/reader path returns checked proposal and distinct legacy/absent/changed outcomes silently',async()=>{
 const faults=[];const record=async code=>{faults.push(code);return 'saved';};
 assert.equal((await createProposalReader(async()=>proposalBytes(proposalReport()),()=>0,record)(proposalScope())).kind,'ok');
 for(const status of ['capture_missing','not_found','changed'])assert.deepEqual(await createProposalReader(async()=>proposalBytes({schemaVersion:1,status,requested:proposalScope()}),()=>0,record)(proposalScope()),{kind:status});
 assert.deepEqual(faults,[]);
});
test('untrusted wire/hash/body/UTF8/type and request mismatch fail closed with only fixed diagnostics',async()=>{
 for(const provide of [async()=>{throw Error('PRIVATE_CANARY');},async()=>null,async()=>new Uint8Array([255,255]),async()=>new Uint8Array(65537),
  async()=>{const r=proposalReport();r.capture.proposalJson+='PRIVATE_CANARY';return proposalBytes(r);},
  async()=>{const r=proposalReport();r.requested.runId=proposalId(99);return proposalBytes(r);}]){
  const faults=[];assert.deepEqual(await createProposalReader(provide,()=>0,async(...args)=>{faults.push(args);return 'saved';})(proposalScope()),{kind:'unavailable'});
  assert.deepEqual(faults,[['operator_audit_read']]);}
});
test('preabort does not dispatch; midflight abort is prompt/silent, consumes late rejection and removes listener',async()=>{
 const c=new AbortController();c.abort();let calls=0;const faults=[];
 const read=createProposalReader(async()=>{calls++;return proposalBytes(proposalReport());},()=>0,async code=>{faults.push(code);return 'saved';});
 assert.deepEqual(await read(proposalScope(),c.signal),{kind:'unavailable'});assert.equal(calls,0);
 const active=new AbortController();let reject;const pending=new Promise((_resolve,r)=>{reject=r;});
 const waiting=createProposalReader(()=>pending,()=>0,async code=>{faults.push(code);return 'saved';})(proposalScope(),active.signal);
 await tick();active.abort();assert.deepEqual(await waiting,{kind:'unavailable'});reject(Error('PRIVATE_LATE_CANARY'));await tick();
 assert.equal(getEventListeners(active.signal,'abort').length,0);assert.deepEqual(faults,[]);
});
test('clock/deadline/logger faults preserve held outcome and cleanup',async()=>{
 for(const clock of [()=>{throw Error('PRIVATE_CLOCK');},()=>NaN,(()=>{let n=0;return ()=>n++===0?0:3000;})()]){
  assert.deepEqual(await createProposalReader(async()=>proposalBytes(proposalReport()),clock,async()=>{throw Error('PRIVATE_LOGGER');})(proposalScope()),{kind:'unavailable'});}
});
