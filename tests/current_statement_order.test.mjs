import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createPublicIssueReader, canonicalPublicIssueRoute } from "../src/server/public-issue-reader.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
function harness() {
 let rows=sixStagePilotRows();const decisions=[];
 const read=createPublicIssueReader(async()=>new TextEncoder().encode(JSON.stringify(rows)),()=>0,()=>assert.fail("diagnostic"));
 const Page=loadTsx(new URL("../app/reader-preview/[country]/[issue]/[view]/page.tsx",import.meta.url),name=>name==="next/navigation"?{notFound(){assert.fail("route");},unstable_rethrow(){}}:name.includes("server/public-issue-reader")?{canonicalPublicIssueRoute,readPublicIssue:async route=>{const decision=await read(route);decisions.push(decision);return decision;}}:undefined).default;
 return {rows,decisions,set:value=>{rows=value;},render:async(view,query={})=>renderToStaticMarkup(await Page({params:Promise.resolve({country:"norway",issue:"housing-costs",view}),searchParams:Promise.resolve(query)}))};
}
test("fragment targets disclose original dossier order beside type and period",async()=>{
 const h=harness(),html=await h.render("issue"),issue=h.decisions[0].issue;
 for(const [index,claim] of issue.claims.entries()) {
  const item=new RegExp(`<article aria-labelledby="claim-${claim.id}">([\\s\\S]*?)<h3 id="claim-${claim.id}" tabindex="-1">`).exec(html)?.[1]??"";
  assert.match(item,new RegExp(`Statement ${index+1} ·`));assert.ok(item.includes(claim.periodLabel));
 }
 assert.match(html,/Statement numbers follow this publication&#x27;s record order/);
});
test("filtered search and source results preserve dossier ordinals rather than renumbering matches",async()=>{
 const h=harness(),edition=h.rows.publication.id;
 for(const [view,type,number,label] of [["search","funding",3,"Funding"],["sources","delivery",4,"Delivery"],["search","evaluation",6,"Evaluation"]]) {
  const html=await h.render(view,{edition,type}),block=new RegExp(`<ol class="current-${view==="search"?"search-results":"source-list"}">([\\s\\S]*?)<\\/ol>`).exec(html)?.[1]??"";
  assert.match(block,new RegExp(`Statement ${number} · ${label}`));assert.doesNotMatch(block,/Statement 1 ·/);
  assert.match(block,/edition=[^&"]+.*#claim-/);assert.equal(h.decisions.at(-1).status,200);
 }
});
test("type overview and source reuse show the same statement references as their complete targets",async()=>{
 const h=harness(),html=await h.render("issue"),issue=h.decisions[0].issue;
 const stages=/<div class="dossier-stage-grid">([\s\S]*?)<nav class="evidence-outline"/.exec(html)?.[1]??"";
 const groups=/<details class="dossier-source-index">([\s\S]*?)<\/details>/.exec(html)?.[1]??"";
 for(const [index,claim] of issue.claims.entries()) {assert.ok(stages.includes(`Statement ${index+1}:`));assert.ok(groups.includes(`Statement ${index+1} ·`));assert.ok(stages.includes(`#claim-${claim.id}`));}
});
test("changed and withheld editions cannot retain old numbered statements",async()=>{
 const h=harness(),edition=h.rows.publication.id;await h.render("issue",{edition});
 const held=structuredClone(h.rows);held.sources[0].registration.allow_public_derived=false;h.set(held);
 for(const view of ["issue","search","sources"])assert.doesNotMatch(await h.render(view,{edition}),/Statement [1-6] ·|id="claim-|Draft details/);
 h.set(JSON.parse(JSON.stringify(h.rows).replaceAll(edition,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")));
 assert.match(await h.render("search",{edition}),/A newer publication is available/);
});
