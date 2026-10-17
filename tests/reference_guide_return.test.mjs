import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
import { createPublicIssueReader, canonicalPublicIssueRoute } from "../src/server/public-issue-reader.ts";
import { canonicalReadingGuideReturn, readingGuideHref } from "../src/current-reading-guide.ts";
import { findGlossaryTerms } from "../src/evidence-glossary.ts";
const origin="https://example.invalid";
const links=html=>[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m=>({url:new URL(m[1].replaceAll("&amp;","&"),origin),text:m[2]}));
const params=url=>Object.fromEntries(url.searchParams);
const back=html=>links(html).find(link=>link.text==="Back to the selected dossier").url;
const pages=Object.fromEntries([['guide','../app/methodology/glossary/page.tsx'],['method','../app/methodology/page.tsx'],['standards','../app/sources/page.tsx']].map(([key,path])=>[key,loadTsx(new URL(path,import.meta.url)).default]));
const render=async(key,query)=>renderToStaticMarkup(await pages[key]({searchParams:Promise.resolve(query)}));
function harness(){let rows=sixStagePilotRows();const calls=[],decisions=[];const read=createPublicIssueReader(async(route,signal)=>{calls.push({route,signal});return new TextEncoder().encode(JSON.stringify(rows));},()=>0,()=>assert.fail('diagnostic'));
 const Page=loadTsx(new URL('../app/reader-preview/[country]/[issue]/[view]/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){assert.fail('route');},unstable_rethrow(){}}:name.includes('server/public-issue-reader')?{canonicalPublicIssueRoute,readPublicIssue:async route=>{const decision=await read(route);decisions.push(decision);return decision;}}:undefined).default;
 return {rows,calls,decisions,set:value=>{rows=value;},issue:async query=>renderToStaticMarkup(await Page({params:Promise.resolve({country:'norway',issue:'housing-costs',view:'issue'}),searchParams:Promise.resolve(query)}))};}
test('exact conflicting reference survives guide search method standards and fresh same-edition dossier return',async()=>{
 const h=harness(),query={edition:h.rows.publication.id,returnView:'sources',returnQ:'cell A1',returnType:'condition',returnRelation:'contradicts',directoryView:'issues',directoryQ:'housing'};
 const issue=await h.issue(query),claim=h.rows.publication.snapshot.claims[0],anchor=`reference-${claim.id}-2`;
 const card=new RegExp(`<li id="${anchor}"([\\s\\S]*?)<\\/li>`).exec(issue)?.[1]??'';
 const definition=links(card).find(link=>link.text==='Definition: Points to a conflict');assert.ok(definition);
 assert.equal(definition.url.searchParams.get('returnAnchor'),anchor);assert.equal(definition.url.hash,'#conflict');
 const selection=params(definition.url);let html=await render('guide',{...selection,q:'conflict',category:'evidence'});assert.equal(back(html).hash,'#'+anchor);
 assert.match(html,new RegExp(`name="returnAnchor" value="${anchor}"`));
 let method=links(html).find(link=>link.text.startsWith('Read the full method')).url;assert.equal(method.searchParams.get('returnAnchor'),anchor);html=await render('method',params(method));assert.equal(back(html).hash,'#'+anchor);
 const guide=links(html).find(link=>link.text.startsWith('Find a term')).url;html=await render('guide',params(guide));const standards=links(html).find(link=>link.text.startsWith('Read the source standards')).url;html=await render('standards',params(standards));assert.equal(back(html).hash,'#'+anchor);
 const evidenceGuide=links(html).find(link=>link.text.startsWith('Look up source')).url;html=await render('guide',params(evidenceGuide));const returned=back(html);assert.equal(returned.hash,'#'+anchor);assert.deepEqual(params(returned),query);
 const current=await h.issue(params(returned));assert.equal((current.match(new RegExp(`id="${anchor}"`,'g'))??[]).length,1);assert.equal(h.calls.length,2);
 const held=structuredClone(h.rows);held.sources[0].registration.allow_public_derived=false;h.set(held);const hidden=await h.issue(params(returned));assert.doesNotMatch(hidden,new RegExp(`id="${anchor}"`));assert.match(hidden,/Issue temporarily unavailable/);
});
test('strict anchor selector cannot carry private routes URLs raw fragments or an unbound target',async()=>{
 const h=harness(),returnTo=`/reader-preview/norway/housing-costs/issue?edition=${h.rows.publication.id}`,id=h.rows.publication.snapshot.claims[0].id;
 for(const returnAnchor of ['https://PRIVATE.invalid','/editorial-preview/PRIVATE','#claim-'+id,'reference-'+id+'-0','reference-'+id+'-13','claim-not-a-uuid', ['PRIVATE'],null]) {
  const html=await render('guide',{returnTo,returnAnchor,q:'funding'});assert.match(html,/Check your search/);assert.equal(back(html).hash,'');assert.doesNotMatch(html,/PRIVATE|name="returnAnchor"/);
 }
 const orphan=await render('guide',{returnAnchor:'claim-'+id});assert.doesNotMatch(orphan,/Back to the selected dossier|name="returnAnchor"/);
 for(const value of [returnTo+'#',returnTo+'#claim-'+id]){assert.equal(canonicalReadingGuideReturn(value),null);assert.equal(readingGuideHref(value,'claim-'+id),'/methodology/glossary');}
});
test('validated reference target survives invalid term search and show-all recovery without echoing bad input',async()=>{
 const h=harness(),returnTo=`/reader-preview/norway/housing-costs/issue?edition=${h.rows.publication.id}`,returnAnchor='reference-'+h.rows.publication.snapshot.claims[0].id+'-1';
 for(const query of [{q:'missing-word'}, {q:['PRIVATE']}, {category:'PRIVATE'}]) {
  const html=await render('guide',{returnTo,returnAnchor,...query});assert.equal(back(html).hash,'#'+returnAnchor);assert.doesNotMatch(html,/PRIVATE/);
  const recovery=links(html).find(link=>link.text.startsWith('Show all definitions')).url;assert.deepEqual(params(recovery),{returnTo,returnAnchor});
 }
});
test('anchor observations remain once-only and hidden inherited or unknown-key values supply no target',async()=>{
 const h=harness(),returnTo=`/reader-preview/norway/housing-costs/issue?edition=${h.rows.publication.id}`,anchor='reference-'+h.rows.publication.snapshot.claims[0].id+'-1';
 let reads=0;const values={returnTo,get returnAnchor(){reads++;return reads===1?anchor:'PRIVATE';}};const html=await render('guide',values);assert.equal(reads,1);assert.equal(back(html).hash,'#'+anchor);
 for(const key of ['method','standards']){reads=0;const output=await render(key,{returnTo,get returnAnchor(){reads++;return reads===1?anchor:'PRIVATE';}});assert.equal(reads,1);assert.equal(back(output).hash,'#'+anchor);}
 const hidden=Object.create({get returnAnchor(){assert.fail('inherited');}});hidden.returnTo=returnTo;assert.equal(back(await render('guide',hidden)).hash,'');
 assert.equal(findGlossaryTerms({extra:'PRIVATE',get returnAnchor(){assert.fail('veto');}}).kind,'invalid');
});
