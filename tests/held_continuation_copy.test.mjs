import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { heldReport,decisionRow,heldId } from "./helpers/operator_held_fixture.mjs";
const View=loadTsx(new URL("../src/operator-held-decisions-view.tsx",import.meta.url)).HeldDecisionsView;
function page(matches=0,more=true) {
 const report=heldReport();report.decisions=Array.from({length:20},(_,i)=>decisionRow(40-i));
 for(const row of report.decisions.slice(0,matches))row.reasonCodes=["source_not_approved"];
 report.more=more;report.nextCursor=more?{decidedAt:report.decisions[19].decidedAt,decisionId:report.decisions[19].decisionId}:null;
 return report;
}
const render=(report,reason="source_not_approved")=>renderToStaticMarkup(createElement(View,{decision:{kind:"ok",report},selection:report.requested,reason}));
test("older continuation never claims20displayed rows after zero or partial reason matches",()=>{
 for(const count of [0,1,7,20]) {
  const report=page(count),html=render(report);
  assert.ok(html.includes(`Showing ${count} of 20 held decisions on this checked page.`));
  assert.ok(html.includes("More older recorded decisions are available to inspect. Each page makes a new read."));
  assert.ok(!html.includes("This page shows 20 held decisions."));
  assert.equal((html.match(/<h3>Held ·/g)||[]).length,count);
  if(count===0)assert.ok(html.includes("No matching disclosed reason on this page"));
  assert.ok(html.includes("filters only the checked page"));assert.ok(html.includes("Filtering does not clear a hold"));
 }
});
test("continuation copy retains the exact next cursor selected reason and fresh-read navigation",()=>{
 const report=page(1),html=render(report),match=[...html.matchAll(/href="([^"]+)"[^>]*>Older held decisions<\/a>/g)][0];assert.ok(match);
 const url=new URL(match[1].replaceAll("&amp;","&"),"https://example.invalid");
 assert.deepEqual(Object.fromEntries(url.searchParams),{runId:heldId(1),beforeDecidedAt:report.nextCursor.decidedAt,beforeDecisionId:report.nextCursor.decisionId,reason:"source_not_approved"});
 const all=render(report,"");assert.ok(all.includes("Showing 20 of 20 held decisions"));assert.ok(all.includes("More older recorded decisions are available to inspect."));
 assert.ok(all.includes("Start a fresh held-decision read"));assert.ok(all.includes("historical held decisions"));
});
test("a checked page without an older continuation and withheld records do not acquire the new more statement",()=>{
 const exhausted=render(page(0,false));assert.ok(exhausted.includes("No older continuation was returned for this checked page."));
 assert.ok(!exhausted.includes("More older recorded decisions"));assert.ok(!exhausted.includes("Older held decisions</a>"));
 for(const kind of ["unavailable","changed","not_found"]) {
  const html=renderToStaticMarkup(createElement(View,{decision:{kind},selection:page().requested,reason:"source_not_approved"}));
  assert.ok(!html.includes("More older recorded decisions"));assert.ok(!html.includes("Showing 0 of 20"));assert.ok(!html.includes("<h3>Held ·"));
 }
});
