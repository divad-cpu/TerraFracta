import assert from "node:assert/strict";
import test from "node:test";
import { currentCatalogueSelection } from "../src/current-visitor-catalog.ts";
import { loadCurrentVisitorCatalogue } from "../src/server/current-visitor-catalog.ts";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { renderToStaticMarkup } from "react-dom/server";
const rows=sample(),entry={...rows.requestedRoute,country:"Imaginary place",countryAliases:["Imaginary place"],topic:"housing",topicLabel:"Housing"};
const other="ca180000-0000-4000-8000-000000000099";
const readRows=async route=>createPublicIssueReader(async()=>new TextEncoder().encode(JSON.stringify(rows)))(route);

test("catalogue admits each own enumerable getter value once and uses the originally checked edition and query",async()=>{
 let qReads=0,eReads=0,calls=0;
 const query={view:"issues",get q(){return ++qReads===1?"Imaginary housing":"second query";},get edition(){return ++eReads===1?rows.publication.id:other;}};
 const selected=currentCatalogueSelection(query,entry);assert.ok(selected);assert.equal(selected.query,"Imaginary housing");assert.equal(selected.publicationId,rows.publication.id);assert.equal(qReads,1);assert.equal(eReads,1);
 qReads=0;eReads=0;
 const result=await loadCurrentVisitorCatalogue(query,async route=>{calls++;assert.deepEqual(route,rows.requestedRoute);return readRows(route);},entry,()=>{throw new Error("not diagnostic");});
 assert.equal(result.kind,"available");assert.equal(result.matches,true);assert.equal(calls,1);assert.equal(qReads,1);assert.equal(eReads,1);
});
test("inherited and nonenumerable directory selectors cannot choose filters edition or view and are never observed",()=>{
 let reads=0;const inherited=Object.create({get view(){reads++;return "issues";},get q(){reads++;return "private inherited";},get edition(){reads++;return other;}});
 assert.deepEqual(currentCatalogueSelection(inherited,entry),currentCatalogueSelection({},entry));
 const hidden={};for(const key of ["view","q","country","topic","edition"])Object.defineProperty(hidden,key,{get(){reads++;throw new Error("private hidden");}});
 assert.deepEqual(currentCatalogueSelection(hidden,entry),currentCatalogueSelection({},entry));assert.equal(reads,0);
});
test("unknown own keys refuse before any admitted getters and duplicate malformed values refuse before a reader",async()=>{
 let reads=0,calls=0;assert.equal(currentCatalogueSelection({path:"private",get q(){reads++;throw new Error("private");}},entry),null);assert.equal(reads,0);
 for(const query of [{q:["housing"]},{edition:[rows.publication.id]},{view:"constructor"},{country:null},{topic:[entry.topic]},{q:"x".repeat(81)},{q:"\ufdfa".repeat(5)}]){
  assert.deepEqual(await loadCurrentVisitorCatalogue(query,async()=>{calls++;return readRows(rows.requestedRoute);},entry),{kind:"invalid"});
 }assert.equal(calls,0);
});
test("throwing getters and object enumeration faults are invalid presentation input without reader or technical diagnostics",async()=>{
 let calls=0,logs=0;
 for(const query of [{get q(){throw new Error("PRIVATE_QUERY_CANARY");}},{get edition(){throw new Error("PRIVATE_EDITION_CANARY");}},new Proxy({},{ownKeys(){throw new Error("PRIVATE_ENUM_CANARY");}})]){
  assert.equal(currentCatalogueSelection(query,entry),null);
  const result=await loadCurrentVisitorCatalogue(query,async()=>{calls++;throw new Error("must not read");},entry,()=>{logs++;});assert.deepEqual(result,{kind:"invalid"});
 }assert.equal(calls,0);assert.equal(logs,0);
});
test("checked country topic view and normalized text preserve their one observed values",()=>{
 const first={view:"issues",q:"  Ｉｍａｇｉｎａｒｙ   housing  ",country:entry.jurisdictionSlug,topic:entry.topic,edition:rows.publication.id};const counts={};const query={};
 for(const [key,value] of Object.entries(first))Object.defineProperty(query,key,{enumerable:true,get(){counts[key]=(counts[key]??0)+1;return counts[key]===1?value:"second invalid";}});
 const result=currentCatalogueSelection(query,entry);assert.deepEqual(result,{view:"issues",query:"Imaginary   housing",country:entry.jurisdictionSlug,topic:entry.topic,publicationId:rows.publication.id});assert.deepEqual(counts,{view:1,q:1,country:1,topic:1,edition:1});
});
test("actual async directory page retains checked primitives across its current reader await without forwarding caller selectors",async()=>{
 const input={view:"issues",q:"Imaginary housing",country:entry.jurisdictionSlug,topic:entry.topic,edition:rows.publication.id};let calls=0;
 const page=loadTsx(new URL("../app/reader-preview/catalogue/page.tsx",import.meta.url),name=>name.includes("server/current-visitor-catalog")?{loadCurrentVisitorCatalogue:query=>loadCurrentVisitorCatalogue(query,async route=>{calls++;assert.deepEqual(route,rows.requestedRoute);input.q="PRIVATE_MUTATION_CANARY";input.edition=other;await Promise.resolve();return readRows(route);},entry)}:undefined,{env:{NODE_ENV:"development"}}).default;
 const html=renderToStaticMarkup(await page({searchParams:Promise.resolve(input)}));assert.equal(calls,1);assert.ok(html.includes("1 dossier matches"));assert.ok(html.includes("Imaginary housing"));assert.ok(!html.includes("PRIVATE_MUTATION_CANARY"));assert.ok(!html.includes(other));
});
test("read failures absence and edition replacement retain closed outcomes and withhold old evidence",async()=>{
 for(const [status,kind] of [[404,"absent"],[503,"unavailable"]]){
  const result=await loadCurrentVisitorCatalogue({view:"issues",edition:rows.publication.id},async()=>({status,cacheControl:"no-store"}),entry);assert.equal(result.kind,kind);assert.ok(!Object.hasOwn(result,"issue"));
 }
 assert.equal((await loadCurrentVisitorCatalogue({edition:other},readRows,entry)).kind,"changed");
});
