import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
function harness(mode) {
 let cursor=0,supervised=mode;const cells=[],effects=[],layouts=[];
 const hooks={useRef(v){const i=cursor++;if(!(i in cells))cells[i]={current:v};return cells[i]},
 useState(v){const i=cursor++;if(!(i in cells))cells[i]=v;return[cells[i],v=>{cells[i]=typeof v==="function"?v(cells[i]):v}]},
 useLayoutEffect(fn,deps){const i=cursor++,old=layouts[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))layouts[i]={deps,fn,cleanup:old?.cleanup,pending:true}},
 useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))effects[i]={deps,fn,cleanup:old?.cleanup,pending:true}}};
 const View=loadTsx(new URL("../src/correction-review-operation-view.tsx", import.meta.url),n=>n==="react"?hooks:undefined).CorrectionReviewOperationView;
 const render=(mode=supervised)=>{supervised=mode;cursor=0;return View({supervised})};
 const commit=()=>{for(const list of [layouts,effects])for(const e of list)if(e?.pending){e.cleanup?.();e.cleanup=e.fn();e.pending=false}};
 return{render,commit,mount(){render();commit()},unmount(){for(const list of [layouts,effects])for(const e of list)e?.cleanup?.()},html(){return renderToStaticMarkup(render())},button(){return elements(render()).find(n=>n.type==="button").props}};
}
const turn=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))};
function transport(t){const replies=[];t.mock.method(globalThis,"fetch",(url,options)=>{
 assert.equal(options.method,"GET");assert.equal(options.body,undefined);assert.equal(options.cache,"no-store");
 return new Promise(resolve=>replies.push({url,resolve,signal:options.signal}));});return replies}
test("returning to a review mode before effect admission cannot revive its earlier observation or controls",async t=>{
 for(const mode of [false,true]){const replies=transport(t),h=harness(mode);h.mount();replies[0].resolve(Response.json({state:"idle"}));await turn();
 assert.match(h.html(),/No retained trial has been started/);const old=h.button().onClick;
 h.render(!mode);h.render(mode);assert.doesNotMatch(h.html(),/No retained trial has been started/,"Return must not revive the prior mode visit");
 assert.equal(h.button().disabled,true);old();assert.equal(replies.length,1);h.commit();
 assert.equal(replies.length,2);assert.equal(replies[1].url,mode?"/api/dev/supervised-correction-review":"/api/dev/correction-review");
 replies[1].resolve(Response.json({state:"idle"}));await turn();assert.match(h.html(),/No retained trial has been started/);h.unmount();t.mock.reset();}
});
test("an unfinished review observation stays physically owned across an unadmitted mode return and cannot publish later",async t=>{
 const replies=transport(t),h=harness(false);h.mount();const old=h.button().onClick;
 h.render(true);h.render(false);h.commit();assert.equal(replies[0].signal.aborted,true);assert.equal(replies.length,1);
 old();h.button().onClick();assert.equal(replies.length,1);replies[0].resolve(Response.json({state:"idle"}));await turn();
 assert.doesNotMatch(h.html(),/No retained trial has been started/);assert.equal(h.button().disabled,false);assert.equal(replies.length,1);
 h.button().onClick();assert.equal(replies.length,2);replies[1].resolve(Response.json({state:"idle"}));await turn();assert.match(h.html(),/No retained trial has been started/);h.unmount();
});
test("ordinary same-mode renders keep a checked observation and use only its exact read endpoint",async t=>{
 const replies=transport(t),h=harness(true);h.mount();replies[0].resolve(Response.json({state:"idle"}));await turn();
 h.render(true);h.render(true);assert.match(h.html(),/No retained trial has been started/);assert.equal(h.button().disabled,false);
 h.button().onClick();assert.equal(replies.length,2);assert.equal(replies[1].url,"/api/dev/supervised-correction-review");
 replies[1].resolve(Response.json({state:"idle"}));await turn();h.unmount();
});
