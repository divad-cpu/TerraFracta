import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { materializePublicIssueFromRows } from "../src/public-read-materializer.ts";
import { publicIssueProjectionSchema } from "../src/public-issue-projection.ts";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
import { issueSourceIndex } from "../src/issue-source-index.ts";
import { createDevelopmentPublicIssueHandler, canonicalPublicIssueRoute } from "../src/server/public-issue-reader.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const sourceId="abcdefab-cdef-4abc-8def-abcdefabcdef";
// Invented supplied decisions only. Native handler shape admission is exercised
// in process; these fields never establish source rights or publication authority.
function sample(uppercaseFirst=false,different=false){
 const value=materializePublicIssueFromRows(sixStagePilotRows()), source=value.claims[1].evidence[0];
 value.claims=value.claims.slice(1,3);
 value.claims[0].evidence=[{...source,sourceVersionId:uppercaseFirst?sourceId.toUpperCase():sourceId}];
 value.claims[1].evidence=[{...source,sourceVersionId:uppercaseFirst?sourceId:sourceId.toUpperCase(),title:"Literal <alias> title",locator:"Alias location",relation:"supports"},
 {...source,sourceVersionId:sourceId,title:"Contrasting reference",locator:"Conflict location",relation:"contradicts"}];
 if(different)value.claims[1].evidence.push({...source,sourceVersionId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",locator:"Different version"});
 return publicIssueProjectionSchema.parse(value);
}
async function admitted(value){
 let calls=0;
 const handle=createDevelopmentPublicIssueHandler(async()=>{calls++;return {status:200,cacheControl:"no-store",issue:value};},()=>assert.fail("Unexpected diagnostic"));
 const response=await handle(new Request("http://127.0.0.1:3000/api/dev/public-issue/norway/housing-costs",{headers:{"sec-fetch-site":"same-origin"}}),{params:Promise.resolve({country:"norway",issue:"housing-costs"})},"development");
 assert.equal(response.status,200);assert.equal(calls,1);return (await response.json()).issue;
}
function page(decision){
 return loadTsx(new URL("../app/reader-preview/[country]/[issue]/[view]/page.tsx",import.meta.url),name=>name==="next/navigation"?{notFound(){assert.fail("Unexpected production branch");},unstable_rethrow(){}}:
 name.includes("server/public-issue-reader")?{canonicalPublicIssueRoute,readPublicIssue:async()=>decision}:undefined).default;
}
const render=async(Page,view,query)=>renderToStaticMarkup(await Page({params:Promise.resolve({country:"norway",issue:"housing-costs",view}),searchParams:Promise.resolve(query)}));
const links=html=>[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>({url:new URL(m[1].replaceAll("&amp;","&"),"https://example.invalid"),text:m[2]}));

test("one source UUID has one first-occurrence group across case aliases without changing reference metadata or order",()=>{
 for(const upper of [false,true]){
  const value=sample(upper),before=structuredClone(value),indexed=issueSourceIndex(value);
  assert.equal(indexed.groups.length,1);assert.equal(indexed.referenceCount,3);
  assert.equal(indexed.groups[0].sourceVersionId,value.claims[0].evidence[0].sourceVersionId);assert.equal(indexed.groups[0].statementCount,2);
  assert.deepEqual(indexed.groups[0].references.map(x=>x.referenceNumber),[1,2,3]);
  assert.deepEqual(indexed.groups[0].references.map(x=>x.source),value.claims.flatMap(x=>x.evidence));assert.deepEqual(value,before);
 }
});
test("native admitted projection and actual issue page count aliases once and retain exact references to the same reuse anchor",async()=>{
 const value=await admitted(sample()),html=await render(page({status:200,cacheControl:"no-store",issue:value}),"issue",{edition:value.publicationId});
 assert.ok(html.includes("3 exact references · 1 recorded source version"));assert.equal((html.match(/id="recorded-source-group-/g)??[]).length,1);
 assert.equal(links(html).filter(x=>x.text==="Inspect all references to this recorded source version").length,3);
 assert.ok(links(html).filter(x=>x.text==="Inspect all references to this recorded source version").every(x=>x.url.hash==="#recorded-source-group-1"));
 assert.ok(html.includes("Literal &lt;alias&gt; title")&&html.includes("Conflict location"));assert.ok(html.includes("Repeated use does not establish independent confirmation"));
});
test("filtered alias reference reports whole-dossier reuse and follows exact edition and selections to its first existing group",async()=>{
 const value=await admitted(sample(true)),Page=page({status:200,cacheControl:"no-store",issue:value});
 const selected={edition:value.publicationId,q:"Alias location",type:"funding",relation:"supports",directoryView:"issues",directoryQ:"housing",directoryCountry:"norway",directoryTopic:"housing"};
 const html=await render(Page,"sources",selected);assert.ok(html.includes("In the complete dossier: 3 exact references across 2 statements"));
 assert.ok(html.includes("Reference 2"));assert.ok(html.includes(sourceId));
 assert.ok(html.includes("<mark"));assert.ok(html.replace(/<\/?mark(?:\s[^>]*)?>/g,"").includes("Literal &lt;alias&gt; title"));
 const link=links(html).find(x=>x.text==="Inspect this source version in the complete dossier");assert.ok(link);assert.equal(link.url.hash,"#recorded-source-group-1");
 const returned=await render(Page,"issue",Object.fromEntries(link.url.searchParams));assert.ok(returned.includes('id="recorded-source-group-1"'));
 const back=links(returned).find(x=>x.text==="Back to selected results");assert.ok(back);assert.deepEqual(Object.fromEntries(back.url.searchParams),selected);
});
test("different version UUIDs from the same URL and publisher remain distinct from aliases with per-reference conflicting metadata intact",()=>{
 const value=sample(false,true),groups=issueSourceIndex(value).groups;assert.equal(groups.length,2);
 assert.deepEqual(groups.map(x=>[x.references.length,x.statementCount]),[[3,2],[1,1]]);
 assert.equal(groups[0].references[1].source.title,"Literal <alias> title");assert.equal(groups[0].references[2].source.relation,"contradicts");
 assert.equal(groups[0].references[0].source.url,groups[1].references[0].source.url);
});
test("withheld absent and changed current decisions reveal no earlier alias versions or reference wording",async()=>{
 const value=sample();
 for(const decision of [{status:404,cacheControl:"no-store"},{status:503,cacheControl:"no-store"},{status:200,cacheControl:"no-store",issue:{...value,publicationId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}}])
  for(const view of ["issue","sources","search"]){const html=await render(page(decision),view,{edition:value.publicationId});assert.doesNotMatch(html,/recorded-source-group-|Alias location|Literal &lt;alias&gt;|abcdefab-cdef/i);}
});
