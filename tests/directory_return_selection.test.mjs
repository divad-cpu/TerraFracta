import assert from "node:assert/strict";
import test from "node:test";
import * as navigation from "../src/current-issue-navigation.ts";
import { currentCatalogueSelection,currentVisitorEntry } from "../src/current-visitor-catalog.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
const rows=sample();rows.requestedRoute={jurisdictionSlug:currentVisitorEntry.jurisdictionSlug,issueSlug:currentVisitorEntry.issueSlug};rows.country.public_slug=rows.requestedRoute.jurisdictionSlug;rows.dossier.public_slug=rows.requestedRoute.issueSlug;rows.publication.snapshot.jurisdictionSlug=rows.requestedRoute.jurisdictionSlug;rows.publication.snapshot.issueSlug=rows.requestedRoute.issueSlug;
const decision=await createPublicIssueReader(async()=>new TextEncoder().encode(JSON.stringify(rows)),()=>performance.now(),()=>{})(rows.requestedRoute);assert.equal(decision.status,200);const issue=decision.issue;
const edition=issue.publicationId,other="ca190000-0000-4000-8000-000000000099";
const values={edition,directoryView:"issues",directoryQ:"  Ｎｏｒｗａｙ   housing  ",directoryCountry:"norway",directoryTopic:"housing"};
const query=url=>Object.fromEntries(new URL(url,"https://example.invalid").searchParams);

test("closed directory context is accepted independently in all dossier views and frozen with its own edition",()=>{
 for(const view of ["issue","sources","search"]){const raw={...values};const selected=navigation.currentIssueSelection(view,raw);assert.ok(selected);assert.deepEqual(selected.directory,{view:"issues",query:"Norway   housing",country:"norway",topic:"housing",publicationId:edition});assert.ok(Object.isFrozen(selected.directory));raw.directoryQ="mutated";assert.equal(selected.directory.query,"Norway   housing");}
});
test("partial duplicate private overbound or unavailable directory selectors refuse without borrowing ordinary dossier query fields",()=>{
 const bad=[{directoryView:"issues"},{edition,directoryQ:"Norway"},{...values,directoryView:"../private"},{...values,directoryView:["issues"]},{...values,directoryCountry:"another-place"},{...values,directoryTopic:"scores"},{...values,directoryQ:"x".repeat(81)},{...values,directoryQ:"\ufdfa".repeat(5)},{...values,returnAddress:"https://example.invalid"},{...values,directoryQ:["Norway"]}];
 for(const raw of bad)assert.equal(navigation.currentIssueSelection("issue",raw),null);
 assert.equal(navigation.currentIssueSelection("issue",{...values,q:"ordinary issue query"}),null);
});
test("directory context observes each own visible value once and inherited hidden throwing or unknown keys cannot choose it",()=>{
 let reads=0;const raw={edition,get directoryView(){reads++;return reads===1?"issues":"countries";},directoryQ:"Norway"};const selected=navigation.currentIssueSelection("issue",raw);assert.ok(selected);assert.equal(reads,1);assert.equal(selected.directory.view,"issues");
 const inherited=Object.create(values);assert.deepEqual(navigation.currentIssueSelection("issue",inherited),navigation.currentIssueSelection("issue",{}));
 const hidden={edition};Object.defineProperty(hidden,"directoryView",{get(){throw new Error("hidden");}});assert.deepEqual(navigation.currentIssueSelection("issue",hidden),navigation.currentIssueSelection("issue",{edition}));
 assert.equal(navigation.currentIssueSelection("issue",{edition,get directoryView(){throw new Error("private");}}),null);let observed=0;assert.equal(navigation.currentIssueSelection("issue",{edition,privateKey:"private",get directoryView(){observed++;return "issues";}}),null);assert.equal(observed,0);
});
test("directory card hrefs bind current route edition and normalized directory selection using fixed native query fields",()=>{
 const selected=currentCatalogueSelection({view:"issues",q:"Norway & <literal>",country:"norway",topic:"housing"});
 for(const view of ["issue","sources","search"]){const href=navigation.currentCatalogueIssueHref(issue,view,selected);const parsed=navigation.currentIssueSelection(view,query(href));assert.ok(parsed);assert.equal(parsed.directory.query,"Norway & <literal>");assert.equal(parsed.publicationId,edition);assert.equal(new URL(href,"https://example.invalid").pathname,`/reader-preview/norway/housing-costs/${view}`);}
 assert.equal(navigation.currentCatalogueIssueHref(issue,"issue",{...selected,publicationId:other}),navigation.currentIssueHref(issue,"issue"));
});
test("explicit directory return reconstructs only its checked selection and invalid foreign direct contexts give no return",()=>{
 const selected=navigation.currentIssueSelection("search",{...values,q:"footnote",type:"condition"});assert.ok(selected);const href=navigation.currentIssueDirectoryHref(issue,selected);assert.deepEqual(currentCatalogueSelection(query(href)),selected.directory);assert.equal(new URL(href,"https://example.invalid").pathname,"/reader-preview/catalogue");
 assert.equal(navigation.currentIssueDirectoryHref(issue,{...selected,publicationId:other}),null);
 assert.equal(navigation.currentIssueDirectoryHref({...issue,issueSlug:"other-issue"},selected),null);
 assert.equal(navigation.currentIssueDirectoryHref(issue,{...selected,directory:{...selected.directory,country:"private-place"}}),null);
 assert.equal(navigation.currentIssueDirectoryHref(issue,navigation.currentIssueSelection("issue",{edition})),null);
});
test("same edition tabs and hidden form fields retain directory context while ordinary dossier filters are separate",()=>{
 const selected=navigation.currentIssueSelection("sources",{...values,q:"footnote",type:"condition",relation:"context"});assert.ok(selected);
 for(const view of ["issue","sources","search"]){const next=navigation.currentIssueSelection(view,query(navigation.currentIssueSelectedHref(issue,view,selected)));assert.deepEqual(next.directory,selected.directory);assert.equal(next.query,"");assert.equal(next.relation,"");}
 assert.deepEqual(Object.fromEntries(navigation.currentIssueDirectoryFields(issue,selected)),{directoryView:"issues",directoryQ:"Norway   housing",directoryCountry:"norway",directoryTopic:"housing"});
});
test("selected dossier-result inspection and return preserve independent directory context with exact reference and filter selection",()=>{
 const selected=navigation.currentIssueSelection("sources",{...values,q:"footnote",type:"condition",relation:"context"});assert.ok(selected);
 const full=navigation.currentIssueSelection("issue",query(navigation.currentIssueInspectionHref(issue,selected)));assert.ok(full);assert.deepEqual(full.directory,selected.directory);assert.deepEqual(full.returnTo,{view:"sources",query:"footnote",statementType:"condition",relation:"context"});
 const returned=navigation.currentIssueSelection("sources",query(navigation.currentIssueReturnHref(issue,full)));assert.deepEqual(returned,selected);
 assert.deepEqual(query(navigation.currentIssueDirectoryHref(issue,full)),query(navigation.currentIssueDirectoryHref(issue,returned)));
});

test("an explicitly present but undefined directory view refuses instead of defaulting a partial return",()=>{
 for(const view of ["issue","sources","search"])assert.equal(navigation.currentIssueSelection(view,{edition,directoryView:undefined,directoryQ:"Norway"}),null);
 const selected=navigation.currentIssueSelection("issue",values);assert.ok(selected);
 assert.equal(navigation.currentIssueDirectoryHref(issue,{...selected,directory:{...selected.directory,view:undefined}}),null);
});
test("new direct directory navigation helpers cannot use an unsupported view as a path selector",()=>{
 const selected=navigation.currentIssueSelection("issue",values);assert.ok(selected);const catalogue=currentCatalogueSelection({view:"issues",q:"Norway"});
 for(const view of ["../private","constructor","https://example.invalid"]){assert.equal(navigation.currentIssueSelectedHref(issue,view,selected),navigation.currentIssueHref(issue,"issue"));assert.equal(navigation.currentCatalogueIssueHref(issue,view,catalogue),navigation.currentIssueHref(issue,"issue"));}
});

test("direct directory helpers require complete own enumerable finite context and capture its values once",()=>{
 const valid={view:"issues",query:"Norway",country:"norway",topic:"housing",publicationId:edition};
 const missing={query:"Norway",country:"norway",topic:"housing",publicationId:edition};
 const hidden={...valid};Object.defineProperty(hidden,"view",{value:"issues",enumerable:false});
 const input=[{...valid,view:undefined},missing,Object.create(valid),hidden,{...valid,privateAddress:"https://example.invalid"},{...valid,view:"../private"}];
 const actual=input.map(value=>navigation.currentCatalogueIssueHref(issue,"issue",value));
 const selected={view:"issue",publicationId:edition,query:"",statementType:"",relation:"",directory:valid};
 const inheritedNested=navigation.currentIssueDirectoryHref(issue,{...selected,directory:Object.create(valid)});
 const inheritedOuter=navigation.currentIssueDirectoryHref(issue,Object.create(selected));
 const hiddenOuter={...selected};Object.defineProperty(hiddenOuter,"directory",{value:valid,enumerable:false});
 const hiddenNested=navigation.currentIssueDirectoryHref(issue,{...selected,directory:hidden});
 assert.deepEqual(actual,input.map(()=>navigation.currentIssueHref(issue,"issue")));assert.equal(inheritedNested,null);assert.equal(inheritedOuter,null);assert.equal(navigation.currentIssueDirectoryHref(issue,hiddenOuter),null);assert.equal(hiddenNested,null);
 let reads=0;const observed={...valid,get query(){reads++;return reads===1?"Norway":"later";}};const href=navigation.currentCatalogueIssueHref(issue,"issue",observed);assert.equal(new URL(href,"https://example.invalid").searchParams.get("directoryQ"),"Norway");assert.equal(reads,1);
 let forbiddenReads=0;assert.equal(navigation.currentCatalogueIssueHref(issue,"issue",{...valid,privateSelector:true,get query(){forbiddenReads++;throw new Error("private");}}),navigation.currentIssueHref(issue,"issue"));assert.equal(forbiddenReads,0);
});

test("direct checked directory context cannot turn undefined scalar values into empty filters",()=>{
 const valid={view:"issues",query:"Norway",country:"norway",topic:"housing",publicationId:edition};
 const selected={view:"issue",publicationId:edition,query:"",statementType:"",relation:"",directory:valid};
 const bad=["query","country","topic"].map(field=>({...valid,[field]:undefined}));
 assert.deepEqual(bad.map(value=>navigation.currentCatalogueIssueHref(issue,"issue",value)),bad.map(()=>navigation.currentIssueHref(issue,"issue")));
 assert.deepEqual(bad.map(value=>navigation.currentIssueDirectoryHref(issue,{...selected,directory:value})),bad.map(()=>null));
});

test("complete inspection composes one directory and publication capture for its checked return",()=>{
 let directoryReads=0,publicationReads=0;
 const value={view:"search",get publicationId(){publicationReads++;return edition;},query:"reference",statementType:"",relation:"",get directory(){directoryReads++;return {view:"issues",query:directoryReads===1?"FIRST OWN SELECTION":"LATER OWN SELECTION",country:"norway",topic:"housing",publicationId:edition};}};
 const href=navigation.currentIssueInspectionHref(issue,value);const params=new URL(href,"https://example.invalid").searchParams;
 assert.equal(params.get("directoryQ"),"FIRST OWN SELECTION");assert.equal(directoryReads,1);assert.equal(publicationReads,1);assert.equal(params.get("returnQ"),"reference");assert.equal(params.get("edition"),edition);
});
