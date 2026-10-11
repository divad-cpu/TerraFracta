import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx_loader.mjs';
import { sample } from './helpers/public_read_rows_fixture.mjs';
import { createPublicIssueReader,canonicalPublicIssueRoute } from '../src/server/public-issue-reader.ts';
const origin='https://example.invalid',label='Read definitions for statement types, reference roles and dates';
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
const links=html=>[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m=>({...attrs(m[1]),text:m[2]}));
const target=(html,text)=>links(html).find(row=>row.text===text)?.href??assert.fail(`Missing ${text}`);
const query=href=>Object.fromEntries(new URL(href,origin).searchParams);
const Guide=loadTsx(new URL('../app/methodology/glossary/page.tsx',import.meta.url)).default;
function rows(){const r=sample();r.requestedRoute={jurisdictionSlug:'norway',issueSlug:'housing-costs'};r.country.public_slug='norway';r.dossier.public_slug='housing-costs';r.publication.snapshot.jurisdictionSlug='norway';r.publication.snapshot.issueSlug='housing-costs';return r}
function harness(produce=()=>rows()){
 const calls=[],decisions=[],diagnostics=[];
 const read=createPublicIssueReader(produce===null?undefined:async(route,signal)=>{calls.push({route:structuredClone(route),signal});return new TextEncoder().encode(JSON.stringify(produce(calls.length)))},()=>0,code=>diagnostics.push(code));
 const Page=loadTsx(new URL('../app/reader-preview/[country]/[issue]/[view]/page.tsx',import.meta.url),name=>name==='next/navigation'?{notFound(){assert.fail('Unexpected development refusal')}}:name.endsWith('/server/public-issue-reader')?{canonicalPublicIssueRoute,readPublicIssue:async route=>{const d=await read(route);decisions.push(d.status);return d}}:undefined,{env:{NODE_ENV:'development'}}).default;
 return{calls,decisions,diagnostics,render:async href=>{const u=new URL(href,origin),p=u.pathname.split('/');return renderToStaticMarkup(await Page({params:Promise.resolve({country:p[2],issue:p[3],view:p[4]}),searchParams:Promise.resolve(query(href))}))}}
}
const fields=(view,q='cell A1')=>({edition:rows().publication.id,q,type:'condition',...(view==='sources'?{relation:'supports'}:{}),directoryView:'issues',directoryQ:'housing',directoryCountry:'norway',directoryTopic:'housing'});
const href=(view,q)=>`/reader-preview/norway/housing-costs/${view}?${new URLSearchParams(fields(view,q))}`;
async function entry(view,q){const h=harness(),initial=await h.render(href(view,q));assert.deepEqual(h.decisions,[200]);const guideHref=target(initial,label),back=query(guideHref).returnTo;assert.equal(new URL(back,origin).pathname,'/reader-preview/norway/housing-costs/issue');const p=query(back);assert.equal(p.returnView,view);assert.equal(p.returnQ,q||undefined);assert.equal(p.returnType,'condition');assert.equal(p.returnRelation,view==='sources'?'supports':undefined);assert.equal(p.directoryQ,'housing');assert.equal(p.edition,rows().publication.id);return{h,initial,guideHref,back}}

test('selected statement search including zero matches opens the guide with exact existing search and directory return',async()=>{
 for(const q of ['cell A1','NO_MATCH_INVENTED','']){const e=await entry('search',q);assert.match(e.initial,/Find a statement in this dossier/);if(q==='NO_MATCH_INVENTED')assert.match(e.initial,/No matching statement in this dossier/);const guide=renderToStaticMarkup(await Guide({searchParams:Promise.resolve({...query(e.guideHref),q:'money',category:'statements'})}));assert.equal(target(guide,'Back to the selected dossier'),e.back);assert.match(guide,/id="funding"/);assert.match(e.initial,/returning reads the current publication again/)}
});

test('selected reference filters including zero matches open the guide and malformed guide search retains only checked source return',async()=>{
 for(const q of ['cell A1','NO_MATCH_INVENTED','']){const e=await entry('sources',q);assert.match(e.initial,/References in this dossier/);if(q==='NO_MATCH_INVENTED')assert.match(e.initial,/No reference matches these filters/);const guide=renderToStaticMarkup(await Guide({searchParams:Promise.resolve({...query(e.guideHref),q:['PRIVATE_CANARY']})}));assert.equal(target(guide,'Back to the selected dossier'),e.back);assert.match(guide,/Check your search/);assert.doesNotMatch(guide,/PRIVATE_CANARY/)}
});

test('new result guide entry uses actual fresh reader on issue and selected-result return and removes entry when rights change',async()=>{
 for(const view of ['sources','search']){const h=harness(n=>{const r=rows();if(n>2)r.sources[0].registration.allow_public_derived=false;return r}),initial=await h.render(href(view)),guideHref=target(initial,label),guide=renderToStaticMarkup(await Guide({searchParams:Promise.resolve(query(guideHref))})),back=target(guide,'Back to the selected dossier'),issue=await h.render(back);assert.match(issue,/id="claim-/);const results=target(issue,'Back to selected results');assert.equal(new URL(results,origin).pathname,`/reader-preview/norway/housing-costs/${view}`);assert.deepEqual(query(results),fields(view));const held=await h.render(results);assert.match(held,/Issue temporarily unavailable/);assert.doesNotMatch(held,/Read definitions for statement types|Definition: |id="claim-|current-search-results|current-source-entry--/);assert.deepEqual(h.decisions,[200,200,503]);assert.equal(h.calls.length,3);assert.ok(h.calls.every(row=>row.signal.aborted));assert.deepEqual(h.diagnostics,[])}
});

test('new guide result entry is absent for unconfigured absent or changed edition while ordinary dossier has only its existing entry',async()=>{
 for(const view of ['sources','search'])for(const produce of [null,()=>null,()=>{const r=rows();return JSON.parse(JSON.stringify(r).replaceAll(r.publication.id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))}]){const h=harness(produce),html=await h.render(href(view));assert.doesNotMatch(html,/Read definitions for statement types|Definition: |id="claim-|returnTo=/);assert.match(html,/Issue temporarily unavailable|No eligible issue found|A newer publication is available/)}
 const h=harness(),html=await h.render(`/reader-preview/norway/housing-costs/issue?edition=${rows().publication.id}`);assert.equal(links(html).filter(row=>row.text===label).length,0);assert.ok(links(html).some(row=>row.text==='Look up statement, source and date terms in the reading guide'))
});
