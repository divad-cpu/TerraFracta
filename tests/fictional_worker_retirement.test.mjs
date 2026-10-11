import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {readFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {once} from 'node:events';
import test from 'node:test';
const nativeExecFile=childProcess.execFile,nativeExecute=promisify(nativeExecFile);
const saved=JSON.parse(readFileSync(new URL('../fixtures/fictional_update_report.json',import.meta.url),'utf8'));
const report={...saved,trigger:'manual',scheduledDueAt:null,requestKey:'fictional:manual:2026w40'};
const req=signal=>new Request('http://127.0.0.1:3000/api/dev/update-rehearsal',{method:'POST',signal,body:'{"trigger":"manual"}',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3000'}});
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owned child wait unavailable')),2000);})]);}finally{clearTimeout(timer);}}
for(const mode of ['abort-ignores-term','abort-cooperative','healthy','invalid-output','exit-failure','spawn-failure','already-aborted','archive-pending']) {
 test(`fixed native fictional worker retains physical ownership: ${mode}`,async()=>{
  const children=[];let startedResolve;const ready=new Promise(resolve=>{startedResolve=resolve;});
  let archives=0,diagnostics=0,unblockArchive;const archivePending=new Promise(resolve=>{unblockArchive=resolve;});
  const wrapper=(...args)=>nativeExecFile(...args);
  Object.defineProperty(wrapper,promisify.custom,{value:(file,args,options)=>{
   assert.equal(file,'uv');assert.deepEqual(args,['run','--locked','--offline','--no-sync','--no-python-downloads','--no-env-file','python','-B','-m','scripts.update_rehearsal','--trigger','manual','--scenario','standard']);
   assert.equal(options.timeout,15000);assert.equal(options.maxBuffer,65536);assert.equal(options.encoding,null);
   const first=children.length===0;
   const holding=first&&mode.startsWith('abort-');
   const program=holding?(mode==='abort-ignores-term'?"process.on('SIGTERM',()=>{});":"")+"process.stdout.write('OWNED_READY\\n');setInterval(()=>{},1000);":first&&mode==='invalid-output'?"process.stdout.write('INVENTED_PRIVATE_INVALID_OUTPUT');":first&&mode==='exit-failure'?"process.stderr.write('INVENTED_PRIVATE_FAILURE');process.exit(7);":`process.stdout.write(${JSON.stringify(JSON.stringify(report))});`;
   const result=first&&mode==='spawn-failure'?nativeExecute('/tmp/terrafracta-owned-intentionally-absent-program',[],{...options,cwd:'/tmp'}):nativeExecute(process.execPath,['-e',program],{...options,cwd:'/tmp'});
   const item={child:result.child,closed:false};children.push(item);item.child.once('close',()=>{item.closed=true;});
   if(holding)item.child.stdout.once('data',startedResolve);
   return result;
  }});
  childProcess.execFile=wrapper;syncBuiltinESMExports();
  try {
   const {handleFictionalUpdateRequest:handle,runFictionalWorker}=await import('../src/server/fictional-update-operation.ts?physical-control='+mode);
   const controller=new AbortController();
   const archive=async()=>{archives++;if(mode==='archive-pending'&&archives===1)await archivePending;};
   const record=async()=>{diagnostics++;return'unavailable';};
   if(mode==='already-aborted') {
    controller.abort();assert.equal((await handle(req(controller.signal),'development',undefined,archive,record)).status,409);
    await assert.rejects(()=>runFictionalWorker('manual',controller.signal,'standard'));
    assert.equal(children.length,0,'an already cancelled direct fixed runner cannot create a child');return;
   }
   const pending=handle(req(controller.signal),'development',undefined,archive,record);
   if(mode.startsWith('abort-')) {await bounded(ready);controller.abort();}
   if(mode==='archive-pending') {
    while(archives===0)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(children[0].closed,true);
    assert.equal((await handle(req(),'development',undefined,archive,record)).status,429);
    assert.equal(children.length,1);unblockArchive();
   }
   const first=await bounded(pending);
   if(mode.startsWith('abort-')) {
    assert.equal(first.status,503);assert.equal(diagnostics,0);assert.equal(archives,0);
    if(mode==='abort-ignores-term') {
     assert.equal(children[0].closed,false);
     assert.equal((await handle(req(),'development',undefined,archive,record)).status,429);
     assert.equal(children.length,1,'aborted but physically active child keeps the only worker slot');
     const closed=once(children[0].child,'close');children[0].child.kill('SIGKILL');await bounded(closed);
    } else if(!children[0].closed)await bounded(once(children[0].child,'close'));
   } else if(['invalid-output','exit-failure','spawn-failure'].includes(mode)) {
    assert.equal(first.status,503);assert.deepEqual(await first.json(),{error:'rehearsal_unavailable'});assert.equal(diagnostics,1);assert.equal(archives,0);
    if(!children[0].closed)await bounded(once(children[0].child,'close'));
   } else {assert.equal(first.status,200);assert.equal(children[0].closed,true);assert.equal(archives,1);}
   const second=await bounded(handle(req(),'development',undefined,archive,record));
   assert.equal(second.status,200,'a later explicit request is admitted only after native close');
   assert.equal(children.length,2);assert.equal(children[1].closed,true);
  } finally {
   unblockArchive();
   for(const item of children)if(!item.closed){const closed=once(item.child,'close');item.child.kill('SIGKILL');await bounded(closed);}
   childProcess.execFile=nativeExecFile;syncBuiltinESMExports();
  }
 });
}
