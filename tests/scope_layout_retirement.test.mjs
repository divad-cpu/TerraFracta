import assert from "node:assert/strict";
import test from "node:test";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { scopeDraftJson } from "../src/issue-scope-draft.ts";
import { proposalReport } from "./helpers/proposal_fixture.mjs";
function harness(context){let cursor=0;const cells=[],effects=[],layouts=[];
 const register=(list,fn,deps)=>{const i=cursor++,old=list[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))list[i]={deps,fn,cleanup:old?.cleanup,pending:true}};
 const hooks={useId:()=>"layout-scope",useRef(v){const i=cursor++;if(!(i in cells))cells[i]={current:v};return cells[i]},
 useState(v){const i=cursor++;if(!(i in cells))cells[i]=v;return[cells[i],v=>{cells[i]=typeof v==="function"?v(cells[i]):v}]},
 useEffect(fn,deps){register(effects,fn,deps)},useLayoutEffect(fn,deps){register(layouts,fn,deps)}};
 const View=loadTsx(new URL("../src/issue-scope-draft-view.tsx", import.meta.url),n=>n==="react"?hooks:undefined).IssueScopeDraftView;
 const render=()=>{cursor=0;return View({context})};
 const run=list=>{for(const e of list)if(e?.pending){e.cleanup?.();e.cleanup=e.fn();e.pending=false}};
 const mount=()=>{render();run(layouts);run(effects)},unmount=()=>{for(const e of layouts)e?.cleanup?.();for(const e of effects)e?.cleanup?.()};
 return{render,mount,retireLayout(){for(const e of layouts)e?.cleanup?.()},
 retirePassive(){for(const e of effects)e?.cleanup?.()},admitAgain(){for(const list of [layouts,effects]){for(const e of list)if(e){e.cleanup=undefined;e.pending=true}run(list)}},unmount,
 remount(){unmount();cells.length=0;layouts.length=0;effects.length=0;mount()}};
}
const field=(tree,suffix)=>elements(tree).find(n=>n.props.id?.endsWith(suffix));
const buttons=tree=>elements(tree).filter(n=>n.type==="button");
const preview=tree=>elements(tree).find(n=>n.type==="textarea"&&n.props.readOnly)?.props.value;
const turn=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))};
test("committed scope retirement rejects fields paste search and file selectors before passive cleanup or event access",()=>{
 const h=harness(capturedScopeDraftContext(proposalReport()));h.mount();
 field(h.render(),"-population-wording").props.onChange({currentTarget:{value:"Invented retiring scope"}});
 const old=h.render();h.retireLayout();
 for(const n of elements(old).filter(n=>["input","textarea","select"].includes(n.type)&&typeof n.props.onChange==="function")){
  n.props.onChange(new Proxy({}, {get(){assert.fail(`Retired ${n.type} event read before passive cleanup`);}}));
 }
 for(const b of buttons(old))b.props.onClick?.();assert.equal(preview(h.render()),undefined);h.retirePassive();h.unmount();
});
test("layout retirement aborts a pending scope file but retains its physical slot and withholds late installation",async t=>{
 let aborts=0;const abort=AbortController.prototype.abort;t.mock.method(AbortController.prototype,"abort",function(...args){aborts++;return abort.apply(this,args)});
 const context=capturedScopeDraftContext(proposalReport()),h=harness(context);h.mount();
 const candidate={schemaVersion:1,kind:"issue_scope_preparation",binding:context.binding,fields:{population:{wording:"Invented late file",references:[{claimId:context.claims[0].id,referenceNumber:1}]},period:null,selectionRationale:null}};
 const bytes=new TextEncoder().encode(scopeDraftJson(candidate,context));let resolve,reads=0;
 const first={size:bytes.length,slice(){return{arrayBuffer(){reads++;return new Promise(r=>resolve=r)}}}};
 field(h.render(),"-file").props.onChange({currentTarget:{files:[first],value:"Invented filename"}});
 const old=field(h.render(),"-file").props.onChange;const before=aborts;h.retireLayout();assert.ok(aborts>before,"Layout cleanup requests cancellation before passive cleanup");
 assert.equal(reads,1);resolve(bytes.buffer);await turn();assert.equal(preview(h.render()),undefined);
 old(new Proxy({}, {get(){assert.fail("Retired file event inspected");}}));assert.equal(field(h.render(),"-population-wording").props.value,"");
 h.retirePassive();h.unmount();
});

test("a successor scope admission cannot abandon the retired layout file slot or retry its bytes",async()=>{
 const context=capturedScopeDraftContext(proposalReport()),h=harness(context);h.mount();
 const candidate={schemaVersion:1,kind:"issue_scope_preparation",binding:context.binding,fields:{population:{wording:"Invented successor file",references:[{claimId:context.claims[0].id,referenceNumber:1}]},period:null,selectionRationale:null}};
 const bytes=new TextEncoder().encode(scopeDraftJson(candidate,context));let resolve,reads=0,nextReads=0;
 const first={size:bytes.length,slice(){return{arrayBuffer(){reads++;return new Promise(r=>resolve=r)}}}};
 const second={size:bytes.length,slice(){return{arrayBuffer(){nextReads++;return Promise.resolve(bytes.buffer)}}}};
 field(h.render(),"-file").props.onChange({currentTarget:{files:[first],value:"invented"}});
 h.retireLayout();h.retirePassive();h.admitAgain();assert.equal(field(h.render(),"-file").props.disabled,true);
 field(h.render(),"-file").props.onChange({currentTarget:{files:[second],value:"invented"}});
 assert.equal(reads,1);assert.equal(nextReads,0);resolve(bytes.buffer);await turn();assert.equal(preview(h.render()),undefined);
 assert.equal(nextReads,0);assert.equal(field(h.render(),"-file").props.disabled,false);
 field(h.render(),"-file").props.onChange({currentTarget:{files:[second],value:"invented"}});await turn();assert.equal(nextReads,1);
 assert.equal(JSON.parse(preview(h.render())).fields.population.wording,"Invented successor file");h.unmount();
});
test("a new scope mount withholds a second local File read until its predecessor settles",async()=>{
 const context=capturedScopeDraftContext(proposalReport()),h=harness(context);h.mount();
 const candidate={schemaVersion:1,kind:"issue_scope_preparation",binding:context.binding,fields:{population:{wording:"Invented remount file",references:[{claimId:context.claims[0].id,referenceNumber:1}]},period:null,selectionRationale:null}};
 const bytes=new TextEncoder().encode(scopeDraftJson(candidate,context));let resolve,reads=0,nextReads=0;
 const first={size:bytes.length,slice(){return{arrayBuffer(){reads++;return new Promise(r=>resolve=r)}}}};
 const second={size:bytes.length,slice(){return{arrayBuffer(){nextReads++;return Promise.resolve(bytes.buffer)}}}};
 field(h.render(),"-file").props.onChange({currentTarget:{files:[first],value:"private-filename"}});
 h.remount();assert.equal(field(h.render(),"-file").props.disabled,true);
 field(h.render(),"-file").props.onChange({currentTarget:{files:[second],value:"private-filename"}});
 assert.equal(reads,1);assert.equal(nextReads,0);resolve(bytes.buffer);await turn();
 assert.equal(preview(h.render()),undefined);assert.equal(field(h.render(),"-file").props.disabled,false);
 field(h.render(),"-file").props.onChange({currentTarget:{files:[second],value:"private-filename"}});await turn();
 assert.equal(nextReads,1);assert.equal(JSON.parse(preview(h.render())).fields.population.wording,"Invented remount file");h.unmount();
});
