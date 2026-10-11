import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import test from 'node:test';
const saved=JSON.parse(readFileSync(new URL('../fixtures/fictional_update_report.json',import.meta.url),'utf8'));
const req=()=>new Request('http://127.0.0.1:3000/api/dev/update-rehearsal',{method:'POST',body:'{"trigger":"manual"}',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3000'}});
for(const check of ['generic-refusal','slot-recovery']) {
 test(`operation-start clock throw preserves ${check}`,async t=>{
  let calls=0,starts=0,archives=0,diagnostics=0;
  t.mock.method(performance,'now',()=>{if(++calls===6)throw Error('INVENTED_PRIVATE_START_CLOCK');return 100;});
  const {handleFictionalUpdateRequest:handle}=await import('../src/server/fictional-update-operation.ts?startup-control='+check);
  const run=async()=>{starts++;return{...structuredClone(saved),trigger:'manual',scheduledDueAt:null,requestKey:'fictional:manual:2026w40'};};
  const archive=async()=>{archives++;},record=async()=>{diagnostics++;return'unavailable';};
  let first,error;
  try{first=await handle(req(),'development',run,archive,record);}catch(e){error=e;}
  const second=await handle(req(),'development',run,archive,record);
  if(check==='generic-refusal') {
   assert.equal(error,undefined,'private provider exception is contained');assert.equal(first.status,503);
   assert.deepEqual(await first.json(),{error:'rehearsal_unavailable'});assert.equal(diagnostics,1);
  } else {assert.equal(second.status,200,'a later explicit valid request can use the retired logical slot');assert.equal(starts,1);assert.equal(archives,1);}
 });
}
