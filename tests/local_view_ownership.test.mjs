import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const variants = [
  ["preparation", "current-private-preparation-view", "CurrentPrivatePreparationView", "source-readiness", "local_observation_unavailable"],
  ["parent", "current-parent-source-view", "CurrentParentSourceView", "parent-source", "parent_source_comparison_unavailable"],
  ["copy", "current-copy-scope-view", "CurrentCopyScopeView", "copy-scope", "copy_observation_unavailable"],
];
const turn = () => new Promise(resolve => setImmediate(resolve));
function nodes(value) { if(Array.isArray(value))return value.flatMap(nodes); if(!value || typeof value!=="object")return [];return [value,...nodes(value.props?.children)]; }
function harness(file, component, initialProps={}) {
  const path=new URL(`../src/${file}.tsx`,import.meta.url), native=createRequire(path), exports={};let cursor=0,effect,cleanup,props=initialProps;const cells=[];
  const compiled=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const hooks={useState(initial){const i=cursor++;if(!(i in cells))cells[i]=initial;return [cells[i],value=>{cells[i]=value;}];},useRef(initial){const i=cursor++;if(!(i in cells))cells[i]={current:initial};return cells[i];},useEffect(fn){effect=fn;}};
  new Function("require","exports",compiled)(name=>name==="react"?hooks:native(name),exports);
  const render=()=>{cursor=0;return exports[component](props);};const markup=()=>renderToStaticMarkup(render());
  return {markup,mount(){render();cleanup=effect();},unmount(){cleanup?.();},switchMode(supervised){props={supervised};const before=markup();cleanup?.();cleanup=effect();return before;},button(){return nodes(render()).find(n=>n.type==="button").props;}};
}
function delayed(t, endpoint) {
  const replies=[];t.mock.method(globalThis,"fetch",(url,options)=>{assert.equal(options.method,"GET");assert.equal(options.cache,"no-store");assert.equal(options.body,undefined);if(endpoint)assert.equal(url,`/api/dev/${endpoint}`);return new Promise((resolve,reject)=>replies.push({resolve,reject,signal:options.signal,url}));});return replies;
}
// A controllable ignored-cancellation body port preserves physical await across
// retirement. This is not a native producer/transport cleanup certificate.
function pendingBody() {
  let resolve,reject,read=false;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  return {resolve,reject,response:{ok:true,status:200,headers:new Headers(),json:()=>promise,body:{locked:false,getReader(){return {read(){if(read)return Promise.resolve({done:true});read=true;return promise.then(value=>({done:false,value:new TextEncoder().encode(JSON.stringify(value))}));},cancel(){return Promise.resolve();},releaseLock(){}};}}}};
}
for(const [label,file,component,endpoint,reason] of variants) {
  test(`${label} pre-effect and retired controls cannot acquire a later visit`,async t=>{
    const replies=delayed(t,endpoint),ui=harness(file,component),before=ui.button().onClick; t.after(()=>ui.unmount());
    before();assert.equal(replies.length,0);assert.equal(ui.button().disabled,true);
    ui.mount();before();assert.equal(replies.length,0);const old=ui.button().onClick;ui.unmount();old();assert.equal(replies.length,0);
    ui.mount();old();assert.equal(replies.length,0);ui.button().onClick();replies[0].resolve(Response.json({state:"held",reason}));await turn();
    const current=ui.markup();before();old();assert.equal(replies.length,1);assert.equal(ui.markup(),current);assert.equal(ui.button().disabled,false);
  });
  test(`${label} recreated effect withholds an earlier observation`,async t=>{
    const replies=delayed(t,endpoint),ui=harness(file,component);t.after(()=>ui.unmount());ui.mount();ui.button().onClick();replies[0].resolve(Response.json({state:"held",reason}));await turn();
    assert.match(ui.markup(),/unavailable/);const old=ui.button().onClick;ui.unmount();assert.doesNotMatch(ui.markup(),/observation is unavailable|comparison is unavailable/);
    ui.mount();assert.doesNotMatch(ui.markup(),/observation is unavailable|comparison is unavailable/);old();assert.equal(replies.length,1);ui.button().onClick();assert.equal(replies.length,2);replies[1].resolve(Response.json({state:"held",reason}));await turn();
  });
  for(const stage of ["response","body"])for(const rejected of [false,true])test(`${label} retired ${stage} keeps slot until ${rejected?"rejection":"success"}`,async t=>{
    const replies=delayed(t,endpoint),ui=harness(file,component);t.after(()=>ui.unmount());ui.mount();const old=ui.button().onClick;old();let body;
    if(stage==="body"){body=pendingBody();replies[0].resolve(body.response);await turn();}
    ui.unmount();assert.equal(replies[0].signal.aborted,true);ui.mount();assert.equal(ui.button().disabled,true);old();ui.button().onClick();assert.equal(replies.length,1);
    const wait=body??replies[0];if(rejected)wait.reject(new Error("PRIVATE_OLD_READ"));else wait.resolve(stage==="body"?{state:"held",reason}:Response.json({state:"held",reason}));await turn();
    assert.equal(ui.button().disabled,false);assert.doesNotMatch(ui.markup(),/PRIVATE_OLD_READ|observation is unavailable|comparison is unavailable/);old();assert.equal(replies.length,1);
    ui.button().onClick();assert.equal(replies.length,2);replies[1].resolve(Response.json({state:"held",reason}));await turn();assert.match(ui.markup(),/unavailable/);
  });
}
for(const initialMode of [false,true])for(const stage of ["response","body"])test(`review ${initialMode?"supervised":"manual"} ${stage} keeps slot across mode recreation`,async t=>{
  const replies=delayed(t),ui=harness("correction-review-operation-view","CorrectionReviewOperationView",{supervised:initialMode});t.after(()=>ui.unmount());ui.mount();let body;
  if(stage==="body"){body=pendingBody();replies[0].resolve(body.response);await turn();}
  const old=ui.button().onClick;ui.switchMode(!initialMode);assert.equal(replies[0].signal.aborted,true);assert.equal(ui.button().disabled,true);old();ui.button().onClick();assert.equal(replies.length,1);
  ui.switchMode(initialMode);assert.equal(replies.length,1);(body??replies[0]).resolve(stage==="body"?{state:"idle"}:Response.json({state:"idle"}));await turn();
  assert.equal(ui.button().disabled,false);assert.doesNotMatch(ui.markup(),/No retained trial|cannot repair|Four invented reports/);old();assert.equal(replies.length,1);
  ui.button().onClick();assert.equal(replies.length,2);assert.equal(replies[1].url,initialMode?"/api/dev/supervised-correction-review":"/api/dev/correction-review");replies[1].resolve(Response.json({state:"idle"}));await turn();assert.match(ui.markup(),/No retained trial/);
});
