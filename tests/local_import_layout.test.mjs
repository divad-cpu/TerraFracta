import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { exportFictionalSavedRun } from "../src/fictional-saved-run-export.ts";
import { buildDiagnosticReport } from "../src/diagnostic-report.ts";
import { makeDiagnosticEvent } from "../src/error-diagnostics.ts";
const variants=[{file:"diagnostic-import-view",component:"DiagnosticImportView",suffix:"-file"},
 {file:"fictional-saved-run-import-view",component:"FictionalSavedRunImportView",suffix:"-selected-file"},
 {file:"fictional-saved-run-import-view",component:"FictionalSavedRunImportView",suffix:"-earlier-file"}];
function body(v){if(v.file.startsWith("diagnostic")){const event=makeDiagnosticEvent("weekly_assessment_export","eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",new Date("2026-10-03T12:00:00Z"));
 return JSON.stringify(buildDiagnosticReport({events:[event],unreadable:0,filesObserved:1,stable:true,locked:false},new Date("2026-10-03T13:00:00Z")))}
 return exportFictionalSavedRun({execution:{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",kind:"local_fictional",scenario:"standard",executedAt:"2026-10-10T10:00:00Z",durationMs:1},
 report:JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url)))});}
function harness(v){let cursor=0,setters=0;const cells=[],effects=[],layouts=[];
 const register=(list,fn,deps)=>{const i=cursor++,old=list[i];if(!old||deps.some((d,j)=>d!==old.deps[j]))list[i]={deps,fn,cleanup:old?.cleanup,pending:true}};
 const hooks={useId:()=>"import-layout",useRef(i){const n=cursor++;if(!(n in cells))cells[n]={current:i};return cells[n]},
 useState(i){const n=cursor++;if(!(n in cells))cells[n]=typeof i==="function"?i():i;return[cells[n],u=>{setters++;cells[n]=typeof u==="function"?u(cells[n]):u}]},
 useLayoutEffect(f,d){register(layouts,f,d)},useEffect(f,d){register(effects,f,d)}};
 const View=loadTsx(new URL(`../src/${v.file}.tsx`, import.meta.url),name=>name==="react"?hooks:undefined)[v.component];
 const render=()=>{cursor=0;return View()};const run=list=>{for(const e of list)if(e?.pending){e.cleanup?.();e.cleanup=e.fn();e.pending=false}};
 const mount=()=>{render();run(layouts);run(effects)},unmount=()=>{for(const e of layouts)e?.cleanup?.();for(const e of effects)e?.cleanup?.()};
 return{render,count:()=>setters,mount,retireLayout(){for(const e of layouts)e?.cleanup?.()},retirePassive(){for(const e of effects)e?.cleanup?.()},
 admitAgain(){for(const list of [layouts,effects]){for(const e of list)if(e){e.cleanup=undefined;e.pending=true}run(list)}},unmount,
 remount(){unmount();cells.length=0;layouts.length=0;effects.length=0;mount()}};
}
const input=(h,v)=>elements(h.render()).find(n=>n.props.id?.endsWith(v.suffix));
const loaded=h=>elements(h.render()).some(n=>typeof n.type==="function"&&n.type.name==="FictionalSavedRunView"||n.type==="h3"&&n.props.children==="Saved individual references");
const choose=(h,v,file)=>input(h,v).props.onChange({currentTarget:{files:[file],value:"PRIVATE_INVENTED_FILENAME"}});
const turn=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))};
test("committed local import retirement rejects prior file events and actions before passive cleanup",t=>{
 t.mock.method(globalThis,"fetch",()=>assert.fail("File import transport"));
 for(const v of variants){const h=harness(v);h.mount();const old=h.render();h.retireLayout();const count=h.count();
 for(const n of elements(old))if(n.props.onChange)n.props.onChange(new Proxy({}, {get(){assert.fail(`${v.suffix}: retired file event read`);}}));
 for(const n of elements(old))if(n.type==="button")n.props.onClick?.();assert.equal(h.count(),count);h.retirePassive();h.unmount();}
});
test("late local import bytes cannot install a retired report before passive cleanup",async()=>{
 for(const v of variants){const h=harness(v);h.mount();const bytes=new TextEncoder().encode(body(v));let resolve;
 choose(h,v,{size:bytes.length,slice(){return{arrayBuffer:()=>new Promise(r=>resolve=r)}}});h.retireLayout();const count=h.count();resolve(bytes.buffer);await turn();
 assert.equal(h.count(),count,`${v.suffix}: late state setter`);assert.equal(loaded(h),false);h.retirePassive();h.unmount();}
});
test("new local import admission retains the old physical slot until settlement and reads only on explicit reselection",async()=>{
 for(const v of variants){const h=harness(v);h.mount();const bytes=new TextEncoder().encode(body(v));let resolve,firstReads=0,nextReads=0;
 choose(h,v,{size:bytes.length,slice(){return{arrayBuffer(){firstReads++;return new Promise(r=>resolve=r)}}}});
 h.retireLayout();h.retirePassive();h.admitAgain();const next={size:bytes.length,slice(){return{arrayBuffer(){nextReads++;return Promise.resolve(bytes.buffer)}}}};
 assert.equal(input(h,v).props.disabled,true);choose(h,v,next);assert.equal(firstReads,1);assert.equal(nextReads,0);
 resolve(bytes.buffer);await turn();assert.equal(loaded(h),false);assert.equal(input(h,v).props.disabled,false);assert.equal(nextReads,0);
 choose(h,v,next);await turn();assert.equal(nextReads,1);assert.equal(loaded(h),true);h.unmount();}
});
test("new local import mount waits for an old ignored-abort file read before another selection",async()=>{
 for(const v of variants){const h=harness(v);h.mount();const bytes=new TextEncoder().encode(body(v));let resolve,firstReads=0,nextReads=0;
 choose(h,v,{size:bytes.length,slice(){return{arrayBuffer(){firstReads++;return new Promise(r=>resolve=r)}}}});
 h.remount();const next={size:bytes.length,slice(){return{arrayBuffer(){nextReads++;return Promise.resolve(bytes.buffer)}}}};
 assert.equal(input(h,v).props.disabled,true,v.suffix);choose(h,v,next);assert.equal(firstReads,1);assert.equal(nextReads,0);
 resolve(bytes.buffer);await turn();assert.equal(loaded(h),false);assert.equal(input(h,v).props.disabled,false);assert.equal(nextReads,0);
 choose(h,v,next);await turn();assert.equal(nextReads,1);assert.equal(loaded(h),true);h.unmount();}
});
test("loaded local imports retire their displayed report controls and child ownership before passive cleanup",async()=>{
 for(const v of variants){const h=harness(v);h.mount();choose(h,v,new File([body(v)],"invented.json"));await turn();assert.equal(loaded(h),true);
 const old=elements(h.render()),guards=old.filter(n=>typeof n.props.isCurrent==="function").map(n=>n.props.isCurrent);h.retireLayout();const count=h.count();
 for(const guard of guards)assert.equal(guard(),false);assert.equal(loaded(h),false);
 for(const n of old){if(n.type==="button")n.props.onClick?.();if(["input","select"].includes(n.type)&&n.props.onChange)n.props.onChange(new Proxy({}, {get(){assert.fail("Retired loaded control event read");}}));
 if(n.type==="form") {let prevented=0;n.props.onSubmit?.({preventDefault(){prevented++}});assert.equal(prevented,1)}}
 assert.equal(h.count(),count);h.unmount();}
});
