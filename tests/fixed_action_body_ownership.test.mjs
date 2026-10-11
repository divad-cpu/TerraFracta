import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import test from 'node:test';
import {handleFictionalUpdateRequest} from '../src/server/fictional-update-operation.ts';
import {createPrivateCustodianHandler} from '../src/server/private-custodian-operation.ts';

const saved=JSON.parse(readFileSync(new URL('../fixtures/fictional_update_report.json',import.meta.url),'utf8'));
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
for(const kind of ['update','custodian']) {
 for(const fault of ['clock-setup','timer-setup','already-locked','clear-after-valid','clear-after-refusal','late-callback','healthy-valid']) {
  test(`${kind} owns body setup and independent retirement: ${fault}`,async t=>{
   let starts=0,inspects=0,archives=0,diagnostics=0,cancellations=0,bodyTimer,clears=0;
   t.mock.method(performance,'now',()=>{if(fault==='clock-setup')throw Error('INVENTED_PRIVATE_CLOCK');return 100;});
   t.mock.method(globalThis,'setTimeout',(callback,milliseconds)=>{
    assert.equal(milliseconds,2000);
    if(fault==='timer-setup')throw Error('INVENTED_PRIVATE_TIMER');
    return bodyTimer={callback,milliseconds};
   });
   t.mock.method(globalThis,'clearTimeout',()=>{clears++;if(fault.startsWith('clear-')||fault==='late-callback')throw Error('INVENTED_PRIVATE_RETIREMENT');});
   const body=kind==='update'?'{"trigger":"manual"}':'{"action":"run_invented_custodian"}';
   const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(fault==='clear-after-refusal'?'{}':body));if(fault!=='timer-setup')c.close();},cancel(){cancellations++;}});
   const request=new Request(`http://127.0.0.1:3000/api/dev/${kind}`,{method:'POST',body:stream,duplex:'half',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3000'}});
   const external=fault==='already-locked'?request.body.getReader():undefined;
   const record=async()=>{diagnostics++;return'unavailable';};
   const handle=kind==='update'?(r,e)=>handleFictionalUpdateRequest(r,e,async()=>{starts++;return {...structuredClone(saved),trigger:'manual',scheduledDueAt:null,requestKey:'fictional:manual:2026w40'};},async()=>{archives++;},record):createPrivateCustodianHandler({inspect:async()=>{inspects++;return{state:'idle'};},start:async()=>{starts++;return{state:'held',reason:'private_test_unavailable'};}},{status:{state:'idle'}},record);
   let response;
   try {response=await handle(request,'development');}finally{await tick();}
   const valid=['clear-after-valid','late-callback','healthy-valid'].includes(fault);
   assert.equal(response.status,valid?(kind==='update'?200:202):400);
   if(!valid)assert.deepEqual(await response.json(),{error:kind==='update'?'invalid_rehearsal_request':'invalid_private_test_request'});
   assert.equal(starts,valid?1:0);assert.equal(inspects,valid&&kind==='custodian'?1:0);assert.equal(archives,valid&&kind==='update'?1:0);assert.equal(diagnostics,0);
   if(external){assert.equal(request.body.locked,true,'do not retire a reader owned by the caller');external.releaseLock();}
   assert.equal(request.body.locked,false,'owned body lock is released independently of timer retirement');
   if(fault==='timer-setup')assert.equal(cancellations,1,'setup failure retires unread owned body');
   if(bodyTimer){assert.equal(clears,1);assert.doesNotThrow(()=>bodyTimer.callback(),'delayed cancellation cannot throw after reader release');}
  });
 }
}
