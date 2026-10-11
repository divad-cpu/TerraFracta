import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as navigation from "../src/current-issue-navigation.ts";
import { currentCatalogueSelection,currentVisitorEntry,currentCatalogueResult } from "../src/current-visitor-catalog.ts";
import { loadCurrentVisitorCatalogue } from "../src/server/current-visitor-catalog.ts";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const rows=sample();rows.requestedRoute={jurisdictionSlug:currentVisitorEntry.jurisdictionSlug,issueSlug:currentVisitorEntry.issueSlug};rows.country.public_slug=rows.requestedRoute.jurisdictionSlug;rows.dossier.public_slug=rows.requestedRoute.issueSlug;rows.publication.snapshot.jurisdictionSlug=rows.requestedRoute.jurisdictionSlug;rows.publication.snapshot.issueSlug=rows.requestedRoute.issueSlug;
const reader=data=>createPublicIssueReader(async()=>new TextEncoder().encode(JSON.stringify(data)),()=>performance.now(),()=>{});
const decision=await reader(rows)(rows.requestedRoute);assert.equal(decision.status,200);const issue=decision.issue;
const Catalogue=loadTsx(new URL("../src/current-visitor-catalog-view.tsx",import.meta.url)).CurrentVisitorCatalogueView;
const Dossier=loadTsx(new URL("../src/current-issue-navigation-view.tsx",import.meta.url)).CurrentIssueNavigationView;
const initial={view:"issues",q:"Norway housing",country:"norway",topic:"housing",edition:issue.publicationId};
const decode=text=>text.replaceAll("&amp;","&").replaceAll("&quot;",'"').replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&#x27;","'");
const links=html=>[...html.matchAll(/href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>({url:new URL(decode(m[1]),"https://example.invalid"),text:decode(m[2])}));
const link=(html,text)=>{const found=links(html).find(row=>row.text===text);assert.ok(found,text);return found.url;};
const params=url=>Object.fromEntries(url.searchParams);
const render=(view,query,outcome=decision)=>{const selection=navigation.currentIssueSelection(view,query);assert.ok(selection);return renderToStaticMarkup(createElement(Dossier,{decision:outcome,selection,latestHref:"/reader-preview/norway/housing-costs/"+view}));};
const catalogue=async query=>renderToStaticMarkup(createElement(Catalogue,{result:await loadCurrentVisitorCatalogue(query,reader(rows))}));
const entryQuery=async(view="issue")=>{const html=await catalogue(initial),text=view==="issue"?"Read the dossier":view==="sources"?"Inspect source references":"Search this dossier";return params(link(html,text));};
const back=html=>link(html,"Back to selected directory results");

test("actual checked catalogue card offers three same edition entries and complete inspection returns to the original directory filters",async()=>{
 const html=await catalogue(initial);assert.ok(html.includes("1 dossier matches"));
 for(const view of ["issue","sources","search"]){const q=await entryQuery(view),page=render(view,q);assert.equal(q.directoryView,"issues");assert.equal(q.directoryQ,"Norway housing");assert.deepEqual(params(back(page)),initial);assert.ok(page.includes("checks the current directory again"));
  const returned=await catalogue(params(back(page)));assert.ok(returned.includes("1 dossier matches"));assert.ok(returned.includes('value="Norway housing"'));}
 const full=render("issue",await entryQuery());for(const source of issue.claims[0].evidence)assert.ok(full.includes(source.locator));assert.ok(full.includes("Conflicting evidence is included"));
});
test("native dossier tabs retain only directory context and reset the internal view filters",async()=>{
 const q={...await entryQuery("sources"),q:"footnote",type:"condition",relation:"context"};const html=render("sources",q);
 for(const [view,label] of [["issue","Issue"],["sources","Sources"],["search","Search this issue"]]){const next=link(html,label);assert.ok(!next.searchParams.has("q"));assert.ok(!next.searchParams.has("type"));assert.ok(!next.searchParams.has("relation"));assert.deepEqual(params(back(render(view,params(next)))),initial);}
});
test("native source and search GET forms keep hidden directory fields separate from edited dossier query",async()=>{
 for(const view of ["sources","search"]){const html=render(view,{...await entryQuery(view),q:"edited dossier query"});const forms=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m=>m[1]);assert.equal(forms.length,1);
  const hidden=Object.fromEntries([...forms[0].matchAll(/<input\b[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*\/?\s*>/g)].map(m=>[m[1],decode(m[2])]));
  assert.deepEqual(hidden,{edition:issue.publicationId,directoryView:"issues",directoryQ:"Norway housing",directoryCountry:"norway",directoryTopic:"housing"});const parsed=navigation.currentIssueSelection(view,{...hidden,q:"new dossier query",type:"condition"});assert.ok(parsed);assert.equal(parsed.query,"new dossier query");assert.equal(parsed.directory.query,"Norway housing");}
});
test("reference inspection preserves full conflicting evidence and both selected dossier and directory returns",async()=>{
 const source={...await entryQuery("sources"),q:"footnote",type:"condition",relation:"context"};const html=render("sources",source),exact=link(html,"Read reference 3 in the statement");assert.equal(exact.hash,"#reference-"+issue.claims[0].id+"-3");
 const full=render("issue",params(exact));assert.ok(full.includes("Conflicting evidence is included"));const selected=link(full,"Back to selected results");assert.deepEqual(params(selected),source);const restored=render("sources",params(selected));assert.ok(restored.includes("Showing 1 of 3 references"));assert.deepEqual(params(back(restored)),initial);assert.deepEqual(params(back(full)),initial);
});
test("no matching internal search and source filters clear without discarding the checked directory selection",async()=>{
 for(const [view,label] of [["search","Clear this search"],["sources","Clear filters"]]){const html=render(view,{...await entryQuery(view),q:"NO_INTERNAL_MATCH"});const clear=link(html,label);assert.ok(!clear.searchParams.has("q"));assert.deepEqual(params(back(render(view,params(clear)))),initial);}
});
test("changed absent unavailable and withdrawn rights withhold all old directory context evidence and result links",async()=>{
 const q={...await entryQuery(),directoryQ:"PRIVATE_DIRECTORY_CANARY"};
 for(const outcome of [{...decision,issue:{...issue,publicationId:"ca190000-0000-4000-8000-000000000099"}},{status:404,cacheControl:"no-store"},{status:503,cacheControl:"no-store"}]){const html=render("issue",q,outcome);assert.ok(!html.includes("PRIVATE_DIRECTORY_CANARY"));assert.ok(!html.includes("Back to selected directory results"));assert.ok(!html.includes(issue.claims[0].assertion));}
 const withdrawn=structuredClone(rows);withdrawn.sources[0].registration.allow_public_derived=false;const outcome=await reader(withdrawn)(rows.requestedRoute);assert.equal(outcome.status,503);assert.ok(!render("sources",q,outcome).includes("Back to selected directory results"));
 const replaced=await catalogue({...initial,edition:"ca190000-0000-4000-8000-000000000099"});assert.ok(replaced.includes("The directory edition changed"));assert.ok(!replaced.includes(issue.title));
});
test("actual async dossier page snapshots directory selection before its current reader await and forwards only route",async()=>{
 const raw=await entryQuery();let getterReads=0;Object.defineProperty(raw,"directoryQ",{enumerable:true,get(){getterReads++;return getterReads===1?"Norway housing":"PRIVATE_CHANGED_CANARY";}});let calls=0;
 const page=loadTsx(new URL("../app/reader-preview/[country]/[issue]/[view]/page.tsx",import.meta.url),name=>name.includes("server/public-issue-reader")?{canonicalPublicIssueRoute:value=>value,readPublicIssue:async route=>{calls++;assert.deepEqual(route,rows.requestedRoute);raw.directoryView="countries";await Promise.resolve();return reader(rows)(route);}}:name==="next/navigation"?{notFound(){throw new Error("not-found");}}:undefined,{env:{NODE_ENV:"development"}}).default;
 const html=renderToStaticMarkup(await page({params:Promise.resolve({country:"norway",issue:"housing-costs",view:"issue"}),searchParams:Promise.resolve(raw)}));assert.equal(calls,1);assert.equal(getterReads,1);assert.deepEqual(params(back(html)),initial);assert.ok(!html.includes("PRIVATE_CHANGED_CANARY"));
});
test("plain dossier visits invent no selected directory and production refuses before query or current reader",async()=>{
 const plain=render("issue",{edition:issue.publicationId});assert.ok(!plain.includes("Back to selected directory results"));assert.ok(plain.includes("Back to the current directory"));let calls=0,observed=0;const stop=new Error("not-found");
 const page=loadTsx(new URL("../app/reader-preview/[country]/[issue]/[view]/page.tsx",import.meta.url),name=>name==="next/navigation"?{notFound(){throw stop;}}:name.includes("server/public-issue-reader")?{readPublicIssue(){calls++;return decision;}}:undefined,{env:{NODE_ENV:"production"}}).default;
 await assert.rejects(page(Object.defineProperty({},"searchParams",{get(){observed++;throw new Error("private");}})),error=>error===stop);assert.equal(calls,0);assert.equal(observed,0);
});
