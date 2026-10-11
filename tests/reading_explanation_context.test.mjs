import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { sample } from './helpers/public_read_rows_fixture.mjs';
import { createPublicIssueReader,canonicalPublicIssueRoute } from '../src/server/public-issue-reader.ts';
import * as navigation from '../src/current-reading-guide.ts';
const origin='https://example.invalid';
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
const links=html=>[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m=>({...attrs(m[1]),text:m[2].replace(/<[^>]*>/g,'')}));
const target=(html,label)=>links(html).find(row=>row.text.startsWith(label))?.href??assert.fail(`Missing ${label}`);
const query=href=>Object.fromEntries(new URL(href,origin).searchParams);
const Guide=loadTsx(new URL('../app/methodology/glossary/page.tsx',import.meta.url)).default;
const Method=loadTsx(new URL('../app/methodology/page.tsx',import.meta.url)).default;
const Sources=loadTsx(new URL('../app/sources/page.tsx',import.meta.url)).default;
const render=async(Page,q)=>renderToStaticMarkup(await Page({searchParams:Promise.resolve(q)}));
function rows(){const r=sample();r.requestedRoute={jurisdictionSlug:'norway',issueSlug:'housing-costs'};r.country.public_slug='norway';r.dossier.public_slug='housing-costs';r.publication.snapshot.jurisdictionSlug='norway';r.publication.snapshot.issueSlug='housing-costs';return r}
const back=(view='sources')=>`/reader-preview/norway/housing-costs/issue?${new URLSearchParams({edition:rows().publication.id,returnView:view,returnQ:'cell #1',returnType:'condition',...(view==='sources'?{returnRelation:'supports'}:{}),directoryView:'issues',directoryQ:'housing',directoryCountry:'norway',directoryTopic:'housing'})}`;
const explanations=[[Method,'/methodology','Read the full method','Find a term or a reading question'],[Sources,'/sources','Read the source standards','Look up source and evidence terms']];
function harness(produce){
 const decisions=[],calls=[],faults=[];const read=createPublicIssueReader(produce===null?undefined:async route=>{calls.push(structuredClone(route));const r=produce(calls.length);return r instanceof Uint8Array?r:new TextEncoder().encode(JSON.stringify(r))},()=>0,code=>faults.push(code));
 const Page=loadTsx(new URL('../app/reader-preview/[country]/[issue]/[view]/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){assert.fail('Unexpected development refusal')}}:name.endsWith('/server/public-issue-reader')?{canonicalPublicIssueRoute,readPublicIssue:async route=>{const d=await read(route);decisions.push(d.status);return d}}:undefined,{env:{NODE_ENV:'development'}}).default;
 return{decisions,calls,faults,render:async href=>{const u=new URL(href,origin),p=u.pathname.split('/');return renderToStaticMarkup(await Page({params:Promise.resolve({country:p[2],issue:p[3],view:p[4]}),searchParams:Promise.resolve(query(href))}))}};
}

test('guide onward explanations carry the independently validated selected dossier return',async()=>{
 for(const q of [{q:'money'},{q:['PRIVATE_QUERY']},{q:'NO_MATCH_INVENTED'}]){const html=await render(Guide,{returnTo:back(),...q});for(const [,path,label]of explanations){const href=target(html,label);assert.equal(new URL(href,origin).pathname,path);assert.deepEqual(query(href),{returnTo:back()})}assert.doesNotMatch(html,/PRIVATE_QUERY/)}
});

test('explanatory pages return the same selected edition and their original guide category',async()=>{
 for(const [Page,path,,label]of explanations){for(const view of ['sources','search']){const html=await render(Page,{returnTo:back(view)});assert.equal(target(html,'Back to the selected dossier'),back(view));const guide=target(html,label);assert.deepEqual(query(guide),{returnTo:back(view),...(path==='/sources'?{category:'evidence'}:{})});assert.match(html,/Returning checks the current publication again/);assert.match(html,/changed or withheld edition supplies no earlier statements or references/)}}
});

test('explanation selector captures own value once and rejects unknown keys before values',async()=>{
 let reads=0;const once={get returnTo(){reads++;return reads===1?back():'/editorial-preview'}};assert.equal(navigation.readingExplanationReturn(once),back());assert.equal(reads,1);
 let observed=0;for(const input of [Object.create({get returnTo(){observed++;throw Error('PRIVATE')}}),Object.defineProperty({},'returnTo',{get(){observed++;throw Error('PRIVATE')}}),{extra:'PRIVATE',get returnTo(){observed++;throw Error('PRIVATE')}}])assert.equal(navigation.readingExplanationReturn(input),null);assert.equal(observed,0);
 const proxy=Proxy.revocable({},{});proxy.revoke();for(const input of [proxy.proxy,[],null,0,{get returnTo(){throw Error('PRIVATE')}}])assert.equal(navigation.readingExplanationReturn(input),null);
 for(const [Page]of explanations){let reads=0;const html=await render(Page,{get returnTo(){reads++;return reads===1?back():null}});assert.equal(reads,1);assert.equal(target(html,'Back to the selected dossier'),back())}
});

test('invalid explanation return remains generic without echoing selectors or inventing source qualification',async()=>{
 const inputs=[{returnTo:'https://PRIVATE_CANARY.invalid'},{returnTo:back()+'#'},{returnTo:[back()]},{returnTo:back(),provider:'PRIVATE_CANARY'},{returnTo:back(),q:'PRIVATE_CANARY'},{get returnTo(){throw Error('PRIVATE_CANARY')}}];
 for(const [Page,path,,label]of explanations)for(const input of inputs){const html=await render(Page,input);assert.doesNotMatch(html,/Back to the selected dossier|PRIVATE_CANARY|name="returnTo"/);assert.equal(target(html,label),'/methodology/glossary'+(path==='/sources'?'?category=evidence':''));assert.match(html,path==='/sources'?/No source connected/:/no connected source, automated run or publication approval/)}
 for(const input of ['https://PRIVATE_CANARY.invalid',back()+'#',null,[]])for(const [,path]of explanations)assert.equal(navigation.readingExplanationHref(path.slice(1),input),path);
});

test('guide explanation guide journey retains selected filters and invokes actual fresh reader on return',async()=>{
 for(const [Page,,onward,label]of explanations)for(const view of ['sources','search']){const h=harness(()=>rows()),guide=await render(Guide,{returnTo:back(view),q:'money'}),explanation=await render(Page,query(target(guide,onward))),again=await render(Guide,{...query(target(explanation,label)),q:['PRIVATE']}),returned=await h.render(target(again,'Back to the selected dossier'));assert.match(returned,/id="claim-/);const results=target(returned,'Back to selected results');assert.equal(new URL(results,origin).pathname,`/reader-preview/norway/housing-costs/${view}`);const selected=query(results);assert.equal(selected.q,'cell #1');assert.equal(selected.type,'condition');assert.equal(selected.directoryQ,'housing');assert.equal(selected.edition,rows().publication.id);assert.equal(selected.relation,view==='sources'?'supports':undefined);assert.equal(h.calls.length,1);assert.deepEqual(h.decisions,[200]);assert.deepEqual(h.faults,[])}
});

test('explanation return cannot restore withheld changed absent bad-byte or unconfigured current dossier',async()=>{
 const old=rows().publication.id,producers=[()=>{const r=rows();r.sources[0].registration.allow_public_derived=false;return r},()=>JSON.parse(JSON.stringify(rows()).replaceAll(old,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),()=>null,()=>new Uint8Array([0xff]),null];
 for(const [Page]of explanations)for(const produce of producers){const explained=await render(Page,{returnTo:back()}),h=harness(produce),held=await h.render(target(explained,'Back to the selected dossier'));assert.doesNotMatch(held,/id="claim-|class="citation-card|Back to selected results|Definition: /);assert.match(held,/Issue temporarily unavailable|A newer publication is available|No eligible issue found/);assert.equal(h.calls.length,produce===null?0:1);assert.equal(h.faults.length,produce===producers[3]?1:0)}
});
