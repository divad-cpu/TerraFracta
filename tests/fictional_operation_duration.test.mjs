import assert from 'node:assert/strict';
import test from 'node:test';
import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import {handleFictionalUpdateRequest as handle} from '../src/server/fictional-update-operation.ts';
const saved=JSON.parse(readFileSync(new URL('../fixtures/fictional_update_report.json',import.meta.url),'utf8'));
const report=()=>({...structuredClone(saved),trigger:'manual',scheduledDueAt:null,requestKey:'fictional:manual:2026w40'});
const request=()=>new Request('http://127.0.0.1:3000/api/dev/update-rehearsal',{method:'POST',body:'{"trigger":"manual"}',headers:{origin:'http://127.0.0.1:3000','content-type':'application/json'}});
for(const [name,bad] of [['null',null],['boolean',false],['string','0'],['NaN',NaN],['infinity',Infinity]])test(`raw invalid operation start ${name} cannot dispatch and its slot retires`,async t=>{
 let reads=0,starts=0,archives=0,diagnostics=0;t.mock.method(performance,'now',()=>++reads===6?bad:0);
 const run=async()=>{starts++;return report();},archive=async()=>{archives++;},record=async()=>{diagnostics++;return'unavailable';};
 const first=await handle(request(),'development',run,archive,record);assert.equal(first.status,503);assert.deepEqual(await first.json(),{error:'rehearsal_unavailable'});assert.equal(starts,0);assert.equal(archives,0);assert.equal(diagnostics,1);assert.equal(reads,6);
 const second=await handle(request(),'development',run,archive,record);assert.equal(second.status,200);assert.equal(starts,1);assert.equal(archives,1);
});
for(const [name,bad] of [['null',null],['boolean',false],['string','1'],['backward fractional',-0.25]])test(`raw invalid operation finish ${name} cannot become an archived duration`,async t=>{
 let reads=0,starts=0,archives=0,diagnostics=0;t.mock.method(performance,'now',()=>++reads===7?bad:0);
 const response=await handle(request(),'development',async()=>{starts++;return report();},async()=>{archives++;},async()=>{diagnostics++;return'unavailable';});
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'rehearsal_unavailable'});assert.equal(reads,7);assert.equal(starts,1);assert.equal(archives,0);assert.equal(diagnostics,1);
});
test('coercible terminal operation time never invokes its conversion or archives a result',async t=>{
 let reads=0,coercions=0,archives=0;t.mock.method(performance,'now',()=>++reads===7?{valueOf(){coercions++;return 1;}}:0);
 const response=await handle(request(),'development',async()=>report(),async()=>{archives++;},async()=> 'unavailable');assert.equal(response.status,503);assert.equal(coercions,0);assert.equal(archives,0);assert.equal(reads,7);
});
test('finite operation samples retain existing rounding, inclusive recorded ceiling and one dispatch',async t=>{
 for(const terminal of [0,-0,0.49,0.5,1,19999.6,20000,20000.49,20000.5]) {
  let reads=0,starts=0,archives=0;t.mock.method(performance,'now',()=>++reads===7?terminal:0);
  const response=await handle(request(),'development',async()=>{starts++;return report();},async()=>{archives++;},async()=> 'unavailable');assert.equal(response.status,Math.round(terminal)<=20000?200:503);assert.equal(starts,1);assert.equal(reads,7);assert.equal(archives,response.status===200?1:0);
  if(response.status===200)assert.equal((await response.json()).execution.durationMs,Math.round(terminal)===0?0:Math.round(terminal));
  t.mock.restoreAll();
 }
});
