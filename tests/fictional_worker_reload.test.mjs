import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {readFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {once} from 'node:events';
import test from 'node:test';
const nativeExecFile=childProcess.execFile,execute=promisify(nativeExecFile);
const saved=JSON.parse(readFileSync(new URL('../fixtures/fictional_update_report.json',import.meta.url),'utf8'));
const report={...saved,trigger:'manual',scheduledDueAt:null,requestKey:'fictional:manual:2026w40'};
const request=signal=>new Request('http://127.0.0.1:3000/api/dev/update-rehearsal',{method:'POST',signal,body:'{"trigger":"manual"}',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3000'}});
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owned test child wait unavailable')),2000);})]);}finally{clearTimeout(timer);}}
for(const mode of ['aborted-physical-worker','unfinished-archive','direct-fixed-worker']) {
 test(`fresh native module preserves process-owned slot: ${mode}`,async()=>{
  const children=[];let readyResolve,archiveResolve,archiveStartedResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;}),archivePending=new Promise(resolve=>{archiveResolve=resolve;}),archiveStarted=new Promise(resolve=>{archiveStartedResolve=resolve;});
  let archives=0,diagnostics=0;
  const wrapper=(...args)=>nativeExecFile(...args);
  Object.defineProperty(wrapper,promisify.custom,{value:(file,args,options)=>{
   assert.equal(file,'uv');assert.equal(args[9],'scripts.update_rehearsal');
   const hold=children.length===0&&mode!=='unfinished-archive';
   const program=hold?"process.on('SIGTERM',()=>{});process.stdout.write('OWNED_READY\\n');setInterval(()=>{},1000);":`process.stdout.write(${JSON.stringify(JSON.stringify(report))});`;
   const pending=execute(process.execPath,['-e',program],{...options,cwd:'/tmp'}),item={child:pending.child,closed:false};children.push(item);
   item.child.once('close',()=>{item.closed=true;});if(hold)item.child.stdout.once('data',readyResolve);return pending;
  }});
  childProcess.execFile=wrapper;syncBuiltinESMExports();
  try {
   const first=await import('../src/server/fictional-update-operation.ts?reload-owner=first-'+mode);
   const controller=new AbortController(),archive=async()=>{archives++;if(mode==='unfinished-archive'&&archives===1){archiveStartedResolve();await archivePending;}},record=async()=>{diagnostics++;return'unavailable';};
   const pending=mode==='direct-fixed-worker'?first.runFictionalWorker('manual',controller.signal,'standard').then(()=>({status:200}),()=>({status:503})):first.handleFictionalUpdateRequest(request(controller.signal),'development',undefined,archive,record);
   if(mode==='unfinished-archive'){await bounded(archiveStarted);assert.equal(children[0].closed,true);}else{await bounded(ready);controller.abort();assert.equal((await bounded(pending)).status,503);assert.equal(children[0].closed,false);}
   const reloaded=await import('../src/server/fictional-update-operation.ts?reload-owner=second-'+mode);
   const refused=await reloaded.handleFictionalUpdateRequest(request(),'development',undefined,archive,record);
   assert.equal(refused.status,429,'a fresh module cannot recreate logical or physical capacity');assert.equal(children.length,1);
   if(mode==='unfinished-archive'){archiveResolve();assert.equal((await bounded(pending)).status,200);}else{const ended=once(children[0].child,'close');children[0].child.kill('SIGKILL');await bounded(ended);}
   const recovered=await reloaded.handleFictionalUpdateRequest(request(),'development',undefined,archive,record);assert.equal(recovered.status,200);assert.equal(children.length,2);assert.equal(children[1].closed,true);assert.equal(diagnostics,0);
  }finally{
   archiveResolve();for(const item of children)if(!item.closed){const ended=once(item.child,'close');item.child.kill('SIGKILL');await bounded(ended);}
   childProcess.execFile=nativeExecFile;syncBuiltinESMExports();
  }
 });
}
